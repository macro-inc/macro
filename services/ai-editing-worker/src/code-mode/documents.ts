import type { InferType } from '@loro-mirror/core';
import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { $updateAllNodeIds } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import {
  $createParagraphNode,
  $getRoot,
  type SerializedEditorState,
} from 'lexical';
import type { z } from 'zod';
import {
  createEditingSession,
  loadSnapshot,
  toSnapshot,
} from '../ai-editing/ai-toolkit/session';
import { Doc } from '../ai-editing/doc';
import { EditError } from '../ai-editing/editor';
import { docIds } from '../ai-editing/runtime';
import { serializeWithXml } from '../ai-editing/utils';
import {
  DocumentRequestError,
  type DocumentStorage,
} from '../document-storage';
import {
  inspectDocumentState,
  MAX_DOCUMENT_BYTES,
  preflightOperation,
} from './document-limits';
import { documentRequestSchema } from './operations';

/** Apply on an isolated Loro document, then compare-and-swap its delta in sync. */
export async function runDocumentRequest(
  documentId: string,
  input: z.infer<typeof documentRequestSchema>,
  storage: DocumentStorage,
  signal: AbortSignal
) {
  const request = documentRequestSchema.parse(input);
  const { snapshot, revision } = await storage.load(signal);
  signal.throwIfAborted();
  if (request.action === 'edit' && request.expectedRevision !== revision)
    throw new DocumentRequestError(
      'The document changed. Open it again and reconsider the edit.',
      409
    );
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
  try {
    const loaded = await manager.initializeFromSnapshot(snapshot);
    if (loaded.isErr())
      throw new DocumentRequestError('Invalid document state.', 400);
    const session = createEditingSession();
    const raw = manager.mirror!.getState() as unknown as SerializedEditorState;
    if (!raw?.root || !Array.isArray(raw.root.children))
      throw new DocumentRequestError(
        'This is not a Macro markdown document.',
        400
      );
    let inspected = inspectDocumentState(raw);
    loadSnapshot(session, raw);
    const ids = docIds(session);
    if (
      ids.size !== inspected.nodes.size ||
      [...ids].some((id) => !inspected.nodes.has(id))
    )
      throw new DocumentRequestError(
        'Document node IDs need initialization. Open it in Macro, then read again.',
        400
      );
    if (request.action === 'read') {
      const result = {
        documentId,
        revision,
        xml: serializeWithXml(session),
        state: toSnapshot(session),
        nodeIds: [...docIds(session)],
      };
      if (
        new TextEncoder().encode(JSON.stringify(result)).length >
        MAX_DOCUMENT_BYTES
      )
        throw new DocumentRequestError(
          'Document state exceeds the 240 KiB code SDK limit.',
          413
        );
      return result;
    }
    const writer = new Doc(session);
    for (const [index, op] of request.operations.entries()) {
      signal.throwIfAborted();
      if ('ref' in op && op.ref) {
        if (ids.has(op.ref))
          throw new DocumentRequestError(
            'An inserted node ID already exists.',
            400
          );
        ids.add(op.ref);
      }
      // All changes remain private until every operation has succeeded.
      try {
        preflightOperation(op, session, inspected);
        writer.apply(op);
      } catch (error) {
        if (error instanceof EditError)
          throw new DocumentRequestError(
            `Operation ${index + 1}: ${error.message}`,
            400
          );
        throw error;
      }
      session.editor.update(() => $updateAllNodeIds(session.ids), {
        discrete: true,
      });
      inspected = inspectDocumentState(toSnapshot(session), true);
    }
    session.editor.update(
      () => {
        if ($getRoot().isEmpty()) $getRoot().append($createParagraphNode());
        $updateAllNodeIds(session.ids);
      },
      {
        discrete: true,
      }
    );
    const version = manager.doc.oplogVersion();
    inspectDocumentState(toSnapshot(session));
    // Retain Loro's fresh random peer ID. The animation pool's small reserved
    // peer range is shared by independent worker isolates and is unsafe here.
    const synced = await manager.syncToLoro(
      toSnapshot(session) as unknown as InferType<typeof MARKDOWN_LORO_SCHEMA>
    );
    if (synced.isErr())
      throw new DocumentRequestError('Could not prepare document edits.', 400);
    manager.doc.commit();
    const update = manager.doc.export({ mode: 'update', from: version });
    if (update.byteLength > 1024 * 1024)
      throw new DocumentRequestError('Document update exceeds 1 MiB.', 413);
    signal.throwIfAborted();
    const committed = await storage.commit(
      request.expectedRevision,
      update,
      signal
    );
    return { documentId, ...committed };
  } finally {
    manager.dispose();
  }
}
