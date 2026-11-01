import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildPlan, describeAction, type Action } from '../src/plan.ts';
import { installDmg } from '../src/dmg.ts';
import { executePlan, type RunCommand } from '../src/runner.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const image = Buffer.from('fake disk image');
const action: Extract<Action, { kind: 'dmg' }> = {
  module: 'apps', kind: 'dmg', label: 'TextWarden', app: 'TextWarden.app', version: '0.6.0',
  url: 'https://github.com/PhilipSchmid/textwarden/releases/download/v0.6.0/TextWarden-0.6.0-Universal.dmg',
  sha256: createHash('sha256').update(image).digest('hex'),
};

test('RunCat and TextWarden generate automated installation actions, not manual downloads', () => {
  const plan = buildPlan({ modules: ['apps'], apps: ['runcat', 'textwarden'] }, { MAC_SETUP_GIT_NAME: '', MAC_SETUP_GIT_EMAIL: '' }, root, '/tmp/example');
  assert.deepEqual(plan.slice(0, 2).map(action => action.kind), ['app-store', 'dmg']);
  assert.match(describeAction(plan[0]!), /mas install 1429033973/);
  assert.match(describeAction(plan[1]!), /verify SHA-256/);
  assert.ok(plan.filter(action => action.kind === 'manual').every(action => !/runcat|textwarden/i.test(action.detail)));
});

test('verified DMG is mounted, copied, detached and cleaned up', async () => {
  const applications = await mkdtemp(join(tmpdir(), 'mac-setup-apps-test-'));
  const calls: string[][] = [];
  let downloaded = '';
  const run: RunCommand = async (command, args) => {
    calls.push([command, ...args]);
    if (command.endsWith('/curl')) {
      downloaded = args[args.indexOf('--output') + 1]!;
      await writeFile(downloaded, image);
    } else if (args[0] === 'attach') {
      const mount = args[args.indexOf('-mountpoint') + 1]!;
      await mkdir(join(mount, action.app));
      await writeFile(join(mount, action.app, 'test.txt'), 'app contents');
    } else if (command.endsWith('/ditto')) await cp(args[0]!, args[1]!, { recursive: true });
    else if (args[0] === 'detach') await rm(join(args[1]!, action.app), { recursive: true });
    return { code: 0, stdout: '', stderr: '' };
  };
  try {
    await installDmg(action, run, applications);
    assert.equal(await readFile(join(applications, action.app, 'test.txt'), 'utf8'), 'app contents');
    assert.deepEqual(await readdir(applications), [action.app]);
    assert.ok(calls.some(call => call[1] === 'detach'));
    await assert.rejects(readFile(downloaded), { code: 'ENOENT' });
  } finally { await rm(applications, { recursive: true, force: true }); }
});

test('checksum mismatch prevents mounting and leaves the application directory unchanged', async () => {
  const applications = await mkdtemp(join(tmpdir(), 'mac-setup-apps-test-'));
  const calls: string[] = [];
  const run: RunCommand = async (command, args) => {
    calls.push(command);
    if (command.endsWith('/curl')) await writeFile(args[args.indexOf('--output') + 1]!, 'wrong contents');
    return { code: 0, stdout: '', stderr: '' };
  };
  try {
    await assert.rejects(installDmg(action, run, applications), /checksum mismatch/);
    assert.deepEqual(calls, ['/usr/bin/curl']);
    assert.deepEqual(await readdir(applications), []);
  } finally { await rm(applications, { recursive: true, force: true }); }
});

