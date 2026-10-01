import { AutomergeDoc } from '@macro-inc/automerge';
import { type InferType, Mirror } from '@macro-inc/automerge/mirror';
import type { SerializedEditorState } from 'lexical';
import { MARKDOWN_AUTOMERGE_SCHEMA } from './markdown-automerge-schema';
import { MARKDOWN_GOLDEN } from './markdown-golden.2';
import { markdownToSerializedEditorStateWithIds } from './utils/markdown-state';

// HACK: hack to get around async nature of mirror sync,
// which we have no control over. Keep this in sync with
// packages/collaboration/src/collab/utils.ts.
async function awaitMirrorSync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

export async function rawMarkdownStateToAutomergeSnapshot(
  state: InferType<typeof MARKDOWN_AUTOMERGE_SCHEMA>,
  base?: Uint8Array
): Promise<Uint8Array | undefined> {
  const automergeDoc = new AutomergeDoc();
  automergeDoc.setRecordTimestamp(true);

  // Seed from the golden base so every document shares a common ancestor — this
  // is what lets concurrent/optimistic edits converge instead of duplicating.
  if (base) automergeDoc.import(base);

  const mirror = new Mirror({
    doc: automergeDoc,
    schema: MARKDOWN_AUTOMERGE_SCHEMA,
  });

  mirror.setState(state);
  mirror.sync();
  await awaitMirrorSync();

  try {
    return automergeDoc.export({ mode: 'snapshot' });
  } catch (e) {
    console.error('Failed to export snapshot', e);
    return undefined;
  }
}

export function markdownToSerializedEditorState(
  markdown: string
): SerializedEditorState {
  return markdownToSerializedEditorStateWithIds(
    markdown
  ) as SerializedEditorState;
}

export async function markdownToAutomergeSnapshot(
  markdown: string
): Promise<Uint8Array | undefined> {
  // Blank markdown is exactly the golden — return it verbatim so all empty docs
  // share identical bytes and skip the mirror round-trip.
  if (markdown === '') return MARKDOWN_GOLDEN;
  const state = markdownToSerializedEditorState(markdown);
  return rawMarkdownStateToAutomergeSnapshot(state as any, MARKDOWN_GOLDEN);
}
