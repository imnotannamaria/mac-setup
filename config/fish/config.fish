# Public template. No installation or package downloads happen at shell startup.
# Fish loads conf.d/mac-setup.local.fish separately for personal variables.
if test -x /opt/homebrew/bin/brew
    /opt/homebrew/bin/brew shellenv | source
else if test -x /usr/local/bin/brew
    /usr/local/bin/brew shellenv | source
end

fish_add_path "$HOME/.local/bin"

if status is-interactive
    set -g fish_greeting ''
    set -gx EDITOR cursor

    if type -q starship
        starship init fish | source
    end
    if type -q zoxide
        zoxide init fish | source
        alias cd='z'
    end
    if type -q fzf
        fzf --fish | source
    end
    if type -q bat
        alias cat='bat'
    end
    if type -q eza
        alias ls='eza --icons'
        alias ll='eza --long --header --git --icons'
        alias la='eza --long --header --git --all --icons'
        alias tree='eza --tree --level=2 --icons'
    end

    abbr -a .. 'cd ..'
    abbr -a ... 'cd ../..'
    abbr -a .... 'cd ../../..'
    abbr -a ..... 'cd ../../../..'

    alias g='git'
    alias gcl='git clone'
    alias gs='git status'
    alias ga='git add .'
    alias gc='git commit -m'
    alias gp='git push'
    alias gpll='git pull'
    alias gl='git log'
    alias gco='git checkout'
    alias gb='git branch'
    alias g-clean-list='git clean -n -d -x'
    # Destructive: removes untracked AND ignored files when explicitly invoked.
    alias g-clean-rm='git clean -f -d -x'

    alias db='docker build -t'
    alias dr='docker run -it --rm'
    # Destructive: prunes unused Docker resources, including eligible volumes.
    alias dkill='docker system prune -a -f --volumes'
    alias dcu='docker compose up'
    # Preserve the full Compose output and exit status.
    alias dcub='docker compose up -d --build'
    alias dps='docker ps -a'
    alias ds='docker stop'

    alias nrd='npm run dev'
    alias nrb='npm run build'
    alias nrl='npm run lint'
    alias tmux-new='tmux new -s task'
    alias tmux-kill='tmux kill-session -t task'

    function pr-git-name --description 'Set local repository Git name'
        if not set -q MAC_SETUP_GIT_NAME; or test -z "$MAC_SETUP_GIT_NAME"
            echo 'Configure MAC_SETUP_GIT_NAME locally first.' >&2
            return 1
        end
        git config --local user.name "$MAC_SETUP_GIT_NAME"
    end

    function pr-git-email --description 'Set local repository Git email'
        if not set -q MAC_SETUP_GIT_EMAIL; or test -z "$MAC_SETUP_GIT_EMAIL"
            echo 'Configure MAC_SETUP_GIT_EMAIL locally first.' >&2
            return 1
        end
        git config --local user.email "$MAC_SETUP_GIT_EMAIL"
    end

    function pr-commit --description 'Commit using locally configured author identity'
        if not set -q MAC_SETUP_GIT_NAME; or test -z "$MAC_SETUP_GIT_NAME"
            echo 'Configure MAC_SETUP_GIT_NAME locally first.' >&2
            return 1
        end
        if not set -q MAC_SETUP_GIT_EMAIL; or test -z "$MAC_SETUP_GIT_EMAIL"
            echo 'Configure MAC_SETUP_GIT_EMAIL locally first.' >&2
            return 1
        end
        git commit --author="$MAC_SETUP_GIT_NAME <$MAC_SETUP_GIT_EMAIL>" -m $argv
    end
end

if test -f "$HOME/.orbstack/shell/init2.fish"
    source "$HOME/.orbstack/shell/init2.fish"
end
