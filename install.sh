#!/bin/bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
READ_ONLY=false
ASSUME_YES=false
APPLY=false
DRY_RUN=false
ONLY_SELECTION='apps,dev,terminal,editor,macos'
APPS_SPECIFIED=false
parse_bootstrap_options() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dry-run) READ_ONLY=true; DRY_RUN=true ;;
      --help|-h) READ_ONLY=true ;;
      --yes) ASSUME_YES=true ;;
      --apply) APPLY=true ;;
      --only|--apps)
        if [ "$#" -lt 2 ]; then echo "Missing value for $1" >&2; exit 1; fi
        case "$2" in --*) echo "Missing value for $1" >&2; exit 1 ;; esac
        if [ "$1" = --only ]; then ONLY_SELECTION="$2"; else APPS_SPECIFIED=true; fi
        shift ;;
      --only=*) ONLY_SELECTION="${1#--only=}" ;;
      --apps=*) APPS_SPECIFIED=true ;;
      *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
    shift
  done
}
parse_bootstrap_options "$@"
if [ "$APPLY" = true ] && [ "$DRY_RUN" = true ]; then
  echo 'Choose --apply or --dry-run, not both.' >&2; exit 1
fi
MODULE_PATTERN='^(apps|dev|terminal|editor|macos)(,(apps|dev|terminal|editor|macos))*$'
if [[ ! "$ONLY_SELECTION" =~ $MODULE_PATTERN ]]; then
  echo 'Invalid module selection.' >&2; exit 1
fi
if [ "$APPS_SPECIFIED" = true ]; then
  case ",$ONLY_SELECTION," in *,apps,*) ;; *) echo '--apps requires the apps module.' >&2; exit 1 ;; esac
fi

node_ready() {
  command -v node >/dev/null 2>&1 && node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major > 22 || (major === 22 && minor >= 16) ? 0 : 1);
  '
}

confirm_bootstrap() {
  if [ "$ASSUME_YES" = true ] && [ "$APPLY" = true ]; then return; fi
  if [ ! -t 0 ]; then
    echo 'Bootstrap needs confirmation. Run interactively, or use --apply --yes.' >&2
    exit 1
  fi
  read -r -p 'Prepare Homebrew/Node as needed and install repo dependencies? [y/N] ' reply
  case "$reply" in y|Y|yes|YES) ;; *) echo 'Stopped. No bootstrap changes made.'; exit 0 ;; esac
}

NEEDS_BREW=false
if [ "$ONLY_SELECTION" != macos ] && [ "$APPLY" = true ] && [ "$(uname -s)" = Darwin ] && ! command -v brew >/dev/null 2>&1; then
  NEEDS_BREW=true
fi

if ! node_ready || [ ! -x "$ROOT/node_modules/.bin/tsx" ] || [ "$NEEDS_BREW" = true ]; then
  if [ "$READ_ONLY" = true ]; then
    echo 'Preview needs Node >=22.16 and repo dependencies. No dependencies were installed.' >&2
    echo 'Run ./install.sh interactively to prepare them, then retry this command.' >&2
    exit 1
  fi
  if [ "$(uname -s)" != Darwin ]; then
    echo 'Bootstrap supports macOS only. On other systems, install Node >=22.16 and run npm ci for preview/tests.' >&2
    exit 1
  fi
  confirm_bootstrap
  if ! node_ready || [ "$NEEDS_BREW" = true ]; then
    if ! xcode-select -p >/dev/null 2>&1; then
      echo 'Install Apple Command Line Tools with xcode-select --install, then rerun.' >&2
      exit 1
    fi
    if ! command -v brew >/dev/null 2>&1; then
      BREW_SCRIPT="$(mktemp -t mac-setup-homebrew)"
      trap 'rm -f "$BREW_SCRIPT"' EXIT
      curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 \
        https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$BREW_SCRIPT"
      /bin/bash "$BREW_SCRIPT"
      rm -f "$BREW_SCRIPT"
      trap - EXIT
    fi
    if ! node_ready; then
      if brew list --formula node >/dev/null 2>&1; then brew upgrade node; else brew install node; fi
    fi
  fi
  cd "$ROOT"
  npm ci --no-fund
fi

cd "$ROOT"
exec node --import tsx src/cli.ts "$@"
