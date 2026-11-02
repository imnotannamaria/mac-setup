import { readFileSync } from 'node:fs';
import { parseArgs, parseEnv } from 'node:util';
import { join } from 'node:path';
import { z } from 'zod';

export const moduleIds = ['apps', 'dev', 'terminal', 'editor', 'macos'] as const;
export const moduleSchema = z.enum(moduleIds);
export type ModuleId = z.infer<typeof moduleSchema>;
export const moduleLabels: Record<ModuleId, string> = {
  apps: 'Apps — browsers, AI, work and personal apps',
  dev: 'Development — Node/npm, Python/uv, Git and OrbStack',
  terminal: 'Terminal — Warp or Ghostty, Fish, Starship, tools and config',
  editor: 'Editor — Cursor, font, settings and three extensions',
  macos: 'macOS — appearance, scrolling, Finder and Dock',
};

export const appCatalog = [
  { id: 'dia', label: 'Dia', cask: 'thebrowsercompany-dia', app: 'Dia.app' },
  { id: 'chrome', label: 'Google Chrome', cask: 'google-chrome', app: 'Google Chrome.app' },
  { id: 'claude', label: 'Claude', cask: 'claude', app: 'Claude.app' },
  { id: 'claude-code', label: 'Claude Code CLI', cask: 'claude-code', binary: 'claude' },
  { id: 'chatgpt', label: 'ChatGPT', cask: 'chatgpt', app: 'ChatGPT.app' },
  { id: 'codex', label: 'Codex CLI', cask: 'codex', binary: 'codex' },
  { id: 'codex-app', label: 'Codex desktop', cask: 'codex-app', app: 'Codex.app' },
  { id: 'notion', label: 'Notion', cask: 'notion', app: 'Notion.app' },
  { id: 'spotify', label: 'Spotify', cask: 'spotify', app: 'Spotify.app' },
  { id: 'granola', label: 'Granola', cask: 'granola', app: 'Granola.app' },
  { id: 'slack', label: 'Slack', cask: 'slack', app: 'Slack.app' },
  { id: 'linear', label: 'Linear', cask: 'linear', app: 'Linear.app' },
  { id: 'raycast', label: 'Raycast', cask: 'raycast', app: 'Raycast.app' },
  { id: 'discord', label: 'Discord', cask: 'discord', app: 'Discord.app' },
  { id: 'zoom', label: 'Zoom', cask: 'zoom', app: 'zoom.us.app' },
  { id: 'whatsapp', label: 'WhatsApp', cask: 'whatsapp', app: 'WhatsApp.app' },
  { id: 'runcat', label: 'RunCat', app: 'RunCat.app', storeId: '1429033973' },
  { id: 'textwarden', label: 'TextWarden', app: 'TextWarden.app',
    version: '0.6.0',
    url: 'https://github.com/PhilipSchmid/textwarden/releases/download/v0.6.0/TextWarden-0.6.0-Universal.dmg',
    sha256: 'be5fb2ce7044d16dbc55b751963fd624a0fb1925211f76995b74284e0969ee94' },
] as const;

export const selectionSchema = z.object({
  modules: z.array(moduleSchema).min(1),
  terminal: z.enum(['warp', 'ghostty']).optional(),
  apps: z.array(z.string().refine(id => appCatalog.some(app => app.id === id), 'Unknown app')),
});
export type Selection = z.infer<typeof selectionSchema>;

const localSchema = z.object({
  MAC_SETUP_GIT_NAME: z.string().trim().max(200).refine(value => !/[\r\n\0]/.test(value)).default(''),
  MAC_SETUP_GIT_EMAIL: z.union([z.email(), z.literal('')]).default(''),
}).refine(data => Boolean(data.MAC_SETUP_GIT_NAME) === Boolean(data.MAC_SETUP_GIT_EMAIL), {
  message: 'Set both MAC_SETUP_GIT_NAME and MAC_SETUP_GIT_EMAIL, or leave both empty.',
});
export type LocalConfig = z.infer<typeof localSchema>;

export function loadLocalConfig(root: string, env: NodeJS.ProcessEnv = process.env): LocalConfig {
  let file: Record<string, string | undefined> = {};
  try { file = parseEnv(readFileSync(join(root, '.env.local'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const result = localSchema.safeParse({
    MAC_SETUP_GIT_NAME: env.MAC_SETUP_GIT_NAME ?? file.MAC_SETUP_GIT_NAME,
    MAC_SETUP_GIT_EMAIL: env.MAC_SETUP_GIT_EMAIL ?? file.MAC_SETUP_GIT_EMAIL,
  });
  // Never include supplied values in validation output.
  if (!result.success) throw new Error('Invalid local Git identity. Set a name and valid email together in .env.local.');
  return result.data;
}

export function parseOptions(args: string[]) {
  const { values } = parseArgs({ args, strict: true, options: {
    'dry-run': { type: 'boolean', default: false },
    apply: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    only: { type: 'string' }, apps: { type: 'string' }, terminal: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  } });
  if (values.apply && values['dry-run']) throw new Error('Choose --apply or --dry-run, not both.');
  const modules = values.only === undefined ? [...moduleIds] : values.only.split(',');
  const apps = values.apps === undefined ? appCatalog.map(app => app.id) : values.apps.split(',').filter(Boolean);
  const parsed = selectionSchema.safeParse({ modules, apps, terminal: values.terminal ?? 'warp' });
  if (!parsed.success) throw new Error('Invalid module or app selection. Run with --help for available names.');
  if (values.apps !== undefined && !parsed.data.modules.includes('apps')) throw new Error('--apps requires the apps module.');
  if (values.terminal !== undefined && !parsed.data.modules.includes('terminal')) throw new Error('--terminal requires the terminal module.');
  return { ...values, selection: parsed.data };
}
