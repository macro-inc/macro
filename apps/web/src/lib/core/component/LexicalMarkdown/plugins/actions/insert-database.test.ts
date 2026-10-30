import { registerRichText } from '@lexical/rich-text';
import {
  $createAwaitNode,
  $isDocumentCardNode,
  AwaitNode,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $insertNodes,
  $nodesOfType,
  createEditor,
} from 'lexical';
import { err, ok, type Result } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { insertNewDatabase } from './insert-database';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  track: vi.fn(),
  untrack: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@queries/storage/databases', () => ({ createDatabase: mocks.create }));
vi.mock('@app/lib/queries/storage/mentions', () => ({
  trackMention: mocks.track,
  untrackMention: mocks.untrack,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));

function documentEditor() {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  editor.setRootElement(document.createElement('div'));
  registerRichText(editor);
  editor.update(
    () => {
      const text = $createTextNode('Before. After.');
      $getRoot().append($createParagraphNode().append(text));
      text.select(8, 8);
    },
    { discrete: true }
  );
  return editor;
}

describe('creating a database in a document', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue(ok('db-1'));
    mocks.track.mockResolvedValue('mention-1');
  });

  it('creates once and anchors an expanded editor between the surrounding text', async () => {
    const editor = documentEditor();
    await insertNewDatabase(editor, {
      sourceDocumentId: 'doc-1',
      sourceBlockName: 'md',
    });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      name: 'Untitled database',
      source: 'slash-menu',
    });
    expect(mocks.track).toHaveBeenCalledWith('doc-1', 'database', 'db-1');
    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children.map((node) => node.getType())).toEqual([
        'paragraph',
        'document-card',
        'paragraph',
      ]);
      expect(children[0].getTextContent()).toBe('Before. ');
      expect(children[2].getTextContent()).toBe('After.');
      const card = children[1];
      expect($isDocumentCardNode(card)).toBe(true);
      if (!$isDocumentCardNode(card)) throw new Error('Missing card');
      expect(card.getDocumentId()).toBe('db-1');
      expect(card.getBlockName()).toBe('database');
      expect(card.getMentionUuid()).toBe('mention-1');
    });
  });

  it('uses the placeholder already shown while the creation module loaded', async () => {
    const editor = documentEditor();
    let key!: string;
    editor.update(
      () => {
        const placeholder = $createAwaitNode({
          awaitId: 'pending',
          text: 'Creating database…',
        });
        $insertNodes([placeholder]);
        key = placeholder.getKey();
      },
      { discrete: true }
    );
    let finish!: (result: Result<string, unknown>) => void;
    mocks.create.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const creating = insertNewDatabase(editor, undefined, key);
    expect(editor.read(() => $nodesOfType(AwaitNode))).toHaveLength(1);
    finish(ok('db-1'));
    await creating;
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(
      editor.read(() => $getRoot().getChildren().filter($isDocumentCardNode))
    ).toHaveLength(1);
  });

  it.each(['removed', 'read-only'] as const)(
    'does not create if the pending insert became %s while its module loaded',
    async (state) => {
      const editor = documentEditor();
      let key!: string;
      editor.update(
        () => {
          const placeholder = $createAwaitNode({
            awaitId: 'pending',
            text: 'Creating database…',
          });
          $insertNodes([placeholder]);
          key = placeholder.getKey();
        },
        { discrete: true }
      );
      if (state === 'removed')
        editor.update(() => $getNodeByKey(key)?.remove(), { discrete: true });
      else editor.setEditable(false);
      await insertNewDatabase(editor, undefined, key);
      expect(mocks.create).not.toHaveBeenCalled();
      expect(editor.read(() => $getRoot().getTextContent())).toBe(
        'Before. After.'
      );
    }
  );

  it('does not insert elsewhere when the placeholder was removed during creation', async () => {
    let finish!: (result: Result<string, unknown>) => void;
    mocks.create.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const editor = documentEditor();
    const creating = insertNewDatabase(editor);
    editor.update(
      () =>
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append($createTextNode('Replacement'))
          ),
      { discrete: true }
    );
    finish(ok('db-1'));
    await creating;
    expect(editor.read(() => $getRoot().getTextContent())).toBe('Replacement');
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('cleans up tracking when the placeholder is removed while tracking runs', async () => {
    const editor = documentEditor();
    mocks.track.mockImplementation(async () => {
      editor.update(() => $getRoot().clear(), { discrete: true });
      return 'mention-1';
    });
    await insertNewDatabase(editor, { sourceDocumentId: 'doc-1' });
    expect(mocks.untrack).toHaveBeenCalledExactlyOnceWith('doc-1', 'mention-1');
    expect(editor.read(() => $getRoot().getChildrenSize())).toBe(0);
  });

  it('removes the placeholder and reports a failed create without retrying', async () => {
    mocks.create.mockResolvedValue(err([{ message: 'Refused' }]));
    const editor = documentEditor();
    await insertNewDatabase(editor);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.failure).toHaveBeenCalledTimes(1);
    expect(editor.read(() => $getRoot().getTextContent())).toBe(
      'Before. After.'
    );
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('does not create from a read-only editor', async () => {
    const editor = documentEditor();
    editor.setEditable(false);
    await insertNewDatabase(editor);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(['create', 'track'] as const)(
    'removes the placeholder when %s rejects and lets the action report the failure',
    async (boundary) => {
      const editor = documentEditor();
      const failure = new Error('Service unavailable');
      mocks[boundary].mockRejectedValueOnce(failure);
      await expect(
        insertNewDatabase(editor, { sourceDocumentId: 'doc-1' })
      ).rejects.toBe(failure);
      expect(editor.read(() => $getRoot().getTextContent())).toBe(
        'Before. After.'
      );
      expect(editor.getEditorState().toJSON().root.children).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'await' })])
      );
    }
  );

  it.each(['create', 'track'] as const)(
    'cleans up when the document becomes read-only during %s',
    async (boundary) => {
      const editor = documentEditor();
      mocks[boundary].mockImplementationOnce(async () => {
        editor.setEditable(false);
        return boundary === 'create' ? ok('db-1') : 'mention-1';
      });
      await insertNewDatabase(editor, { sourceDocumentId: 'doc-1' });
      expect(editor.read(() => $getRoot().getTextContent())).toBe(
        'Before. After.'
      );
      expect(editor.isEditable()).toBe(false);
      if (boundary === 'track')
        expect(mocks.untrack).toHaveBeenCalledExactlyOnceWith(
          'doc-1',
          'mention-1'
        );
    }
  );
});
