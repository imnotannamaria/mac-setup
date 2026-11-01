# Called by the CLI in a dedicated Fish process, never at shell startup.
# argv: verified Fisher bootstrap, operation, plugin identifiers...
if test (count $argv) -lt 2
    echo 'Missing Fisher bootstrap or operation.' >&2
    exit 1
end

if set -q fisher_path; and test "$fisher_path" != "$__fish_config_dir"
    echo 'Custom fisher_path detected. Migrate it to the standard Fish config directory first.' >&2
    exit 1
end

# Existing Fisher metadata may refer to files outside the backed-up directory.
# Refuse to remove or overwrite those files.
for variable in (set --names --universal | string match '_fisher_*_files')
    for file in $$variable
        set -l expanded (string replace --regex '^~/' "$HOME/" -- "$file")
        set -l normalized (path normalize -- "$expanded")
        set -l prefix "$__fish_config_dir/"
        if test (string sub --length (string length -- "$prefix") -- "$normalized") != "$prefix"
            echo 'Fisher manages files outside the standard config directory. Migrate them first.' >&2
            exit 1
        end
    end
end

# Skip Fisher's legacy migration hook; this installer only changes backed-up state.
set -g _fisher_upgraded_to_4_4 1
source "$argv[1]"; or exit 1
set -g fisher_path "$__fish_config_dir"
set -e argv[1]
if test "$argv[1]" = list
    fisher list
    set -l result $status
    # Fisher returns 1 for an empty plugin list, which is valid on a fresh Mac.
    if test $result -eq 1
        exit 0
    end
    exit $result
end
fisher $argv
