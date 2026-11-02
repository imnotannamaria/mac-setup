import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { Selection } from './config.ts';
import { buildPlan } from './plan.ts';
import { findExecutable, type Context } from './runner.ts';

export type Health = { label: string; status: 'ok' | 'missing' | 'warning'; detail: string };
export type ReadCommand = (command: string, args: string[]) => Promise<{ code: number; stdout: string }>;
// Never start shells, editors, Homebrew, or installation hooks during diagnosis.
const readCommand: ReadCommand = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
  let stdout = '';
  child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-65536); });
  child.on('error', reject);
  child.on('close', code => resolve({ code: code ?? 1, stdout }));
});
const pluginFiles: Record<string, string> = {
  'jorgebucaran/fisher': 'functions/fisher.fish',
  'franciscolourenco/done': 'conf.d/done.fish',
  'jorgebucaran/autopair.fish': 'conf.d/autopair.fish',
  'nickeb96/puffer-fish': 'conf.d/puffer_fish_key_bindings.fish',
  'jorgebucaran/nvm.fish': 'functions/nvm.fish',
  'patrickf1/fzf.fish': 'conf.d/fzf.fish',
  'meaningful-ooo/sponge': 'conf.d/sponge.fish',
  'gazorby/fish-abbreviation-tips': 'conf.d/abbr_tips.fish',
};
async function exists(path: string, directory = false) {
  try { const info = await stat(path); return directory ? info.isDirectory() : info.isFile(); }
  catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
    throw error;
  }
}
export async function diagnose(selection: Selection, context: Context,
  lookup = findExecutable, run: ReadCommand = readCommand): Promise<Health[]> {
  const results: Health[] = [];
  const seen = new Set<string>();
  const check = async (key: string, label: string, probe: () => Promise<Omit<Health, 'label'>>) => {
    if (seen.has(key)) return;
    seen.add(key);
    try { results.push({ label, ...await probe() }); }
    catch { results.push({ label, status: 'warning', detail: 'Could not inspect this item (permissions, timeout or command failure). No changes made.' }); }
  };
  const binary = async (name: string) => check(`binary:${name}`, name, async () => await lookup(name)
    ? { status: 'ok', detail: 'Executable found.' } : { status: 'missing', detail: 'Executable not found in PATH.' });
  const app = async (name: string) => check(`app:${name}`, name, async () => {
    const found = await exists(join(context.applications ?? '/Applications', name), true)
      || await exists(join(context.home, 'Applications', name), true);
    return { status: found ? 'ok' : 'missing', detail: found ? 'App bundle found.' : 'App not found in Applications.' };
  });
  await check('platform', 'macOS', async () => ({ status: context.platform === 'darwin' ? 'ok' : 'warning', detail: context.platform === 'darwin' ? 'Supported platform.' : 'Installation supports macOS only.' }));
  await binary('brew');
  await check('node', 'Node.js runtime', async () => {
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    return { status: major > 22 || major === 22 && minor >= 16 ? 'ok' : 'missing', detail: `Running ${process.versions.node}; requires 22.16+.` };
  });
  const plan = buildPlan(selection, { MAC_SETUP_GIT_NAME: '', MAC_SETUP_GIT_EMAIL: '' }, context.root, context.home);
  for (const action of plan) {
    if (action.kind === 'package') {
      if (action.app) await app(action.app);
      else if (action.name === 'font-jetbrains-mono-nerd-font') {
        await check('font', 'JetBrains Mono Nerd Font', async () => {
          let found = false;
          for (const dir of [join(context.home, 'Library/Fonts'), '/Library/Fonts']) {
            let names: string[] = [];
            try { names = await readdir(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            found ||= names.some(name => /JetBrainsMono.*NerdFont.*\.(ttf|otf)$/i.test(name));
          }
          return { status: found ? 'ok' : 'missing', detail: found ? 'Font files found.' : 'Font files not found.' };
        });
      } else {
        const aliases: Record<string, string> = { python: 'python3', forgit: 'git-forgit' };
        await binary(action.binary ?? aliases[action.name] ?? action.name);
      }
      if (action.name === 'node') await binary('npm');
    } else if (action.kind === 'app-store' || action.kind === 'dmg') await app(action.app);
    else if (action.kind === 'file') {
      await check(`file:${action.target}`, `Config: ~/${action.target.slice(context.home.length + 1)}`, async () => {
        if (!await exists(action.target)) return { status: 'missing', detail: 'Configuration file not found.' };
        const same = await readFile(action.target, 'utf8') === action.content;
        return { status: same ? 'ok' : 'warning', detail: same ? 'Matches setup template.' : 'File contents differ from the saved template (including formatting/comments). This is not a broken installation. Keep your customizations unless you want to restore the template.' };
      });
    } else if (action.kind === 'fish-plugins') {
      for (const plugin of action.plugins) await check(`plugin:${plugin}`, plugin, async () => {
        const manifestPath = join(context.home, '.config/fish/fish_plugins');
        const manifest = await exists(manifestPath) ? await readFile(manifestPath, 'utf8') : '';
        const installed = manifest.split(/\r?\n/).map(value => value.trim().toLowerCase());
        const file = pluginFiles[plugin];
        const found = installed.includes(plugin.toLowerCase()) && Boolean(file && await exists(join(context.home, '.config/fish', file)));
        return { status: found ? 'ok' : 'missing', detail: found ? 'Listed in Fish manifest and plugin file found (shell not started).' : 'Missing manifest entry or plugin file.' };
      });
    } else if (action.kind === 'extension') {
      await check(`extension:${action.name}`, action.name, async () => {
        const path = join(context.home, '.cursor/extensions/extensions.json');
        if (!await exists(path)) return { status: 'missing', detail: 'Cursor extension registry not found.' };
        const registry = JSON.parse(await readFile(path, 'utf8'));
        const found = Array.isArray(registry) && registry.some(item => item?.identifier?.id?.toLowerCase() === action.name.toLowerCase());
        return { status: found ? 'ok' : 'missing', detail: found ? 'Registered in Cursor (editor not started).' : 'Extension not registered in Cursor.' };
      });
    } else if (action.kind === 'preference' && context.platform === 'darwin') {
      await check(`pref:${action.domain}:${action.key}`, action.label, async () => {
        const result = await run('/usr/bin/defaults', ['read', action.domain, action.key]);
        const expected = action.type === 'bool' ? action.value === 'true' ? '1' : '0' : action.value;
        const same = result.code === 0 && result.stdout.trim() === expected;
        const actual = result.code === 0 ? result.stdout.trim() : 'unset or unreadable';
        return { status: same ? 'ok' : 'warning', detail: same ? 'Matches setup preference.' : `Current value: ${actual}; setup value: ${expected}. This is a preference difference, not an installation failure. No changes made.` };
      });
    }
  }
  return results;
}
