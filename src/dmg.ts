import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, rename, rm, rmdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Action } from './plan.ts';
import type { RunCommand } from './runner.ts';

type DmgAction = Extract<Action, { kind: 'dmg' }>;

export async function installDmg(action: DmgAction, run: RunCommand, applications = '/Applications'): Promise<void> {
  if (!/^[\w.-]+\.app$/.test(action.app) || !/^[a-f0-9]{64}$/.test(action.sha256)) throw new Error('Invalid DMG metadata.');
  if (!action.url.startsWith('https://github.com/PhilipSchmid/textwarden/releases/download/')) throw new Error('Unexpected DMG download source.');
  await access(applications, constants.W_OK);
  const work = await mkdtemp(join(tmpdir(), 'mac-setup-dmg-'));
  const image = join(work, 'download.dmg');
  const mount = join(work, 'mount');
  const staged = join(applications, `.mac-setup-${randomUUID()}.app`);
  let mounted = false;
  let detachFailed = false;
  const checked = async (command: string, args: string[]) => {
    const result = await run(command, args);
    if (result.code !== 0) throw new Error(`${command} failed (${result.code}). ${result.stderr.trim().slice(-600)}`);
  };
  try {
    await checked('/usr/bin/curl', ['--fail', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--tlsv1.2', '--connect-timeout', '30', '--max-time', '600', action.url, '--output', image]);
    const digest = createHash('sha256').update(await readFile(image)).digest('hex');
    if (digest !== action.sha256) throw new Error('DMG checksum mismatch. Nothing was mounted or installed.');
    await mkdir(mount);
    // Even an attach that reports failure may have mounted a volume.
    mounted = true;
    await checked('/usr/bin/hdiutil', ['attach', image, '-mountpoint', mount, '-nobrowse', '-readonly', '-noautoopen']);
    const source = join(mount, action.app);
    const sourceStat = await lstat(source);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error('Expected app bundle not found in the DMG.');
    await checked('/usr/bin/ditto', [source, staged]);
    // Refuse to overwrite an app that appeared while the download was running.
    const destination = join(applications, action.app);
    try { await lstat(destination); throw new Error('App appeared during installation. Rerun to skip the existing copy.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await rename(staged, destination);
  } finally {
    try {
      await rm(staged, { recursive: true, force: true });
    } finally {
      if (mounted) {
        try { await checked('/usr/bin/hdiutil', ['detach', mount]); }
        catch { detachFailed = true; }
      }
      // Never recursively remove the mountpoint, even if hdiutil returned success.
      // If still mounted, rmdir fails rather than traversing the app bundle.
      if (!detachFailed) {
        if (mounted) {
          try { await rmdir(mount); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        await rm(work, { recursive: true, force: true });
      } else throw new Error(`DMG could not be detached. Eject ${mount} manually, then remove ${work}. The app may already be installed.`);
    }
  }
}
