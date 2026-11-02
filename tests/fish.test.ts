import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildPlan, type Action } from '../src/plan.ts';
import { fisherBootstrap, installFishPlugins } from '../src/fish.ts';
import { findExecutable, runCommand, type RunCommand } from '../src/runner.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = { MAC_SETUP_GIT_NAME: '', MAC_SETUP_GIT_EMAIL: '' };
const pluginAction = buildPlan({ modules: ['terminal'], apps: [] }, local, root, '/tmp/example').find((action): action is Extract<Action, { kind: 'fish-plugins' }> => action.kind === 'fish-plugins')!;
const fixtureBootstrap = 'function fisher; return 0; end\n';
const source = { ...fisherBootstrap, sha256: createHash('sha256').update(fixtureBootstrap).digest('hex') };

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'mac-setup-fish-test-'));
  const home = join(dir, 'home');
  await mkdir(join(home, '.config/fish/functions'), { recursive: true });
  await writeFile(join(home, '.config/fish/functions/existing.fish'), 'original user function');
  return { dir, home, context: { root, home, backupRoot: join(dir, 'backups'), fish: '/fake/fish' },
    cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('terminal chooses zoxide and apps keep ChatGPT without standalone Codex installs', () => {
  assert.ok(!pluginAction.plugins.includes('jethrokuan/z'));
  assert.ok(pluginAction.plugins.includes('jorgebucaran/fisher'));
  const apps = buildPlan({ modules: ['apps'], apps: ['chatgpt'] }, local, root, '/tmp/example');
  const packages = apps.filter(action => action.kind === 'package');
  assert.equal(packages.length, 1);
  assert.ok(packages.some(action => action.name === 'chatgpt' && action.app === 'ChatGPT.app'));
});

test('Fish state is backed up before plugin changes; unrelated plugins survive and reruns skip installation', async () => {
  const f = await fixture();
  const installed = new Set(['jethrokuan/z', 'example/unrelated']);
  const operations: string[] = [];
  const run: RunCommand = async (command, args) => {
    if (command.endsWith('/curl')) await writeFile(args[args.indexOf('--output') + 1]!, fixtureBootstrap);
    else {
      const operation = args[7]!;
      operations.push(operation);
      assert.equal(await readFile(join(f.context.backupRoot, 'fish-plugins/.config/fish/functions/existing.fish'), 'utf8'), 'original user function');
      if (operation === 'list') return { code: 0, stdout: [...installed].join('\n'), stderr: '' };
      if (operation === 'install') {
        const manifest = await readFile(join(f.home, '.config/fish/fish_plugins'), 'utf8');
        assert.ok(!manifest.includes('jethrokuan/z'));
        assert.ok(manifest.includes('example/unrelated'));
      }
      for (const plugin of args.slice(8)) {
        if (operation === 'remove') installed.delete(plugin);
        if (operation === 'install') installed.add(plugin);
      }
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  try {
    await writeFile(join(f.home, '.config/fish/fish_plugins'), 'jethrokuan/z\n');
    assert.equal(await installFishPlugins(pluginAction, f.context, run, source), 'installed');
    assert.equal(await readFile(join(f.context.backupRoot, 'fish-plugins/.config/fish/fish_plugins'), 'utf8'), 'jethrokuan/z\n');
    assert.ok(installed.has('example/unrelated'));
    assert.ok(!installed.has('jethrokuan/z'));
    assert.ok(pluginAction.plugins.every(plugin => installed.has(plugin)));
    operations.length = 0;
    assert.equal(await installFishPlugins(pluginAction, { ...f.context, backupRoot: join(f.dir, 'rerun-backups') }, async (command, args) => {
      // The first backup remains available for the shared mock assertion.
      return run(command, args);
    }, source), 'unchanged');
    assert.deepEqual(operations, ['list', 'list']);
  } finally { await f.cleanup(); }
});

test('Fisher partial success is reported as failure when a requested plugin is missing', async () => {
  const f = await fixture();
  try {
    const run: RunCommand = async (command, args) => {
      if (command.endsWith('/curl')) await writeFile(args[args.indexOf('--output') + 1]!, fixtureBootstrap);
      return { code: 0, stdout: '', stderr: '' };
    };
    await assert.rejects(installFishPlugins(pluginAction, f.context, run, source), /did not finish/);
    assert.equal(await readFile(join(f.context.backupRoot, 'fish-plugins/.config/fish/functions/existing.fish'), 'utf8'), 'original user function');
  } finally { await f.cleanup(); }
});

test('checksum mismatch never executes Fish', async () => {
  const f = await fixture();
  const calls: string[] = [];
  try {
    const run: RunCommand = async (command, args) => {
      calls.push(command);
      await writeFile(args[args.indexOf('--output') + 1]!, 'wrong bootstrap');
      return { code: 0, stdout: '', stderr: '' };
    };
    await assert.rejects(installFishPlugins(pluginAction, f.context, run, source), /checksum mismatch/);
    assert.deepEqual(calls, ['/usr/bin/curl']);
  } finally { await f.cleanup(); }
});

test('symlinked plugin files are rejected before downloading or executing anything', async () => {
  const f = await fixture();
  try {
    await symlink('/tmp/external-file', join(f.home, '.config/fish/functions/link.fish'));
    await assert.rejects(installFishPlugins(pluginAction, f.context, async () => { throw new Error('Unexpected command'); }, source), /symlink/);
  } finally { await f.cleanup(); }
});

test('Fish wrapper accepts an empty list and rejects custom paths using an isolated home', async t => {
  const fish = await findExecutable('fish');
  if (!fish) { t.skip('Fish executable is not available on this host.'); return; }
  const f = await fixture();
  try {
    const bootstrap = join(f.dir, 'bootstrap.fish');
    await writeFile(bootstrap, 'function fisher; return 1; end\n');
    const env = { ...process.env, HOME: f.home, XDG_CONFIG_HOME: join(f.home, '.config'), XDG_DATA_HOME: join(f.home, '.local/share') };
    const args = ['--private', join(root, 'config/fish/manage-plugins.fish'), bootstrap, 'list'];
    const empty = spawnSync(fish, args, { env, encoding: 'utf8' });
    assert.equal(empty.status, 0, empty.stderr);
    const custom = spawnSync(fish, args, { env: { ...env, fisher_path: join(f.dir, 'outside') }, encoding: 'utf8' });
    assert.equal(custom.status, 1);
    assert.match(custom.stderr, /Custom fisher_path/);
  } finally { await f.cleanup(); }
});

test('Fisher metadata persists across real Fish processes and a rerun is unchanged', async t => {
  const fish = await findExecutable('fish');
  if (!fish) { t.skip('Fish executable is not available.'); return; }
  const f = await fixture();
  const bootstrap = `function fisher
    switch $argv[1]
        case list
            set -q _fisher_plugins[1]; or return 1
            printf '%s\\n' $_fisher_plugins
        case install
            set --universal --append _fisher_plugins $argv[2..]
    end
end
`;
  const pinned = { ...source, sha256: createHash('sha256').update(bootstrap).digest('hex') };
  const run: RunCommand = async (command, args) => {
    if (command.endsWith('/curl')) {
      await writeFile(args[args.indexOf('--output') + 1]!, bootstrap);
      return { code: 0, stdout: '', stderr: '' };
    }
    return runCommand(command,args);
  };
  try {
    const context = {...f.context,fish};
    assert.equal(await installFishPlugins(pluginAction,context,run,pinned),'installed');
    assert.equal(await installFishPlugins(pluginAction,{...context,backupRoot:join(f.dir,'second')},run,pinned),'unchanged');
  } finally { await f.cleanup(); }
});

test('unmanaged vendor completion symlinks are preserved without changing their targets', async () => {
  const f = await fixture();
  try {
    const external=join(f.dir,'vendor.fish');
    await writeFile(external,'vendor completion');
    await mkdir(join(f.home,'.config/fish/completions'));
    await symlink(external,join(f.home,'.config/fish/completions/vendor.fish'));
    const run:RunCommand=async(command,args)=>{
      if(command.endsWith('/curl')) await writeFile(args[args.indexOf('--output')+1]!,fixtureBootstrap);
      return {code:0,stdout:pluginAction.plugins.join('\n'),stderr:''};
    };
    await installFishPlugins(pluginAction,f.context,run,source);
    assert.equal(await readFile(external,'utf8'),'vendor completion');
  } finally {await f.cleanup();}
});
