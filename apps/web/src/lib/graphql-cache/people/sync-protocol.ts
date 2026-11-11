import {
  type ContactReconcile,
  ContactReconcileSchema,
  type ContactSnapshot,
  type ContactSnapshotRequest,
  ContactSnapshotRequestSchema,
  ContactSnapshotSchema,
  MAX_PEOPLE_BATCH,
} from './generated';

const UTF8 = new TextEncoder();
function ids(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= MAX_PEOPLE_BATCH &&
    value.every(
      (id) =>
        typeof id === 'string' &&
        id.length <= 1024 &&
        UTF8.encode(id).length <= 1024
    )
  );
}
export function isContactSnapshotRequest(
  value: unknown
): value is ContactSnapshotRequest {
  const parsed = ContactSnapshotRequestSchema.safeParse(value);
  return (
    parsed.success &&
    parsed.data.scope.identity.length <= 1024 &&
    (parsed.data.scan?.after == null ||
      (parsed.data.scan.after.length <= 1024 &&
        !parsed.data.scan.after.includes('\0')))
  );
}
export function isContactReconcile(value: unknown): value is ContactReconcile {
  if (
    !value ||
    typeof value !== 'object' ||
    !('requested' in value) ||
    !('present' in value) ||
    !ids(value.requested) ||
    !ids(value.present)
  )
    return false;
  const parsed = ContactReconcileSchema.safeParse(value);
  return (
    parsed.success &&
    parsed.data.viewer.length <= 1024 &&
    parsed.data.scope.identity === parsed.data.viewer
  );
}
export function parseContactSnapshot(value: unknown): ContactSnapshot {
  if (
    !value ||
    typeof value !== 'object' ||
    !('ids' in value) ||
    !ids(value.ids) ||
    !('nextCursor' in value) ||
    value.nextCursor === undefined
  )
    throw new Error('Invalid contact snapshot');
  const parsed = ContactSnapshotSchema.safeParse(value);
  if (
    !parsed.success ||
    (parsed.data.nextCursor != null &&
      (parsed.data.nextCursor.length > 1024 ||
        parsed.data.nextCursor.includes('\0')))
  )
    throw new Error('Invalid contact snapshot');
  return parsed.data;
}
export const CONTACT_SYNC_UNSUPPORTED = 'Contact reconciliation is unsupported';
