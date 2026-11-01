# Load before other plugin conf.d files. Keep existing Git aliases unchanged.
set -gx FORGIT_NO_ALIASES 1

if status is-interactive
    set -l brew_prefix /opt/homebrew
    if not test -d "$brew_prefix"
        set brew_prefix /usr/local
    end
    set -l forgit_plugin "$brew_prefix/opt/forgit/share/forgit/forgit.plugin.fish"
    if test -f "$forgit_plugin"
        source "$forgit_plugin"
    end
end
