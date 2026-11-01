import { createHash } from 'node:crypto';
import { cp, lstat, stat as followStat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Action } from './plan.ts';
import type { RunCommand } from './runner.ts';

export const fisherBootstrap = {
  url: 'https://raw.githubusercontent.com/jorgebucaran/fisher/4.4.8/functions/fisher.fish',
  sha256: '0fb6c81ae3003e95b5671766fa6c25c3597066e29965b7772f6c1b007387356d',
};

async function rejectSymlinks(path: string): Promise<void> {
  let stat;
  try { stat = await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (stat.isSymbolicLink()) {
    // Vendor completions (e.g. OrbStack) link to regular files. Fisher refuses
    // conflicts on new installs; managed links are additionally rejected by the wrapper.
    try { if ((await followStat(path)).isFile()) return; } catch { /* Reject broken links. */ }
    throw new Error('Fish config contains a directory or broken symlink; resolve it before installing plugins.');
  }
  if (stat.isDirectory()) for (const entry of await readdir(path)) await rejectSymlinks(join(path, entry));
}

export async function installFishPlugins(
  action: Extract<Action, { kind: 'fish-plugins' }>,
  context: { root: string; home: string; backupRoot: string; fish: string },
  run: RunCommand,
  bootstrapSource = fisherBootstrap,
): Promise<'installed' | 'unchanged'> {
  for (const plugin of [...action.plugins, ...action.remove]) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(plugin)) throw new Error('Invalid Fish plugin identifier.');
  }
  const configParent = join(context.home, '.config');
  // Do not let a symlinked .config redirect plugin operations outside the backup.
  try {
    if ((await lstat(configParent)).isSymbolicLink()) throw new Error('Fish config parent is a symlink; resolve it before installing plugins.');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const config = join(configParent, 'fish');
  for (const path of [config, ...['functions', 'conf.d', 'completions', 'themes', 'fish_plugins', 'fish_variables'].map(name => join(config, name))]) {
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new Error('Fish state or directory is a symlink; resolve it before installing plugins.');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  await rejectSymlinks(config);
  const backup = join(context.backupRoot, 'fish-plugins', '.config', 'fish');
  let configExists = false;
  try {
    await lstat(config);
    configExists = true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (configExists) {
    await mkdir(join(context.backupRoot, 'fish-plugins', '.config'), { recursive: true, mode: 0o700 });
    await cp(config, backup, { recursive: true, errorOnExist: true, force: false });
  }
  const work = await mkdtemp(join(tmpdir(), 'mac-setup-fisher-'));
  const bootstrap = join(work, 'fisher.fish');
  const checked = async (command: string, args: string[]) => {
    const result = await run(command, args);
    if (result.code !== 0) throw new Error(`Fish plugin setup failed. ${result.stderr.trim().slice(-600)}`);
    return result;
  };
  const fisher = (args: string[]) => checked('/usr/bin/env', [
    `HOME=${context.home}`, `XDG_CONFIG_HOME=${configParent}`, `XDG_DATA_HOME=${join(context.home, '.local/share')}`,
    // --no-config disables persistent universal variables in Fish 4. Use a
    // normal non-interactive process so Fisher can read/write its metadata.
    context.fish, '--private', join(context.root, 'config/fish/manage-plugins.fish'), bootstrap, ...args,
  ]);
  const list = async () => (await fisher(['list'])).stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  try {
    await checked('/usr/bin/curl', ['--fail', '--show-error', '--silent', '--location', '--proto', '=https', '--proto-redir', '=https', '--max-time', '120', bootstrapSource.url, '--output', bootstrap]);
    if (createHash('sha256').update(await readFile(bootstrap)).digest('hex') !== bootstrapSource.sha256) throw new Error('Fisher bootstrap checksum mismatch. No plugin commands were run.');
    const before = await list();
    const removing = action.remove.filter(plugin => before.includes(plugin));
    if (removing.length) await fisher(['remove', ...removing]);
    // On a fresh profile Fisher also installs entries from fish_plugins. Replace
    // stale entries (especially z) with the desired set plus installed extras.
    const manifest = [...new Set([...before.filter(plugin => !action.remove.includes(plugin)), ...action.plugins])].join('\n') + '\n';
    const manifestPath = join(config, 'fish_plugins');
    let previousManifest = '';
    try { previousManifest = await readFile(manifestPath, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const manifestChanged = manifest !== previousManifest;
    if (manifestChanged) {
      await mkdir(config, { recursive: true });
      await writeFile(manifestPath, manifest, { mode: 0o600 });
    }
    const missing = action.plugins.filter(plugin => !before.includes(plugin));
    if (missing.length) await fisher(['install', ...missing]);
    const after = await list();
    if (action.plugins.some(plugin => !after.includes(plugin)) || action.remove.some(plugin => after.includes(plugin))) {
      throw new Error('Fisher did not finish installing/removing all requested plugins. Check network access or file conflicts, then rerun.');
    }
    return missing.length || removing.length || manifestChanged ? 'installed' : 'unchanged';
  } finally { await rm(work, { recursive: true, force: true }); }
}
