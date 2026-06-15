import { Mirror, type InferType } from '../loro-mirror/packages/core/src';
import { LoroDoc } from 'loro-crdt';
import type { SerializedEditorState } from 'lexical';
import { MARKDOWN_GOLDEN } from './markdown-golden.1';
import { MARKDOWN_LORO_SCHEMA } from './markdown-loro-schema';
import { markdownToSerializedEditorStateWithIds } from './utils/markdown-state';

// HACK: hack to get around async nature of mirror sync,
// which we have no control over. Keep this in sync with app/packages/core/collab/utils.ts.
async function awaitMirrorSync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

export async function rawMarkdownStateToLoroSnapshot(
  state: InferType<typeof MARKDOWN_LORO_SCHEMA>,
  base?: Uint8Array
): Promise<Uint8Array | undefined> {
  const loroDoc = new LoroDoc();
  loroDoc.setRecordTimestamp(true);

  // Seed from the golden base so every document shares a common ancestor — this
  // is what lets concurrent/optimistic edits converge instead of duplicating.
  if (base) loroDoc.import(base);

  const mirror = new Mirror({
    doc: loroDoc,
    schema: MARKDOWN_LORO_SCHEMA,
  });

  mirror.setState(state);
  mirror.sync();
  await awaitMirrorSync();

  try {
    return loroDoc.export({ mode: 'snapshot' });
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

export async function markdownToLoroSnapshot(
  markdown: string
): Promise<Uint8Array | undefined> {
  // Blank markdown is exactly the golden — return it verbatim so all empty docs
  // share identical bytes and skip the mirror round-trip.
  if (markdown === '') return MARKDOWN_GOLDEN;
  const state = markdownToSerializedEditorState(markdown);
  return rawMarkdownStateToLoroSnapshot(state as any, MARKDOWN_GOLDEN);
}
