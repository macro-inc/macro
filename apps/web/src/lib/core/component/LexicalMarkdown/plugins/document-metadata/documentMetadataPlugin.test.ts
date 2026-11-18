import {
  $updateAllNodeIds,
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

function newMappings() {
  return { idToNodeKeyMap: new Map(), nodeKeyToIdMap: new Map() };
}

beforeEach(() => {
  editor = newEditor();
  cleanups = [
    nodeIdPlugin({ nodes: [ParagraphNode, TextNode], mappings: newMappings() })(
      editor
    ),
    documentMetadataPlugin({})(editor),
  ];
});

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
});

/** A body saved by this editor, with node ids, at the given version if any. */
function storedDocument(version?: number): SerializedEditorState {
  const source = newEditor();
  source.update(
    () => {
      if (version !== undefined) {
        $applyDocumentMetadataFromSerialized({
          root: { $: { documentMetadata: { version } } },
        } as never);
      }
      $getRoot().append(
        $createParagraphNode().append($createTextNode('Stored text'))
      );
      $updateAllNodeIds(newMappings());
    },
    { discrete: true }
  );
  return source.getEditorState().toJSON();
}

async function openStoredDocument(version?: number) {
  initializeEditorWithVersionedState(
    editor,
    storedDocument(version),
    () => 'viewer-peer'
  );
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  editor.update(() => {}, { discrete: true });
}

/**
 * Applies a collaborator's change the way the collaboration binding does:
 * the shared state, then a pass that only puts this peer's caret back.
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
      $getRoot().getFirstChildOrThrow().selectEnd();
    },
    { discrete: true }
  );
}

/** The version in the first committed state that contains `text`. */
function versionCommittedWith(text: string, edit: () => void) {
  let version: number | undefined;
  const stop = editor.registerUpdateListener(({ editorState }) => {
    if (version !== undefined) return;
    editorState.read(() => {
      if ($getRoot().getTextContent().includes(text)) {
        version = $getDocumentMetadata().version;
      }
    });
  });
  edit();
  stop();
  return version;
}

function typeParagraph() {
  editor.update(
    () => {
      $getRoot().append(
        $createParagraphNode().append($createTextNode('Typed text'))
      );
    },
    { discrete: true }
  );
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
    expect(versionCommittedWith('Typed text', typeParagraph)).toBe(
      MARKDOWN_VERSION_COUNTER
    );
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

  it('stamps the current version in the same commit as the first local edit', async () => {
    await openStoredDocument(OLDER_VERSION);

    expect(versionCommittedWith('Typed text', typeParagraph)).toBe(
      MARKDOWN_VERSION_COUNTER
    );
  });

  it('stamps the first local edit to a document stored without a version', async () => {
    await openStoredDocument();

    expect(storedVersion()).toBe(-1);
    expect(versionCommittedWith('Typed text', typeParagraph)).toBe(
      MARKDOWN_VERSION_COUNTER
    );
  });

  it('stamps the current version in the same commit as a rewrite of the loaded content', async () => {
    await openStoredDocument(OLDER_VERSION);

    const version = versionCommittedWith('Migrated text', () => {
      editor.update(
        () => {
          const stored = $getRoot().getFirstChildOrThrow();
          if (!$isParagraphNode(stored)) throw new Error('expected paragraph');
          stored.clear().append($createTextNode('Migrated text'));
        },
        { discrete: true }
      );
    });

    expect(version).toBe(MARKDOWN_VERSION_COUNTER);
  });
});
