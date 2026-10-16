import {
  applyLayout,
  type CollaborativeLayout,
  readLayout,
} from '@macro-inc/collaboration/forms/layout';
import { LoroDoc } from 'loro-crdt';

export const MAX_FORM_DOCUMENT_BYTES = 4 * 1024 * 1024;

/** Prepare one granular delta, using the same codec as the collaborative builder.
 * Forms owns authorization, schema policy and validated persistence. This worker
 * transforms only the supplied snapshot; it never opens or saves a form. */
export function prepareFormEdit(
  snapshot: Uint8Array,
  layout: CollaborativeLayout
): Uint8Array {
  if (snapshot.byteLength > MAX_FORM_DOCUMENT_BYTES)
    throw new Error('The form snapshot exceeds 4 MiB.');
  checkWorkLimits(layout);
  const document = new LoroDoc();
  try {
    document.import(snapshot);
    const version = document.version();
    const previous = readLayout(document);
    checkWorkLimits(previous);
    applyLayout(document, previous, layout);
    document.commit();
    const update = document.export({ mode: 'update', from: version });
    if (update.byteLength > MAX_FORM_DOCUMENT_BYTES)
      throw new Error('The form update exceeds 4 MiB.');
    return update;
  } finally {
    document.free();
  }
}

/** Resource limits for a synchronous worker transform, including existing content. */
function checkWorkLimits(layout: CollaborativeLayout): void {
  if (
    layout.sections.length > 1_000 ||
    layout.sections.reduce(
      (count, section) => count + (section.questions?.length ?? 0),
      0
    ) > 2_000
  )
    throw new Error('The form exceeds the editing worker work limit.');
  const pending: { value: unknown; depth: number }[] = [
    { value: layout, depth: 0 },
  ];
  let nodes = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (
      ++nodes > 50_000 ||
      depth > 32 ||
      (typeof value === 'string' && value.length > 100_000)
    )
      throw new Error('The form exceeds the editing worker work limit.');
    if (value && typeof value === 'object') {
      for (const child of Object.values(value))
        pending.push({ value: child, depth: depth + 1 });
    }
  }
}
