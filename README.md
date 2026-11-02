# mac-setup

My Mac setup, so I don't have to remember everything when I get a new Mac or start fresh on the one I already have :)

Installs my apps and tools, restores Fish and Cursor configs, and sets my macOS preferences. Built with TypeScript, Zod, and Clack.

Want your agent to handle setup? Copy [AGENTS.md](AGENTS.md) into its chat, share this repo, and tell it which modules and terminal you want.

## Install on a new Mac

Open **Terminal** (`Cmd+Space`, then type `Terminal`).

**1. Check Git:**

```sh
git --version
```

If macOS offers to install developer tools, accept and wait for it to finish. If Git is unavailable and no dialog appears, run `xcode-select --install`. These tools include Git; you don't need the full Xcode app.

**2. Clone and preview:**

```sh
git clone https://github.com/imnotannamaria/mac-setup.git ~/mac-setup
cd ~/mac-setup
./install.sh
```

The bootstrap asks before preparing missing Homebrew, Node.js, and npm dependencies. Choose modules, apps, and Warp or Ghostty with the keyboard. Space selects; Enter continues. This run previews the setup.

**3. Install:**

```sh
./install.sh --apply
```

Choose your selection, review, and confirm. Close Cursor if installing its settings. Existing configs are backed up. Finish any logins and permission prompts shown at the end.

Optional: configure your Git identity under [Personal settings](#personal-settings) before applying.

## Other commands

```sh
./install.sh --dry-run --only terminal,editor
./install.sh --apply --only terminal --terminal ghostty
./install.sh --doctor --only terminal --terminal ghostty
./install.sh --help
```

`--dry-run`, `--doctor`, and `--help` won't prepare missing dependencies. Run `./install.sh` first if Node.js 22.16+ or the repo packages are missing.

## What it installs

| Module | Includes |
| --- | --- |
| `apps` | **Browsers:** Dia, Google Chrome. **AI:** Claude, Claude Code CLI, ChatGPT. **Work and personal:** Notion, Spotify, Granola, Slack, Linear, Raycast, Discord, Zoom, WhatsApp, RunCat, TextWarden. Select individual apps in the menu or with `--apps`. |
| `dev` | Node.js (includes npm), Python, uv, Git, GitHub CLI (`gh`), and OrbStack. |
| `terminal` | **App:** Warp or Ghostty. **Shell and prompt:** Fish, Starship. **Tools:** zoxide, fzf, fd, forgit, bat, eza, tmux. **Font:** JetBrains Mono Nerd Font. Restores Fish config, Git/Docker/npm/tmux aliases, and the [plugins below](#fish-plugins). Ghostty also gets its shell and font config; optional Git identity comes from `.env.local`. |
| `editor` | Cursor and JetBrains Mono Nerd Font. Restores editor settings and keybindings, including `Cmd+I` for the agent. Installs Bearded Theme, Material Icon Theme, and Cursor Pyright. |
| `macos` | **Appearance:** dark mode; natural scrolling off. **Finder:** list view, path bar and status bar visible. **Dock:** auto-hide off, icon size 41, minimize-to-app-icon off. |

RunCat uses [mas](https://github.com/mas-cli/mas): sign in to the App Store with an account that already acquired the app. TextWarden uses the [official DMG](https://github.com/PhilipSchmid/textwarden/releases/tag/v0.6.0), pinned to 0.6.0 with SHA-256 verification. Both are skipped if already installed.

Choose Warp or Ghostty in the interactive menu, or pass `--terminal warp` / `--terminal ghostty`. Warp remains the default for unattended runs. Both use Fish + Starship. Ghostty gets a config with Fish and JetBrains Mono Nerd Font Mono; selecting either terminal doesn't uninstall the other.

## Doctor

`--doctor` checks the selected apps, CLI tools, fonts, config files, Fish plugins, Cursor extensions, and macOS preferences. It doesn't start your shell/editor, install dependencies, access the network, or write reports. Missing items return exit code 1; customized configs and differing preferences are warnings. Plugin checks confirm the manifest and files, not runtime behavior. Logins and permissions still need a manual check. Use `./install.sh --doctor` for all modules or `npm run doctor -- --only terminal --terminal ghostty`.

## Personal settings

Ghostty's look is saved in [`config/ghostty/config`](config/ghostty/config): Vesper theme, 18-point font, a 100-column × 26-row window, padding, and the holographic Dock icon. Edit the template to keep your changes for the next setup, or edit the installed `~/.config/ghostty/config.ghostty` for this Mac. Reload Ghostty's configuration after editing; open a new window for size changes. The icon setting doesn't change the Finder icon.

```sh
cp .env.example .env.local
```

Set `MAC_SETUP_GIT_NAME` and `MAC_SETUP_GIT_EMAIL` together, or leave both empty. The terminal module generates a local Fish config for the Git identity helpers. `.env.local` is ignored by Git.

## Fish plugins

| Plugin | What it does | Example |
| --- | --- | --- |
| [Fisher](https://github.com/jorgebucaran/fisher) | Manages Fish plugins. | `fisher list` |
| [done](https://github.com/franciscolourenco/done) | Notifies when a command takes over five seconds and the terminal is out of focus. | Switch apps while a build runs. |
| [autopair.fish](https://github.com/jorgebucaran/autopair.fish) | Adds matching quotes and brackets. | `(` inserts `()`. |
| [puffer-fish](https://github.com/nickeb96/puffer-fish) | Expands history and directory shortcuts. | `!!`: last command; `!$`: last argument; `...`: `../..`. |
| [nvm.fish](https://github.com/jorgebucaran/nvm.fish) | Installs and switches Node.js versions. | `nvm install lts` |
| [fzf.fish](https://github.com/PatrickF1/fzf.fish) | Searches files, history, Git changes, and processes with previews. | `Ctrl+R` searches history. |
| [forgit](https://github.com/wfxr/forgit) | Adds interactive Git selectors. Installed with Homebrew; its default aliases are disabled. | `git forgit log` |
| [sponge](https://github.com/meaningful-ooo/sponge) | Filters failed commands from history, keeping the latest two available for corrections. | Mistyped commands stop cluttering history. |
| [fish-abbreviation-tips](https://github.com/gazorby/fish-abbreviation-tips) | Reminds you when an alias or abbreviation could shorten a command. | Suggests `gs` for `git status`. |

The terminal module installs missing plugins with Fisher and backs up existing Fish state first. It preserves extra plugins and removes the old `jethrokuan/z` plugin if Fisher manages it. Directory jumping uses zoxide instead: `z mac-setup`.

`fzf.fish` uses Homebrew's `fzf`, `fd`, and `bat`. Native `fzf --fish` bindings are disabled to avoid conflicts. Forgit is available through `git forgit`, preserving aliases such as `ga` and `gco`.

## Before applying

Close Cursor. Existing configs are backed up and replaced, not merged. Installed packages and identical files are skipped; symlinked config paths are left untouched and reported. Backups and reports stay in `.local/backups/<run>/`. Restore files from `files/` to their original home-relative paths; preference JSON files record the old values and types. Rollback is manual.

Logins, permissions, Warp's shell/font selection, and login-shell changes still need you. Choose `JetBrainsMono Nerd Font Mono` in Warp; the terminal and editor modules install the font. The setup installs ChatGPT; standalone Codex CLI and legacy Codex desktop are excluded.

The full installation test on a clean Mac is deferred until one is available.

## Development

```sh
npm ci
npm run check
npm test
```

Tests use temporary files and simulated commands. They don't install apps or change macOS preferences.
