import {
  COLLAB_SELECTION_TAG,
  COLLABORATION_TAG,
  LOCAL_STATUS_TAG,
  nodeIdPlugin,
} from '@macro-inc/lexical-core';
import {
  $addUpdateTag,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isParagraphNode,
  createEditor,
  type LexicalEditor,
  ParagraphNode,
  type SerializedEditorState,
  TextNode,
} from 'lexical';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeEditorWithVersionedState } from '../../utils';
import { MARKDOWN_VERSION_COUNTER } from '../../version';
import {
  $applyDocumentMetadataFromSerialized,
  $getDocumentMetadata,
  documentMetadataPlugin,
} from './documentMetadataPlugin';

const OLDER_VERSION = MARKDOWN_VERSION_COUNTER - 1;

let editor: LexicalEditor;
let cleanups: Array<() => void>;

function newEditor() {
  return createEditor({
    onError: (error) => {
      throw error;
    },
  });
}

beforeEach(() => {
  editor = newEditor();
  cleanups = [
    nodeIdPlugin({
      nodes: [ParagraphNode, TextNode],
      mappings: { idToNodeKeyMap: new Map(), nodeKeyToIdMap: new Map() },
    })(editor),
    documentMetadataPlugin({})(editor),
  ];
});

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
});

/** A stored body without node ids, so opening it assigns them. */
function storedDocument(version: number): SerializedEditorState {
  const source = newEditor();
  source.update(
    () => {
      $applyDocumentMetadataFromSerialized({
        root: { $: { documentMetadata: { version } } },
      } as never);
      $getRoot().append(
        $createParagraphNode().append($createTextNode('Stored text'))
      );
    },
    { discrete: true }
  );
  return source.getEditorState().toJSON();
}

async function openStoredDocument(version: number) {
  initializeEditorWithVersionedState(
    editor,
    storedDocument(version),
    () => 'viewer-peer'
  );
  await settle();
}

/**
 * Applies a collaborator's change the way the collaboration binding does:
 * the shared state, then a pass that re-syncs node ids and the local cursor.
 */
function receiveSharedChange() {
  editor.update(
    () => {
      $addUpdateTag(COLLABORATION_TAG);
      $getRoot().append(
        $createParagraphNode().append($createTextNode('Their text'))
      );
    },
    { discrete: true }
  );
  editor.update(
    () => {
      $addUpdateTag(COLLAB_SELECTION_TAG);
      $getRoot().getLastChildOrThrow().markDirty();
    },
    { discrete: true }
  );
}

/** Lets the editor commit updates that loading left pending. */
async function settle() {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  editor.update(() => {}, { discrete: true });
}

function storedVersion() {
  return editor.read(() => $getDocumentMetadata().version);
}

describe('documentMetadataPlugin', () => {
  it('leaves an older version alone when the document only opens', async () => {
    await openStoredDocument(OLDER_VERSION);

    expect(storedVersion()).toBe(OLDER_VERSION);
  });

  it("leaves an older version alone when a collaborator's change arrives", async () => {
    await openStoredDocument(OLDER_VERSION);
    receiveSharedChange();

    expect(storedVersion()).toBe(OLDER_VERSION);
  });

  it('leaves an older version alone after per-peer bookkeeping', async () => {
    await openStoredDocument(OLDER_VERSION);
    editor.update(
      () => {
        $addUpdateTag(LOCAL_STATUS_TAG);
        $getRoot().getFirstChildOrThrow().markDirty();
      },
      { discrete: true }
    );

    expect(storedVersion()).toBe(OLDER_VERSION);
  });

  it('stamps the current version in the same update as a local edit', async () => {
    await openStoredDocument(OLDER_VERSION);

    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('Typed text'))
        );
      },
      { discrete: true }
    );

    expect(storedVersion()).toBe(MARKDOWN_VERSION_COUNTER);
  });

  it('stamps the current version with a rewrite of the loaded content', async () => {
    await openStoredDocument(OLDER_VERSION);

    editor.update(
      () => {
        const stored = $getRoot().getFirstChildOrThrow();
        if (!$isParagraphNode(stored)) throw new Error('expected paragraph');
        stored.clear().append($createTextNode('Migrated text'));
      },
      { discrete: true }
    );

    expect(storedVersion()).toBe(MARKDOWN_VERSION_COUNTER);
    expect(editor.read(() => $getRoot().getTextContent())).toBe(
      'Migrated text'
    );
  });
});
