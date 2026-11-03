import type { LanguageModelV3Usage } from '@ai-sdk/provider';
import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import { createNoopLiveSyncSource } from '@macro-inc/collaboration/collab/source';
import type { DocumentOp } from '@macro-inc/editor-ops/document';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { markdownToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import { MockLanguageModelV3 } from 'ai/test';
import type { SerializedEditorState } from 'lexical';
import { LoroDoc, VersionVector } from 'loro-crdt';
import { okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { createEditingSession, loadSnapshot } from './ai-editing/ai-toolkit';
import { serializeWithXml } from './ai-editing/utils';
import { runEditSession } from './run-edit';

const DOC = 'doc-1';

const usage: LanguageModelV3Usage = {
  inputTokens: {
    total: 10,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** A model that answers every step with one runCode call. */
function editingModel() {
  return new MockLanguageModelV3({
    modelId: 'fast-mock',
    doGenerate: async () => ({
      content: [
        {
          type: 'tool-call' as const,
          toolCallId: 'call-1',
          toolName: 'runCode',
          input: JSON.stringify({ code: 'editor.anything()', snippets: [] }),
        },
      ],
      finishReason: { unified: 'tool-calls' as const, raw: undefined },
      usage,
      warnings: [],
    }),
  });
}

/**
 * A sync service that records what reached it. Like the worker's real source,
 * it closes when the request signal aborts, so nothing is sent afterwards.
 */
function syncService(snapshot: Uint8Array, signal?: AbortSignal) {
  const server = new LoroDoc();
  server.import(snapshot);
  let open = true;
  signal?.addEventListener('abort', () => {
    open = false;
  });
  const source = {
    ...createNoopLiveSyncSource(DOC),
    doInitialSync: () => okAsync({ snapshot, awareness: new Uint8Array() }),
    pushUpdate: async (updates: Uint8Array[]) => {
      if (!open) return false;
      for (const update of updates) server.import(update);
      return true;
    },
  };
  return { source, server };
}

/** The first paragraph's id in the XML view the model is given. */
async function paragraphId(snapshot: Uint8Array): Promise<string> {
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId: DOC });
  (await manager.initializeFromSnapshot(snapshot))._unsafeUnwrap();
  const session = createEditingSession();
  loadSnapshot(
    session,
    manager.mirror!.getState() as unknown as SerializedEditorState
  );
  manager.dispose();
  return serializeWithXml(session).match(/<p id="([^"]+)"/)![1]!;
}

describe('runEditSession', () => {
  it('reports the changed blocks, a summary and the acknowledged revision', async () => {
    const snapshot = (await markdownToLoroSnapshot('Ship in Q3.'))!;
    const { source, server } = syncService(snapshot);
    const paragraph = await paragraphId(snapshot);
    const ops: DocumentOp[] = [
      {
        kind: 'replaceText',
        node: paragraph,
        find: 'Q3',
        to: 'Q4',
        scope: { kind: 'all' },
      },
      {
        kind: 'insertNode',
        ref: 'next-steps',
        spec: { block: 'heading', level: 2, text: 'Next steps' },
        at: { after: paragraph },
      },
    ];

    const result = await runEditSession({
      source,
      documentId: DOC,
      prompt: 'move it to Q4 and add a next steps heading',
      models: { fast: editingModel() },
      mode: 'fast',
      typingAnimations: false,
      runner: () => ops,
    });

    expect(result.changedBlockIds).toEqual([paragraph, 'next-steps']);
    expect(result.summary).toBe('Edited 1 block, inserted 1 heading.');
    expect(
      VersionVector.decode(Buffer.from(result.revision, 'base64')).compare(
        server.oplogVersion()
      )
    ).toBe(0);
    expect(JSON.stringify(server.toJSON())).toContain('Ship in Q4.');
  });

  it('stops applying when the request aborts and does not report success', async () => {
    const snapshot = (await markdownToLoroSnapshot('Ship in Q3.'))!;
    const controller = new AbortController();
    const { source, server } = syncService(snapshot, controller.signal);
    const paragraph = await paragraphId(snapshot);

    const session = runEditSession({
      source,
      documentId: DOC,
      prompt: 'add two sentences',
      models: { fast: editingModel() },
      mode: 'fast',
      typingAnimations: true,
      // The request goes away during the first op's typing animation.
      sleep: async () => {
        controller.abort();
      },
      signal: controller.signal,
      runner: () => [
        { kind: 'appendText', node: paragraph, text: ' First sentence.' },
        { kind: 'appendText', node: paragraph, text: ' Second sentence.' },
      ],
    });

    await expect(session).rejects.toThrow();
    const text = JSON.stringify(server.toJSON());
    expect(text).not.toContain('First sentence.');
    expect(text).not.toContain('Second');
  });
});
