import * as prompts from '@clack/prompts';
import pc from 'picocolors';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { appCatalog, loadLocalConfig, moduleIds, moduleLabels, parseOptions, selectionSchema, type ModuleId, type Selection } from './config.ts';
import { buildPlan, describeAction } from './plan.ts';
import { executePlan, type Result } from './runner.ts';

const colors = pc.createColors(pc.isColorSupported && process.env.NO_COLOR === undefined);
const moduleColors: Record<ModuleId, (text: string) => string> = {
  apps: colors.magenta,
  dev: colors.blue,
  terminal: colors.green,
  editor: colors.cyan,
  macos: colors.yellow,
};
const statusColors: Record<Result['status'], (text: string) => string> = {
  installed: colors.green,
  unchanged: colors.cyan,
  failed: colors.red,
  skipped: colors.dim,
  manual: colors.yellow,
};

const root = fileURLToPath(new URL('../', import.meta.url));
// Homebrew paths also cover direct runs from a fresh macOS shell.
process.env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].filter(Boolean).join(':');

function answer<T>(value: T): Exclude<T, symbol> {
  if (prompts.isCancel(value)) { prompts.cancel(colors.yellow('Setup cancelled.')); process.exit(0); }
  return value as Exclude<T, symbol>;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(`mac-setup — bring your setup to a new Mac

  npm run setup -- [options]

  --dry-run         Show the plan without changing anything or making network calls
  --apply           Apply after showing the plan and asking for confirmation
  --yes             Use the default/explicit selection without prompts
                    Also confirms changes when paired with --apply
  --only <modules>  Comma-separated modules: ${moduleIds.join(',')}
  --apps <ids>      Choose apps in the apps module (empty string selects none)
  --terminal <app>  Choose warp or ghostty (default: warp)
  --help, -h        Show this help

App IDs: ${appCatalog.map(app => app.id).join(', ')}

Without --apply, setup only previews. Non-interactive apply requires --yes.
Close Cursor before applying editor settings. Existing files are replaced with backups.
Local Git identity comes from .env.local or MAC_SETUP_GIT_NAME/MAC_SETUP_GIT_EMAIL.
`);
    return;
  }
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !options.yes && !options['dry-run']);
  if (options.apply && !interactive && !options.yes) throw new Error('Non-interactive apply needs --yes. Use --dry-run to preview.');
  prompts.intro(colors.bgCyan(colors.black(colors.bold(' mac-setup '))));
  prompts.log.info(options.apply
    ? colors.yellow('APPLY — review the plan before changing this Mac.')
    : colors.cyan('PREVIEW — no changes will be made.'));
  let selection: Selection = options.selection;
  if (interactive) {
    const modules = answer(await prompts.multiselect({ message: 'What should this Mac get?',
      options: moduleIds.map(value => ({ value, label: moduleColors[value](moduleLabels[value]) })),
      initialValues: selection.modules, required: true,
    }));
    let apps = selection.apps;
    let terminal = selection.terminal;
    if (modules.includes('terminal') && options.terminal === undefined) {
      terminal = answer(await prompts.select({ message: 'Which terminal should this Mac use?',
        options: [
          { value: 'warp' as const, label: 'Warp + Fish + Starship' },
          { value: 'ghostty' as const, label: 'Ghostty + Fish + Starship' },
        ], initialValue: terminal ?? 'warp',
      }));
    }
    if (modules.includes('apps')) apps = answer(await prompts.multiselect({ message: 'Choose your apps',
      options: appCatalog.map(app => ({ value: app.id as string, label: app.label })),
      initialValues: apps, required: false,
    }));
    selection = selectionSchema.parse({ modules, apps, terminal });
  }
  const local = loadLocalConfig(root);
  const plan = buildPlan(selection, local, root, homedir());
  for (const module of selection.modules) {
    prompts.note(plan.filter(action => action.module === module).map(action => {
      const text = describeAction(action);
      return action.kind === 'manual' ? colors.yellow(text) : moduleColors[module](text);
    }).join('\n'), colors.bold(moduleColors[module](moduleLabels[module])));
  }
  if (!options.apply) {
    prompts.outro(colors.cyan('Preview only. Use --apply when you want to make these changes.'));
    return;
  }
  if (interactive && !answer(await prompts.confirm({ message: 'Apply this plan? Existing configs will be backed up and replaced.', initialValue: false }))) {
    prompts.outro(colors.dim('No changes made.')); return;
  }
  const spinner = prompts.spinner();
  spinner.start(colors.cyan('Applying setup. Package downloads may take a while.'));
  let execution;
  try {
    execution = await executePlan(plan, { root, home: homedir(), arch: process.arch, platform: process.platform }, result => {
      spinner.message(`${statusColors[result.status](result.status)}: ${result.label}`);
    });
  } finally { spinner.stop('Execution finished.'); }
  const { results, backupRoot } = execution;
  const count = (status: string) => results.filter(result => result.status === status).length;
  const statuses = ['installed', 'unchanged', 'failed', 'skipped', 'manual'] as const;
  prompts.note(statuses.map(status => statusColors[status](`${status}: ${count(status)}`)).join('\n'), colors.bold('Results'));
  for (const result of results.filter(result => result.status === 'failed')) prompts.log.error(colors.red(`${result.label}: ${result.detail}`));
  const pending = results.filter(result => result.status === 'manual');
  if (pending.length) prompts.note(colors.yellow(pending.map(result => result.detail).join('\n\n')), colors.bold(colors.yellow('Finish manually')));
  prompts.log.info(`${colors.dim('Backups and report:')} ${colors.cyan(backupRoot)}`);
  prompts.outro(count('failed')
    ? colors.red('Some steps failed. Fix the issue and rerun; unchanged files and installed packages are skipped.')
    : colors.green('Setup finished. Check the manual steps above.'));
  if (count('failed')) process.exitCode = 1;
}

main().catch(error => {
  prompts.log.error(colors.red(error instanceof Error ? error.message : 'Unexpected error.'));
  process.exitCode = 1;
});
