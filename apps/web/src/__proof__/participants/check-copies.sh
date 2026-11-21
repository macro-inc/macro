#!/usr/bin/env bash
# Rebuilds the copies of main's participant code from git and compares them with
# the files in main/. With --write it rewrites them instead. The only edits to
# main's text are the rewrites below: imports main resolved relative to its own
# directory, and the query key's prefix. The head keeps main's participants key,
# so the copy gets a prefix of its own; with one key both readers would share a
# single TanStack cache entry and the comparison would compare it with itself.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
main=${MAIN_SHA:-393eee931fa9b40400297c3237ce1ad3e00323d3}
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

header() {
  printf '%s\n' \
    "// Copy of main's $1 at $main, verbatim below the marker" \
    "// except the import lines listed in check-copies.sh (paths that main resolved" \
    "// relative to its own directory). The proof runner checks this." \
    "// ---- verbatim below ----"
}
copy() {
  local src=$1 dest=$2
  shift 2
  { header "$src"; git show "$main:$src" | sed "$@"; } >"$out/$dest"
}
copy apps/web/src/lib/queries/channel/channel-participants.ts channel-participants.ts \
  -e "s#^import { queryClient } from '../client';#import { queryClient } from '@queries/client';#"
copy apps/web/src/lib/queries/channel/participants.ts participants.ts \
  -e "s#^import { queryClient } from '../client';#import { queryClient } from '@queries/client';#"
copy apps/web/src/lib/queries/channel/keys.ts keys.ts \
  -e "s#^export const channelKeys = createQueryKeys('channel', {#export const channelKeys = createQueryKeys('channel-main', {#"
copy apps/web/src/lib/queries/channel/types.ts types.ts -e ''
# main's useFormInvitedCount, the function alone.
{
  header 'apps/web/src/lib/queries/storage/forms.ts (useFormInvitedCount)'
  printf '%s\n' \
    "import { useFormSharePermissionsQuery } from '@queries/storage/forms';" \
    "import { useQueries } from '@tanstack/solid-query';" \
    "import type { Accessor } from 'solid-js';" \
    "import { channelParticipantsQueryOptions } from './channel-participants';" \
    ''
  git show "$main:apps/web/src/lib/queries/storage/forms.ts" |
    awk '/^ \* How many distinct people the channels a form was posted in hold/{p=1; print "/**"} p{print} p&&/^}$/{exit}'
} >"$out/form-invited-count.ts"
# main's createInvitedSource, the function alone.
{
  header 'apps/web/src/features/block-form/queries/form-sources.ts (createInvitedSource)'
  printf '%s\n' \
    "import { loadFailureOf } from '@app/features/block-form/queries/form-sources';" \
    "import type { ReadSource } from '@app/features/block-form/context/form-context';" \
    "import type { Accessor } from 'solid-js';" \
    "import { useFormInvitedCount } from './form-invited-count';" \
    ''
  git show "$main:apps/web/src/features/block-form/queries/form-sources.ts" |
    awk '/^export function createInvitedSource\(/{p=1} p{print} p&&/^}$/{exit}'
} >"$out/create-invited-source.ts"

status=0
for file in "$out"/*.ts; do
  name=$(basename "$file")
  if [[ ${1:-} == --write ]]; then
    cp "$file" "$here/main/$name"
  elif ! diff -u "$file" "$here/main/$name"; then
    status=1
  fi
done
[[ ${1:-} == --write ]] || { [[ $status == 0 ]] && echo "main copies match $main"; }
exit $status
