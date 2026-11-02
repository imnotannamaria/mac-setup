# mac-setup

My Mac setup, so I don't have to remember everything when I get a new Mac or start fresh on the one I already have :)

Installs my apps and tools, restores Fish and Cursor configs, and sets my macOS preferences. Built with TypeScript, Zod, and Clack.

Want your agent to handle setup? Copy [AGENTS.md](AGENTS.md) into its chat, share this repo, and tell it which modules and terminal you want.

## Run

From a local checkout:

```sh
./install.sh                              # Choose modules and preview
./install.sh --apply                      # Review, confirm, and install
./install.sh --dry-run --only terminal,editor
./install.sh --apply --only terminal --terminal ghostty
./install.sh --help
```

Use Space to select and Enter to continue. The bootstrap asks before installing missing dependencies. Preview needs Node.js 22.16+ and repo dependencies already installed; it won't install them for you. Apple Command Line Tools are required for bootstrap.

| Module | Includes |
| --- | --- |
| `apps` | **Browsers:** Dia, Google Chrome. **AI:** Claude, Claude Code CLI, ChatGPT, Codex CLI, Codex desktop. **Work and personal:** Notion, Spotify, Granola, Slack, Linear, Raycast, Discord, Zoom, WhatsApp, RunCat, TextWarden. Select individual apps in the menu or with `--apps`. |
| `dev` | Node.js (includes npm), Python, uv, Git, GitHub CLI (`gh`), and OrbStack. |
| `terminal` | **App:** Warp or Ghostty. **Shell and prompt:** Fish, Starship. **Tools:** zoxide, fzf, fd, forgit, bat, eza, tmux. **Font:** JetBrains Mono Nerd Font. Restores Fish config, Git/Docker/npm/tmux aliases, and the [plugins below](#fish-plugins). Ghostty also gets its shell and font config; optional Git identity comes from `.env.local`. |
| `editor` | Cursor and JetBrains Mono Nerd Font. Restores editor settings and keybindings, including `Cmd+I` for the agent. Installs Bearded Theme, Material Icon Theme, and Cursor Pyright. |
| `macos` | **Appearance:** dark mode; natural scrolling off. **Finder:** list view, path bar and status bar visible. **Dock:** auto-hide off, icon size 41, minimize-to-app-icon off. |

RunCat uses [mas](https://github.com/mas-cli/mas): sign in to the App Store with an account that already acquired the app. TextWarden uses the [official DMG](https://github.com/PhilipSchmid/textwarden/releases/tag/v0.6.0), pinned to 0.6.0 with SHA-256 verification. Both are skipped if already installed.

Choose Warp or Ghostty in the interactive menu, or pass `--terminal warp` / `--terminal ghostty`. Warp remains the default for unattended runs. Both use Fish + Starship. Ghostty gets a config with Fish and JetBrains Mono Nerd Font Mono; selecting either terminal doesn't uninstall the other.

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

Logins, permissions, Warp's shell/font selection, and login-shell changes still need you. Choose `JetBrainsMono Nerd Font Mono` in Warp; the terminal and editor modules install the font. Codex CLI (`codex`) and desktop (`codex-app`) are separate app selections. Homebrew currently marks [codex-app](https://formulae.brew.sh/cask/codex-app) as deprecated, but still allows installation.

The full installation test on a clean Mac is deferred until one is available.

## Development

```sh
npm ci
npm run check
npm test
```

Tests use temporary files and simulated commands. They don't install apps or change macOS preferences.
