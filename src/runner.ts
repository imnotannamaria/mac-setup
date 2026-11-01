import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Action } from './plan.ts';
import { installDmg } from './dmg.ts';
import { installFishPlugins } from './fish.ts';

export type CommandResult = { code: number; stdout: string; stderr: string };
export type RunCommand = (command: string, args: string[]) => Promise<CommandResult>;
export const runCommand: RunCommand = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { shell: false, env: {
    ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ANALYTICS: '1',
  }, stdio: ['inherit', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const showOutput = args[0] === 'install' || args[0] === '--install-extension';
  child.stdout.on('data', chunk => {
    stdout = (stdout + String(chunk)).slice(-65536);
    if (showOutput) process.stdout.write(chunk);
  });
  child.stderr.on('data', chunk => {
    stderr = (stderr + String(chunk)).slice(-65536);
    if (showOutput) process.stderr.write(chunk);
  });
  child.on('error', reject);
  child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }));
});

export async function findExecutable(name: string): Promise<string | undefined> {
  const candidates = isAbsolute(name) ? [name] : (process.env.PATH ?? '').split(':').filter(Boolean).map(dir => join(dir, name));
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* Try next path. */ }
  }
}

async function statOrMissing(path: string) {
  try { return await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

// Replacing a symlink could disrupt another dotfiles manager. Leave it untouched.
export async function writeManagedFile(target: string, content: string, backupRoot: string, home: string): Promise<'installed' | 'unchanged'> {
  const rel = relative(resolve(home), resolve(target));
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Config target must be inside the home directory.');
  let current = resolve(home);
  for (const part of rel.split('/')) {
    current = join(current, part);
    if ((await statOrMissing(current))?.isSymbolicLink()) throw new Error('Config path contains a symlink; resolve it manually before applying.');
  }
  const stat = await statOrMissing(target);
  if (stat && !stat.isFile()) throw new Error('Config destination is not a regular file.');
  if (stat && await readFile(target, 'utf8') === content) return 'unchanged';
  if (stat) {
    const backup = join(backupRoot, 'files', rel);
    await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
    await copyFile(target, backup, constants.COPYFILE_EXCL);
  }
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.mac-setup-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
  return 'installed';
}

export type Result = { module: string; label: string; status: 'installed' | 'unchanged' | 'failed' | 'skipped' | 'manual'; detail?: string };
export type Context = { root: string; home: string; arch: string; platform: string; applications?: string };

export async function executePlan(actions: Action[], context: Context, onResult: (result: Result) => void = () => {}, run: RunCommand = runCommand): Promise<{ results: Result[]; backupRoot: string }> {
  if (context.platform !== 'darwin') throw new Error('Applying a setup is only supported on macOS. Preview works on other platforms.');
  const backupRoot = join(context.root, '.local', 'backups', `${Date.now()}-${randomUUID()}`);
  const failedModules = new Set<string>();
  const results: Result[] = [];
  const requireSuccess = async (command: string, args: string[]) => {
    const result = await run(command, args);
    if (result.code !== 0) throw new Error(`${command} failed (${result.code}). ${result.stderr.trim().slice(-600)}`);
    return result;
  };

  for (const action of actions) {
    let status: Result['status'] = 'installed';
    let detail: string | undefined;
    try {
      if (action.kind === 'manual') { status = 'manual'; detail = action.detail; }
      else if (failedModules.has(action.module) && (action.kind === 'file' || action.kind === 'extension' || action.kind === 'fish-plugins')) { status = 'skipped'; detail = 'An earlier action in this module failed. Rerun after fixing it.'; }
      else if (action.kind === 'file') {
        status = await writeManagedFile(action.target, action.content, backupRoot, context.home);
      } else if (action.kind === 'fish-plugins') {
        const fish = await findExecutable('fish');
        if (!fish) throw new Error('Fish is missing. Install the terminal packages first.');
        status = await installFishPlugins(action, { root: context.root, home: context.home, backupRoot, fish }, run);
      } else if (action.kind === 'app-store' || action.kind === 'dmg') {
        const applications = context.applications ?? '/Applications';
        const present = await statOrMissing(join(applications, action.app)) || await statOrMissing(join(context.home, 'Applications', action.app));
        if (present) status = 'unchanged';
        else if (action.kind === 'dmg') await installDmg(action, run, applications);
        else {
          if (!/^\d+$/.test(action.storeId)) throw new Error('Invalid App Store ID.');
          let mas = await findExecutable('mas');
          if (!mas) {
            const brew = await findExecutable('brew');
            if (!brew) throw new Error('Homebrew is missing. Run ./install.sh to prepare it.');
            await requireSuccess(brew, ['install', 'mas']);
            mas = await findExecutable('mas');
          }
          if (!mas) throw new Error('mas CLI is unavailable after installation. Check your Homebrew PATH.');
          const result = await run(mas, ['install', action.storeId]);
          if (result.code !== 0) throw new Error(`App Store installation failed. Sign in to the App Store and confirm this app was previously acquired by that account and is still available. ${result.stderr.trim().slice(-600)}`);
        }
      } else if (action.kind === 'package') {
        const appPresent = action.app && (await statOrMissing(join('/Applications', action.app)) || await statOrMissing(join(context.home, 'Applications', action.app)));
        const binaryPresent = action.binary && await findExecutable(action.binary);
        if (appPresent || binaryPresent) status = 'unchanged';
        else {
          const brew = await findExecutable('brew');
          if (!brew) throw new Error('Homebrew is missing. Run ./install.sh to prepare it.');
          const check = await run(brew, ['list', action.cask ? '--cask' : '--formula', action.name]);
          if (check.code === 0) status = 'unchanged';
          else await requireSuccess(brew, ['install', ...(action.cask ? ['--cask'] : []), action.name]);
        }
      } else if (action.kind === 'extension') {
        const cursor = await findExecutable('/Applications/Cursor.app/Contents/Resources/app/bin/cursor') ?? await findExecutable('cursor');
        if (!cursor) throw new Error('Cursor CLI is missing. Install Cursor or add its shell command to PATH.');
        const installed = await requireSuccess(cursor, ['--list-extensions']);
        if (installed.stdout.toLowerCase().split(/\r?\n/).includes(action.name.toLowerCase())) status = 'unchanged';
        else await requireSuccess(cursor, ['--install-extension', action.name]);
      } else if (action.kind === 'preference') {
        const before = await run('/usr/bin/defaults', ['read', action.domain, action.key]);
        const missing = before.code !== 0 && /does not exist/i.test(before.stderr);
        if (before.code !== 0 && !missing) throw new Error('Could not read the existing macOS preference.');
        const expected = action.type === 'bool' ? (action.value === 'true' ? '1' : '0') : action.value;
        if (before.code === 0 && before.stdout.trim() === expected) status = 'unchanged';
        else {
          const type = missing ? undefined : await requireSuccess('/usr/bin/defaults', ['read-type', action.domain, action.key]);
          const backup = join(backupRoot, 'preferences', `${action.domain}.${action.key}.json`);
          await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
          await writeFile(backup, JSON.stringify({ domain: action.domain, key: action.key, existed: !missing,
            previousValue: missing ? null : before.stdout.trim(), previousType: type?.stdout.trim() ?? null }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
          await requireSuccess('/usr/bin/defaults', ['write', action.domain, action.key, `-${action.type}`, action.value]);
        }
      }
    } catch (error) {
      status = 'failed';
      detail = error instanceof Error ? error.message : 'Unexpected error.';
      failedModules.add(action.module);
    }
    const result = { module: action.module, label: action.label, status, detail };
    results.push(result);
    onResult(result);
  }
  // Only summaries are saved, never file contents or environment values.
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(backupRoot, 'report.json'), JSON.stringify({ createdAt: new Date().toISOString(), results }, null, 2) + '\n', { mode: 0o600 });
  return { results, backupRoot };
}
