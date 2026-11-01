import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadLocalConfig, parseOptions } from '../src/config.ts';
import { buildPlan, describeAction, fishQuote, type Action } from '../src/plan.ts';
import { executePlan, writeManagedFile, type RunCommand } from '../src/runner.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const empty = { MAC_SETUP_GIT_NAME: '', MAC_SETUP_GIT_EMAIL: '' };

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'mac-setup-test-'));
  const home = join(dir, 'home');
  await mkdir(home);
  return { dir, home, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('preview is the default; invalid flags and conflicting modes fail', () => {
  assert.equal(parseOptions([]).apply, false);
  assert.throws(() => parseOptions(['--apply', '--dry-run']));
  assert.throws(() => parseOptions(['--only', 'typo']));
  assert.throws(() => parseOptions(['--apps', 'typo']));
  assert.throws(() => parseOptions(['--only', 'editor', '--apps', 'chrome']));
  assert.throws(() => parseOptions(['--aplly']));
  assert.ok(parseOptions([]).selection.apps.includes('dia'));
  assert.deepEqual(parseOptions(['--apps', 'dia']).selection.apps, ['dia']);
});

test('bootstrap rejects invalid flags, missing arguments and conflicting modes before dependency checks', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.dir, 'install.sh'), await readFile(join(root, 'install.sh')));
    for (const [args, expected] of [
      [['--apply', '--yes', '--typo'], /Unknown argument/],
      [['--apply', '--yes', '--only'], /Missing value/],
      [['--apply', '--yes', '--only', '--apps'], /Missing value/],
      [['--apply', '--yes', '--only', 'typo'], /Invalid module/],
      [['--apply', '--yes', '--dry-run'], /Choose --apply or --dry-run/],
      [['--only', 'editor', '--apps', 'chrome'], /requires the apps module/],
    ] as const) {
      const result = spawnSync('/bin/bash', [join(f.dir, 'install.sh'), ...args], { encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.match(result.stderr, expected);
    }
    assert.deepEqual(await readdir(f.dir), ['home', 'install.sh']);
  } finally { await f.cleanup(); }
});

test('local config is parsed as data, never executed, and env overrides the file', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.dir, '.env.local'), 'MAC_SETUP_GIT_NAME="Example $(touch should-not-exist)"\nMAC_SETUP_GIT_EMAIL="example@example.com"\n');
    const config = loadLocalConfig(f.dir, {});
    assert.match(config.MAC_SETUP_GIT_NAME, /\$\(touch/);
    assert.equal(loadLocalConfig(f.dir, { MAC_SETUP_GIT_NAME: 'Override' }).MAC_SETUP_GIT_NAME, 'Override');
    assert.deepEqual(await readdir(f.dir), ['.env.local', 'home']);
    await writeFile(join(f.dir, '.env.local'), 'MAC_SETUP_GIT_EMAIL="not-an-email"');
    assert.throws(() => loadLocalConfig(f.dir, {}), error => error instanceof Error && !error.message.includes('not-an-email'));
  } finally { await f.cleanup(); }
});

test('plan uses selected modules only and keeps identity out of preview text', () => {
  const options = parseOptions(['--only', 'terminal']);
  const local = { MAC_SETUP_GIT_NAME: "Example O'Name", MAC_SETUP_GIT_EMAIL: 'private@example.com' };
  const plan = buildPlan(options.selection, local, root, '/tmp/example-home');
  assert.ok(plan.every(action => action.module === 'terminal'));
  assert.ok(plan.some(action => action.kind === 'file' && action.private));
  const preview = plan.map(describeAction).join('\n');
  assert.ok(!preview.includes(local.MAC_SETUP_GIT_EMAIL));
  assert.ok(!preview.includes(local.MAC_SETUP_GIT_NAME));
  assert.equal(fishQuote("O'Name\\Example"), "'O\\'Name\\\\Example'");
});

test('managed files are backed up once; reruns preserve unchanged files', async () => {
  const f = await fixture();
  try {
    const target = join(f.home, '.config', 'fish', 'config.fish');
    await mkdir(join(f.home, '.config', 'fish'), { recursive: true });
    await writeFile(target, 'old config\n');
    const backups = join(f.dir, 'backups');
    assert.equal(await writeManagedFile(target, 'new config\n', backups, f.home), 'installed');
    assert.equal(await readFile(join(backups, 'files/.config/fish/config.fish'), 'utf8'), 'old config\n');
    assert.equal(await writeManagedFile(target, 'new config\n', backups, f.home), 'unchanged');
    assert.equal(await readFile(target, 'utf8'), 'new config\n');
    await assert.rejects(writeManagedFile(join(f.dir, 'outside'), 'x', backups, f.home));
  } finally { await f.cleanup(); }
});

test('symlinked config paths are left untouched', async () => {
  const f = await fixture();
  try {
    const real = join(f.dir, 'real');
    await writeFile(real, 'original');
    const link = join(f.home, 'config.fish');
    await symlink(real, link);
    await assert.rejects(writeManagedFile(link, 'replacement', join(f.dir, 'backups'), f.home), /symlink/);
    assert.equal(await readFile(real, 'utf8'), 'original');
  } finally { await f.cleanup(); }
});

