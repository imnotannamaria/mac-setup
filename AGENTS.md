# Set up a Mac with this repo

Use the existing installer to install apps and restore the user's setup. Read README.md first and run commands from the repo root.

1. Use the modules and apps the user requested. If unclear, ask which modules they want and whether to use Warp or Ghostty. Both use Fish + Starship.
2. Check macOS and prerequisites. The CLI needs Node.js 22.16+ and repo dependencies. `./install.sh` can prepare missing dependencies with the user's authorization; Apple Command Line Tools may need to be installed first.
3. Preview the selected setup and explain what it changes. Dry-run never installs missing dependencies:

   ```sh
   ./install.sh --dry-run --only terminal --terminal ghostty
   ```

4. When the user has requested installation, apply that selection. For non-interactive execution, use `--yes` only with the selection the user authorized:

   ```sh
   ./install.sh --apply --yes --only terminal --terminal ghostty
   ```

Replace the example selection as needed. Modules: `apps`, `dev`, `terminal`, `editor`, `macos`. Use `--apps` for a comma-separated app selection; `./install.sh --help` lists the IDs.

Keep personal values in `.env.local`, using `.env.example` as the template. Don't print credentials or commit local files. Close Cursor before replacing its settings. Preserve the installer's backups and report in `.local/backups/`.

After execution, report installed, unchanged, failed, and pending items. Let the user complete logins and macOS permission prompts. Never describe a preview or simulated test as a completed installation.

For code changes, run `npm run check` and `npm test`. For documentation-only changes, check links and verify the text matches the current installer.
