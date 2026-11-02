import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appCatalog, type LocalConfig, type ModuleId, type Selection } from './config.ts';

type Base = { module: ModuleId; label: string };
export type Action = Base & (
  | { kind: 'package'; name: string; cask: boolean; app?: string; binary?: string }
  | { kind: 'app-store'; app: string; storeId: string }
  | { kind: 'dmg'; app: string; url: string; sha256: string; version: string }
  | { kind: 'file'; target: string; content: string; private?: boolean }
  | { kind: 'extension'; name: string }
  | { kind: 'fish-plugins'; plugins: string[]; remove: string[] }
  | { kind: 'preference'; domain: string; key: string; type: 'bool' | 'int' | 'string'; value: string }
  | { kind: 'manual'; detail: string }
);

// Fish single-quoted strings only need backslashes and single quotes escaped.
export function fishQuote(value: string): string {
  return "'" + value.replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'";
}

export function buildPlan(selection: Selection, local: LocalConfig, root: string, home: string): Action[] {
  const actions: Action[] = [];
  const has = (id: ModuleId) => selection.modules.includes(id);
  const pkg = (module: ModuleId, name: string, cask = false, app?: string) => {
    actions.push({ module, kind: 'package', name, cask, app, label: `Install ${name}` });
  };
  const file = (module: ModuleId, source: string, target: string) => actions.push({
    module, kind: 'file', target: join(home, target),
    content: readFileSync(join(root, source), 'utf8'), label: `Write ~/${target} (back up if changed)`,
  });
  const manual = (module: ModuleId, detail: string) => actions.push({ module, kind: 'manual', label: 'Manual step', detail });

  if (has('apps')) {
    for (const app of appCatalog.filter(app => selection.apps.includes(app.id))) {
      if ('storeId' in app) actions.push({ module: 'apps', kind: 'app-store', app: app.app,
        storeId: app.storeId, label: `Install ${app.label}` });
      else if ('sha256' in app) actions.push({ module: 'apps', kind: 'dmg', app: app.app,
        url: app.url, sha256: app.sha256, version: app.version, label: `Install ${app.label} ${app.version}` });
      else actions.push({ module: 'apps', kind: 'package', name: app.cask, cask: true,
        app: 'app' in app ? app.app : undefined,
        binary: 'binary' in app ? app.binary : undefined,
        label: `Install ${app.label}` });
    }
    manual('apps', 'Sign in to your apps and grant the macOS permissions you want to allow.');
  }
  if (has('dev')) {
    for (const name of ['node', 'python', 'uv', 'git', 'gh']) pkg('dev', name);
    pkg('dev', 'orbstack', true, 'OrbStack.app');
    manual('dev', 'Open OrbStack once to finish setup. Authenticate GitHub CLI with gh auth login when ready.');
  }
  if (has('terminal')) {
    const terminal = selection.terminal ?? 'warp';
    pkg('terminal', terminal, true, terminal === 'ghostty' ? 'Ghostty.app' : 'Warp.app');
    pkg('terminal', 'font-jetbrains-mono-nerd-font', true);
    for (const name of ['fish', 'starship', 'zoxide', 'fzf', 'fd', 'forgit', 'bat', 'eza', 'tmux']) pkg('terminal', name);
    file('terminal', 'config/fish/config.fish', '.config/fish/config.fish');
    file('terminal', 'config/fish/00-mac-setup-plugins.fish', '.config/fish/conf.d/00-mac-setup-plugins.fish');
    const plugins = readFileSync(join(root, 'config/fish/fish_plugins'), 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!plugins.length || plugins.some(plugin => !/^[\w.-]+\/[\w.-]+$/.test(plugin))) throw new Error('Invalid Fish plugin list.');
    actions.push({ module: 'terminal', kind: 'fish-plugins', plugins, remove: ['jethrokuan/z'],
      label: 'Install Fish plugins with Fisher (back up existing Fish state first)' });
    if (local.MAC_SETUP_GIT_NAME) actions.push({ module: 'terminal', kind: 'file', private: true,
      target: join(home, '.config/fish/conf.d/mac-setup.local.fish'),
      content: `# Generated locally. Do not publish.\nset -gx MAC_SETUP_GIT_NAME ${fishQuote(local.MAC_SETUP_GIT_NAME)}\nset -gx MAC_SETUP_GIT_EMAIL ${fishQuote(local.MAC_SETUP_GIT_EMAIL)}\n`,
      label: 'Write local Fish Git identity (values hidden; back up if changed)',
    });
    if (terminal === 'ghostty') {
      const fishPath = process.arch === 'arm64' ? '/opt/homebrew/bin/fish' : '/usr/local/bin/fish';
      actions.push({ module: 'terminal', kind: 'file', target: join(home, '.config/ghostty/config.ghostty'),
        content: readFileSync(join(root, 'config/ghostty/config'), 'utf8').replace('{{FISH_PATH}}', fishPath),
        label: 'Configure Ghostty with Fish and JetBrains Mono Nerd Font (back up if changed)',
      });
      manual('terminal', 'Open Ghostty after setup. It launches Fish with your Starship prompt. The system login shell is unchanged.');
    } else {
      manual('terminal', 'In Warp, select Fish as the shell and JetBrainsMono Nerd Font Mono as the font. Login shell and Warp preferences are left for manual setup.');
    }
  }
  if (has('editor')) {
    pkg('editor', 'cursor', true, 'Cursor.app');
    pkg('editor', 'font-jetbrains-mono-nerd-font', true);
    file('editor', 'config/cursor/settings.json', 'Library/Application Support/Cursor/User/settings.json');
    file('editor', 'config/cursor/keybindings.json', 'Library/Application Support/Cursor/User/keybindings.json');
    const extensions: string[] = JSON.parse(readFileSync(join(root, 'config/cursor/extensions.json'), 'utf8'));
    for (const name of extensions) {
      if (!/^[a-z0-9-]+\.[a-z0-9-]+$/i.test(name)) throw new Error('Invalid extension identifier in config.');
      actions.push({ module: 'editor', kind: 'extension', name, label: `Install extension ${name}` });
    }
    manual('editor', 'Close Cursor before applying settings; reopen it after setup. Existing settings are backed up and replaced, not merged.');
  }
  if (has('macos')) {
    const prefs = [
      ['NSGlobalDomain', 'AppleInterfaceStyle', 'string', 'Dark'],
      ['NSGlobalDomain', 'com.apple.swipescrolldirection', 'bool', 'false'],
      ['com.apple.finder', 'FXPreferredViewStyle', 'string', 'Nlsv'],
      ['com.apple.finder', 'ShowPathbar', 'bool', 'true'],
      ['com.apple.finder', 'ShowStatusBar', 'bool', 'true'],
      ['com.apple.dock', 'autohide', 'bool', 'false'],
      ['com.apple.dock', 'tilesize', 'int', '41'],
      ['com.apple.dock', 'minimize-to-application', 'bool', 'false'],
    ] as const;
    for (const [domain, key, type, value] of prefs) actions.push({ module: 'macos', kind: 'preference',
      domain, key, type, value, label: `${domain}: ${key} = ${value}` });
    manual('macos', 'Some preferences need Finder/Dock to restart or a logout. No apps are restarted automatically.');
  }
  return actions;
}

export function describeAction(action: Action): string {
  if (action.kind === 'manual') return `Manual: ${action.detail}`;
  if (action.kind === 'package') return `${action.label} — brew install ${action.cask ? '--cask ' : ''}${action.name} (skip if present)`;
  if (action.kind === 'app-store') return `${action.label} — mas install ${action.storeId} (install mas if missing; App Store sign-in and previous acquisition required; skip if present)`;
  if (action.kind === 'dmg') return `${action.label} — download official DMG, verify SHA-256, copy to /Applications (skip if present)`;
  if (action.kind === 'fish-plugins') return `${action.label}\nPlugins: ${action.plugins.join(', ')}\nRemove legacy jethrokuan/z if managed by Fisher; keep zoxide. Unrelated plugins are preserved.`;
  return action.label;
}
