// Copy of main's apps/web/src/features/block-form/queries/form-sources.ts (createInvitedSource) at 8f161035c063cb7d5ffcd1939fbbb0ecaa6612f8, verbatim below the marker
// except the import lines listed in check-copies.sh (paths that main resolved
// relative to its own directory). The proof runner checks this.
// ---- verbatim below ----
import { loadFailureOf } from '@app/features/block-form/queries/form-sources';
import type { ReadSource } from '@app/features/block-form/context/form-context';
import type { Accessor } from 'solid-js';
import { useFormInvitedCount } from './form-invited-count';

export function createInvitedSource(
  formId: Accessor<string>,
  ownerId: Accessor<string>,
  enabled: Accessor<boolean>
): ReadSource<number | null> {
  const invited = useFormInvitedCount(
    () => formId() || undefined,
    ownerId,
    enabled
  );
  return {
    value: invited.count,
    failure: () => {
      const error = invited.error();
      return error ? loadFailureOf(error) : undefined;
    },
  };
}