test('execution saves previous preference before writing; independent actions continue after failure', async () => {
  const f = await fixture();
  try {
    const calls: string[][] = [];
    const run: RunCommand = async (_cmd, args) => {
      calls.push(args);
      if (args[0] === 'read') return { code: 0, stdout: '20\n', stderr: '' };
      if (args[0] === 'read-type') return { code: 0, stdout: 'Type is integer\n', stderr: '' };
      if (args[0] === 'write' && args[2] === 'tilesize') {
        const sessions = await readdir(join(f.dir, '.local/backups'));
        const previous = JSON.parse(await readFile(join(f.dir, '.local/backups', sessions[0]!, 'preferences/com.apple.dock.tilesize.json'), 'utf8'));
        assert.equal(previous.previousValue, '20');
        return { code: 1, stdout: '', stderr: 'simulated failure' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const actions: Action[] = [
      { module: 'macos', kind: 'preference', label: 'Dock size', domain: 'com.apple.dock', key: 'tilesize', type: 'int', value: '41' },
      { module: 'macos', kind: 'preference', label: 'Dock hide', domain: 'com.apple.dock', key: 'autohide', type: 'bool', value: 'false' },
      { module: 'editor', kind: 'file', label: 'Editor config', target: join(f.home, 'editor.json'), content: '{}' },
    ];
    const result = await executePlan(actions, { root: f.dir, home: f.home, arch: 'arm64', platform: 'darwin' }, undefined, run);
    assert.deepEqual(result.results.map(result => result.status), ['failed', 'installed', 'installed']);
    assert.ok(calls.some(args => args[0] === 'write' && args[2] === 'autohide'));
    assert.equal(await readFile(join(f.home, 'editor.json'), 'utf8'), '{}');
  } finally { await f.cleanup(); }
});

test('CLI dry-run has no writes even with local identity configured', async () => {
  const f = await fixture();
  try {
    const before = await readdir(root);
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--dry-run', '--only', 'terminal'], {
      cwd: root, env: { ...process.env, HOME: f.home, MAC_SETUP_GIT_NAME: 'Test Name', MAC_SETUP_GIT_EMAIL: 'hidden@example.com' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Preview only/);
    assert.ok(!result.stdout.includes('hidden@example.com'));
    assert.deepEqual(await readdir(f.home), []);
    assert.deepEqual(await readdir(root), before);
  } finally { await f.cleanup(); }
});

test('non-interactive apply requires --yes before any mutation', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--apply', '--only', 'macos'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /Non-interactive apply needs --yes/);
});

test('apply refuses unsupported platforms before executing commands', async () => {
  let calls = 0;
  await assert.rejects(executePlan([], { root, home: '/tmp/home', arch: 'x64', platform: 'linux' }, undefined, async () => { calls++; return { code: 0, stdout: '', stderr: '' }; }), /only supported on macOS/);
  assert.equal(calls, 0);
});

test('package failures skip dependent configs while other modules continue', async () => {
  const f = await fixture();
  try {
    const actions: Action[] = [
      { module: 'terminal', kind: 'package', label: 'Fish', name: 'fish', cask: false },
      { module: 'terminal', kind: 'file', label: 'Fish config', target: join(f.home, 'config.fish'), content: 'config' },
      { module: 'editor', kind: 'file', label: 'Editor config', target: join(f.home, 'editor.json'), content: '{}' },
    ];
    const run: RunCommand = async () => ({ code: 1, stdout: '', stderr: 'simulated unavailable package' });
    const result = await executePlan(actions, { root: f.dir, home: f.home, arch: 'arm64', platform: 'darwin' }, undefined, run);
    assert.deepEqual(result.results.map(result => result.status), ['failed', 'skipped', 'installed']);
    assert.deepEqual(await readdir(f.home), ['editor.json']);
  } finally { await f.cleanup(); }
});

test('preferences that were unset are recorded as absent before applying', async () => {
  const f = await fixture();
  try {
    const run: RunCommand = async (_command, args) => args[0] === 'read'
      ? { code: 1, stdout: '', stderr: 'The domain/default pair does not exist' }
      : { code: 0, stdout: '', stderr: '' };
    const result = await executePlan([
      { module: 'macos', kind: 'preference', label: 'Dark mode', domain: 'NSGlobalDomain', key: 'AppleInterfaceStyle', type: 'string', value: 'Dark' },
    ], { root: f.dir, home: f.home, arch: 'arm64', platform: 'darwin' }, undefined, run);
    assert.equal(result.results[0]?.status, 'installed');
    const backup = JSON.parse(await readFile(join(result.backupRoot, 'preferences/NSGlobalDomain.AppleInterfaceStyle.json'), 'utf8'));
    assert.equal(backup.existed, false);
    assert.equal(backup.previousValue, null);
  } finally { await f.cleanup(); }
});

test('bootstrap dry-run refuses missing dependencies without installing or writing files', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.dir, 'install.sh'), await readFile(join(root, 'install.sh')));
    const before = await readdir(f.dir);
    const result = spawnSync('/bin/bash', [join(f.dir, 'install.sh'), '--dry-run'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No dependencies were installed/);
    assert.deepEqual(await readdir(f.dir), before);
  } finally { await f.cleanup(); }
});
