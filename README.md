# mac-setup

My Mac setup, so I don't have to remember everything when I get a new one :)

The idea is to install my apps, bring back my terminal and editor settings, and set a few macOS preferences with one command.

Still a work in progress. Right now, this repo has reviewed Fish and Cursor configs. The installer doesn't exist yet.

## The setup

- Warp + Fish + Starship.
- Node.js + npm, Python + uv, and OrbStack.
- Cursor with Bearded Theme, Material Icon Theme, and Cursor Pyright for Python.
- JetBrains Mono Nerd Font for the editor and terminal.
- My apps and macOS preferences, selected during setup.

OrbStack handles containers. Docker Desktop isn't part of this setup.

## What's here

[`config/fish/`](config/fish/) has my shell config, aliases, plugin list, and a template for local Git identity settings. Some aliases delete files or Docker resources, so read them before using them.

[`config/cursor/`](config/cursor/) has editor settings, keybindings, and the extension list. I kept the list small instead of bringing every extension from my current Mac.

The configs are templates for now. Nothing is applied automatically.

## Fish plugins

These are the plugins listed in [`fish_plugins`](config/fish/fish_plugins). Keeping the list here makes it easier to remember what each one does before bringing it to another Mac.

| Plugin | What it does | Example |
| --- | --- | --- |
| [Fisher](https://github.com/jorgebucaran/fisher) | Installs, updates, and removes Fish plugins. Keeps the selection in `fish_plugins`. | `fisher list` shows installed plugins. |
| [done](https://github.com/franciscolourenco/done) | Sends a notification when a command takes more than five seconds and the terminal is out of focus. | Get notified when a build finishes while using another app. |
| [z](https://github.com/jethrokuan/z) | Remembers visited directories and finds matches by frequency and recency. | `z mac-setup` jumps to a matching directory. |
| [autopair.fish](https://github.com/jorgebucaran/autopair.fish) | Inserts matching quotes, parentheses, brackets, and braces. Handles deleting empty pairs and skipping existing closing characters. | Type `(` to get `()` with the cursor in the middle. |
| [puffer-fish](https://github.com/nickeb96/puffer-fish) | Expands shortcuts for command history and parent-directory paths as I type. | `!!`: previous command; `!$`: last argument; `!*`: all arguments; `...`: `../..`. |
| [nvm.fish](https://github.com/jorgebucaran/nvm.fish) | Installs and switches Node.js versions inside Fish, with support for `.nvmrc` and `.node-version`. | `nvm install lts` installs the latest LTS release; `nvm use` selects an installed project version. |

`z` overlaps with zoxide, which the Fish config also initializes. Both came from my current setup; choosing one is still pending before the installer is built.

## The font

Setting a font name in Cursor doesn't install it. On a Mac with Homebrew, install the [Nerd Font version of JetBrains Mono](https://formulae.brew.sh/cask/font-jetbrains-mono-nerd-font):

```sh
brew install --cask font-jetbrains-mono-nerd-font
```

The Cursor config uses `JetBrainsMono Nerd Font` for the editor and `JetBrainsMono Nerd Font Mono` for the terminal. Select the Mono version in Warp too. The Nerd Font version includes the icons used by the shell tools.

## Personal settings

This repo is public. Names, emails, credentials, and machine-specific values belong in local files.

`.env.example` lists the variables planned for the CLI. `.env.local` is ignored by Git, but the CLI doesn't read it yet. Fish has its own local config example in `config/fish/`; it doesn't source the env file.

## Next

Build an interactive installer with TypeScript and Zod: choose what to install, preview the changes, back up existing configs, and get a summary when it finishes.

The goal is to make setting up my next Mac less work. Logins and macOS permission prompts will still need me.