test('DMG is detached and cleaned up after failed attachment or copy', async () => {
  for (const failure of ['attach', 'copy']) {
    const applications = await mkdtemp(join(tmpdir(), 'mac-setup-apps-test-'));
    let imagePath = '';
    let detached = false;
    const run: RunCommand = async (command, args) => {
      if (command.endsWith('/curl')) {
        imagePath = args[args.indexOf('--output') + 1]!;
        await writeFile(imagePath, image);
      } else if (args[0] === 'attach') {
        await mkdir(join(args[args.indexOf('-mountpoint') + 1]!, action.app));
        if (failure === 'attach') return { code: 1, stdout: '', stderr: 'simulated partial attach failure' };
      } else if (command.endsWith('/ditto')) {
        return { code: 1, stdout: '', stderr: 'simulated copy failure' };
      } else if (args[0] === 'detach') {
        detached = true;
        await rm(join(args[1]!, action.app), { recursive: true });
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    try {
      await assert.rejects(installDmg(action, run, applications), /simulated/);
      assert.ok(detached);
      assert.deepEqual(await readdir(applications), []);
      await assert.rejects(readFile(imagePath), { code: 'ENOENT' });
    } finally { await rm(applications, { recursive: true, force: true }); }
  }
});

test('failed DMG detachment preserves the mount directory for manual recovery', async () => {
  const applications = await mkdtemp(join(tmpdir(), 'mac-setup-apps-test-'));
  let imagePath = '';
  let mount = '';
  const run: RunCommand = async (command, args) => {
    if (command.endsWith('/curl')) {
      imagePath = args[args.indexOf('--output') + 1]!;
      await writeFile(imagePath, image);
    } else if (args[0] === 'attach') {
      mount = args[args.indexOf('-mountpoint') + 1]!;
      await mkdir(join(mount, action.app));
      await writeFile(join(mount, action.app, 'file'), 'original');
    } else if (command.endsWith('/ditto')) await cp(args[0]!, args[1]!, { recursive: true });
    else if (args[0] === 'detach') return { code: 1, stdout: '', stderr: 'busy' };
    return { code: 0, stdout: '', stderr: '' };
  };
  try {
    await assert.rejects(installDmg(action, run, applications), /could not be detached/);
    assert.equal(await readFile(join(mount, action.app, 'file'), 'utf8'), 'original');
    assert.deepEqual(await readFile(imagePath), image);
  } finally {
    await rm(applications, { recursive: true, force: true });
    // This mount is only a directory created by the mock, never a real disk image.
    if (imagePath) await rm(dirname(imagePath), { recursive: true, force: true });
  }
});

test('already installed App Store and DMG apps do not download or invoke installers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mac-setup-apps-test-'));
  const applications = join(dir, 'Applications');
  await mkdir(join(applications, 'RunCat.app'), { recursive: true });
  await mkdir(join(applications, 'TextWarden.app'));
  let calls = 0;
  try {
    const result = await executePlan([
      { module: 'apps', kind: 'app-store', label: 'RunCat', app: 'RunCat.app', storeId: '1429033973' }, action,
    ], { root: dir, home: dir, arch: 'arm64', platform: 'darwin', applications }, undefined,
    async () => { calls++; throw new Error('Unexpected installer call'); });
    assert.deepEqual(result.results.map(result => result.status), ['unchanged', 'unchanged']);
    assert.equal(calls, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('App Store installation uses the exact app ID and reports account errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mac-setup-apps-test-'));
  const originalPath = process.env.PATH;
  try {
    await writeFile(join(dir, 'mas'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    process.env.PATH = `${dir}:${originalPath ?? ''}`;
    const calls: string[][] = [];
    const result = await executePlan([
      { module: 'apps', kind: 'app-store', label: 'RunCat', app: 'RunCat.app', storeId: '1429033973' },
    ], { root: dir, home: dir, arch: 'arm64', platform: 'darwin', applications: join(dir, 'Applications') }, undefined,
    async (_command, args) => { calls.push(args); return { code: 1, stdout: '', stderr: 'Not signed in' }; });
    assert.deepEqual(calls, [['install', '1429033973']]);
    assert.equal(result.results[0]?.status, 'failed');
    assert.match(result.results[0]?.detail ?? '', /Sign in to the App Store/);
  } finally {
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
    await rm(dir, { recursive: true, force: true });
  }
});
