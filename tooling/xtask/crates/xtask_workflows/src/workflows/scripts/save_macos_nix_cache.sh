set -euo pipefail
export LC_ALL=C

roots_file="$RUNNER_TEMP/desktop-cache-roots"
if [ ! -s "$roots_file" ]; then
  exit 0
fi

cache_root="${DESKTOP_NIX_CACHE_ROOT:?}"
cache_dir="${DESKTOP_NIX_CACHE_DIR:?}"
toolchain_key="${cache_dir#"$cache_root/"}"
if [ "${#toolchain_key}" -ne 64 ] || [[ "$toolchain_key" == *[!0-9a-f]* ]] \
  || [ "$cache_dir" != "$cache_root/$toolchain_key" ] \
  || [ -L "$cache_dir" ] || [ -L "$cache_dir/nar" ]; then
  echo "Refusing to prune an unexpected macOS Nix cache directory: $cache_dir" >&2
  exit 1
fi

work_dir=$(mktemp -d "$RUNNER_TEMP/desktop-cache-prune.XXXXXX")
trap 'rm -rf "$work_dir"' EXIT
shopt -s nullglob dotglob

report_size() {
  cache_size_kib=$(du -sk "$cache_root/" | awk '{print $1}')
  local message
  message=$(awk -v phase="$1" -v kib="$cache_size_kib" \
    'BEGIN {printf "macOS Nix cache %s: %.2f GiB", phase, kib / 1048576}')
  echo "$message"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf -- '- %s\n' "$message" >> "$GITHUB_STEP_SUMMARY"
  fi
}
report_size "before pruning"

# A DMG's runtime closure omits build-only inputs such as Cargo artifacts and
# the toolchain. Walk its derivation closure and include every existing output,
# including successful dependencies of an otherwise failed build.
while IFS= read -r derivation; do
  nix-store --query --requisites --include-outputs "$derivation"
done < "$roots_file" |
  sort -u > "$work_dir/requisites"
awk '!/\.drv$/' "$work_dir/requisites" > "$work_dir/paths"

# Finish enumeration and validate metadata before deleting anything. An empty
# closure or a failed query must leave the previous cache intact.
if [ ! -s "$work_dir/paths" ]; then
  echo "No completed Nix outputs to cache; leaving the cache intact."
  exit 0
fi
# An early failure may leave current dependencies in the binary cache without
# having restored them locally. Keep their planned outputs too, while exporting
# only the realized paths above. Bound argv size for macOS's smaller limit.
awk '/\.drv$/' "$work_dir/requisites" > "$work_dir/derivations"
: > "$work_dir/planned-paths"
if [ -s "$work_dir/derivations" ]; then
  xargs -n 128 nix-store --query --outputs < "$work_dir/derivations" > "$work_dir/planned-paths"
fi
awk -F/ '
  NF != 4 || $2 != "nix" || $3 != "store" {exit 1}
  {
    split($4, parts, "-")
    if (length(parts[1]) != 32 || parts[1] ~ /[^0123456789abcdfghijklmnpqrsvwxyz]/) exit 1
    print parts[1] ".narinfo"
  }
' "$work_dir/paths" "$work_dir/planned-paths" | sort -u > "$work_dir/wanted-narinfos"
for metadata in "$cache_dir"/*.narinfo; do
  printf '%s\n' "${metadata##*/}"
done | sort -u > "$work_dir/all-narinfos"
comm -12 "$work_dir/all-narinfos" "$work_dir/wanted-narinfos" > "$work_dir/retained-narinfos"
comm -23 "$work_dir/all-narinfos" "$work_dir/wanted-narinfos" > "$work_dir/remove-narinfos"
: > "$work_dir/retained-nars"

while IFS= read -r metadata; do
  nar_url=""
  store_path=""
  while read -r field value; do
    case "$field" in
      URL:) nar_url="$value" ;;
      StorePath:) store_path="$value" ;;
    esac
  done < "$cache_dir/$metadata"
  nar_file="${nar_url#nar/}"
  if [[ "$nar_url" != nar/* ]] || [[ "$nar_file" == *[!a-zA-Z0-9._-]* ]] \
    || [[ "$nar_file" == .* ]] || [ -z "$nar_file" ] \
    || [[ "$store_path" != /nix/store/"${metadata%.narinfo}"-* ]] \
    || [ -L "$cache_dir/$metadata" ]; then
    echo "Invalid retained Nix cache metadata: $metadata; leaving the cache intact." >&2
    exit 1
  fi
  if [ -f "$cache_dir/$nar_url" ] && [ ! -L "$cache_dir/$nar_url" ]; then
    printf '%s\n' "$nar_url" >> "$work_dir/retained-nars"
  else
    # Nix checks narinfo existence, not archive existence. Remove dangling
    # metadata so the subsequent copy repairs this path instead of skipping it.
    printf '%s\n' "$metadata" >> "$work_dir/remove-narinfos"
  fi
done < "$work_dir/retained-narinfos"
sort -u -o "$work_dir/retained-nars" "$work_dir/retained-nars"
for archive in "$cache_dir"/nar/*; do
  printf 'nar/%s\n' "${archive##*/}"
done | sort -u > "$work_dir/all-nars"
# Different store paths may share one compressed archive. Retain the union of
# their URLs so removing one obsolete narinfo cannot break a current path.
comm -23 "$work_dir/all-nars" "$work_dir/retained-nars" > "$work_dir/remove-nars"

while IFS= read -r metadata; do
  rm -f "$cache_dir/$metadata"
done < "$work_dir/remove-narinfos"
while IFS= read -r archive; do
  rm -f "$cache_dir/$archive"
done < "$work_dir/remove-nars"
for partition in "$cache_root"/*; do
  partition_key="${partition##*/}"
  if [ "${#partition_key}" -eq 64 ] && [[ "$partition_key" != *[!0-9a-f]* ]] \
    && [ "$partition" != "$cache_dir" ] && [ -d "$partition" ] && [ ! -L "$partition" ]; then
    rm -rf "$partition"
  fi
done
printf 'Pruned %s metadata entries and %s archives; retaining %s current store paths.\n' \
  "$(wc -l < "$work_dir/remove-narinfos" | tr -d ' ')" \
  "$(wc -l < "$work_dir/remove-nars" | tr -d ' ')" \
  "$(wc -l < "$work_dir/wanted-narinfos" | tr -d ' ')"
report_size "after pruning"

export_started=$SECONDS
copy_status=0
nix copy --stdin --to "$DESKTOP_NIX_CACHE_URL" < "$work_dir/paths" || copy_status=$?
echo "Nix cache export took $((SECONDS - export_started)) seconds."
report_size "after export"
if (( cache_size_kib * 1024 >= ${DESKTOP_NIX_CACHE_SIZE_GB:-100} * 1000000000 )); then
  echo "::warning::The current Nix build closure exceeds the configured cache capacity even after pruning; Namespace may start the next build cold."
fi
exit "$copy_status"
