# RUSTC_WRAPPER for local dev shells: every compile goes through kache.
#
# An incremental unit (a workspace crate) that cargo recompiles into a target/
# that already holds its output was edited, or its inputs were, so it gets
# incremental state, which makes the next edit of it fast. Everything else,
# such as a new worktree's first build or a build after target/ was deleted,
# is served from kache's shared cache.
# Measured on the service build: edits after the first take ~31s instead of
# ~180s, while a new worktree still builds in ~108s instead of ~300s.
#
# Cargo calls this as `<wrapper> <rustc> <rustc args...>`. An explicit
# KACHE_PRESERVE_INCREMENTAL in the environment wins.
name=
extra=
incremental=
out_dir=
prev=
for arg in "$@"; do
  case "$prev" in
    --crate-name) name=$arg ;;
    --out-dir) out_dir=$arg ;;
    -C)
      case "$arg" in
        extra-filename=*) extra=${arg#extra-filename=} ;;
        incremental=*) incremental=1 ;;
      esac
      ;;
  esac
  case "$arg" in
    -Cextra-filename=*) extra=${arg#-Cextra-filename=} ;;
    -Cincremental=*) incremental=1 ;;
  esac
  prev=$arg
done
if [ -z "${KACHE_PRESERVE_INCREMENTAL+set}" ] && [ -n "$incremental" ] && [ -n "$name" ] && [ -n "$extra" ] && [ -n "$out_dir" ]; then
  shopt -s nullglob
  built=("$out_dir"/*"$name$extra"*)
  if [ ${#built[@]} -gt 0 ]; then
    export KACHE_PRESERVE_INCREMENTAL=true
  fi
fi
exec @kache@ "$@"
