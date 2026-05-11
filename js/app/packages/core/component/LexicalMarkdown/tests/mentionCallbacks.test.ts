import { describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  if (typeof globalThis.Worker === 'undefined') {
    (globalThis as any).Worker = class FakeWorker {
      onmessage = null;
      postMessage() {}
      terminate() {}
      addEventListener() {}
      removeEventListener() {}
    };
  }
  if (
    typeof globalThis.window !== 'undefined' &&
    typeof globalThis.window.matchMedia !== 'function'
  ) {
    (globalThis.window as any).matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    });
  }
});

// Stub any imports before they import the entire app (sad).
vi.mock('@core/constant/allBlocks', () => ({
  verifyBlockName: (name: string) => name,
}));
vi.mock('@core/signal/mention', () => ({
  untrackMention: vi.fn(),
}));
vi.mock('@service-storage/client', () => ({
  blockNameToItemType: (name: string) => {
    const map: Record<string, string> = {
      write: 'document',
      channel: 'channel',
      project: 'project',
      chat: 'chat',
      email: 'email',
    };
    return map[name] ?? 'document';
  },
}));
vi.mock('../utils', async () => {
  const { $getNodeByKey } = await import('lexical');
  return {
    $collapseSelection: vi.fn(),
    $traverseNodes: vi.fn(),
    nodeByKey: (editorOrState: any, key: string) => {
      let node: any;
      editorOrState.read(() => {
        node = $getNodeByKey(key);
      });
      return node;
    },
  };
});
vi.mock('../plugins/shared', () => ({
  mapRegisterDelete: () => () => {},
}));

import { SupportedNodeTypes } from '@lexical-core/node-list';
import {
  $createParagraphNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import {
  INSERT_CONTACT_MENTION_COMMAND,
  INSERT_DATE_MENTION_COMMAND,
  INSERT_DOCUMENT_MENTION_COMMAND,
  INSERT_GROUP_MENTION_COMMAND,
  INSERT_USER_MENTION_COMMAND,
  type ItemMention,
  mentionsPlugin,
} from '../plugins/mentions/mentionsPlugin';

function createTestEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'test-mentions',
    nodes: [...SupportedNodeTypes],
    onError: (e) => {
      throw e;
    },
  });

  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.appendChild(root);
  editor.setRootElement(root);

  editor.update(
    () => {
      $getRoot().clear().append($createParagraphNode());
    },
    { discrete: true }
  );

  return editor;
}

describe('mentionsPlugin callbacks', () => {
  test('onCreateMention fires for each mention type and onRemoveMention fires on clear', async () => {
    const editor = createTestEditor();
    const created: ItemMention[] = [];
    const removed: ItemMention[] = [];

    const flush = () => editor.read(() => {});

    const cleanup = mentionsPlugin({
      onCreateMention: (m) => created.push(m),
      onRemoveMention: (m) => removed.push(m),
    })(editor);

    // Insert one of each mention type.

    editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
      documentId: 'doc-1',
      documentName: 'Test Doc',
      blockName: 'write',
      mentionUuid: 'uuid-doc',
    });
    flush();

    editor.dispatchCommand(INSERT_USER_MENTION_COMMAND, {
      userId: 'user-1',
      email: 'user@test.com',
      mentionUuid: 'uuid-user',
    });
    flush();

    editor.dispatchCommand(INSERT_CONTACT_MENTION_COMMAND, {
      contactId: 'contact-1',
      name: 'Jane',
      emailOrDomain: 'jane@test.com',
      isCompany: false,
      mentionUuid: 'uuid-contact',
    });
    flush();

    editor.dispatchCommand(INSERT_DATE_MENTION_COMMAND, {
      date: '2026-03-24',
      displayFormat: 'March 24, 2026',
      mentionUuid: 'uuid-date',
    });
    flush();

    editor.dispatchCommand(INSERT_GROUP_MENTION_COMMAND, {
      groupAlias: 'engineering',
    });
    flush();

    expect(created).toHaveLength(5);
    expect(created).toContainEqual(
      expect.objectContaining({ itemType: 'document', itemId: 'doc-1' })
    );
    expect(created).toContainEqual(
      expect.objectContaining({ itemType: 'user', itemId: 'user-1' })
    );
    expect(created).toContainEqual(
      expect.objectContaining({ itemType: 'contact', itemId: 'contact-1' })
    );
    expect(created).toContainEqual(
      expect.objectContaining({ itemType: 'date', itemId: '2026-03-24' })
    );
    expect(created).toContainEqual(
      expect.objectContaining({
        itemType: 'group',
        itemId: 'engineering',
        groupAlias: 'engineering',
      })
    );

    // Clear editor to trigger destroy mutations.
    created.length = 0;

    editor.update(
      () => {
        $getRoot().clear().append($createParagraphNode());
      },
      { discrete: true }
    );
    flush();

    expect(removed).toHaveLength(5);
    expect(removed).toContainEqual(
      expect.objectContaining({ itemType: 'document', itemId: 'doc-1' })
    );
    expect(removed).toContainEqual(
      expect.objectContaining({ itemType: 'user', itemId: 'user-1' })
    );
    expect(removed).toContainEqual(
      expect.objectContaining({ itemType: 'contact', itemId: 'contact-1' })
    );
    expect(removed).toContainEqual(
      expect.objectContaining({ itemType: 'date', itemId: '2026-03-24' })
    );
    expect(removed).toContainEqual(
      expect.objectContaining({
        itemType: 'group',
        itemId: 'engineering',
        groupAlias: 'engineering',
      })
    );

    cleanup();
  });

  test('onCreateMention emits correct fileType and itemType for non-write document mentions', async () => {
    const editor = createTestEditor();
    const created: ItemMention[] = [];

    const flush = () => editor.read(() => {});

    const cleanup = mentionsPlugin({
      onCreateMention: (m) => created.push(m),
    })(editor);

    editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
      documentId: 'doc-2',
      documentName: 'Team Chat',
      blockName: 'chat',
      mentionUuid: 'uuid-doc-chat',
    });
    flush();

    editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
      documentId: 'doc-3',
      documentName: 'General',
      blockName: 'channel',
      mentionUuid: 'uuid-doc-channel',
    });
    flush();

    editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
      documentId: 'doc-4',
      documentName: 'My Project',
      blockName: 'project',
      mentionUuid: 'uuid-doc-project',
    });
    flush();

    editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
      documentId: 'doc-5',
      documentName: 'Inbox Thread',
      blockName: 'email',
      mentionUuid: 'uuid-doc-email',
    });
    flush();

    expect(created).toHaveLength(4);

    expect(created).toContainEqual(
      expect.objectContaining({
        itemType: 'chat',
        itemId: 'doc-2',
        documentName: 'Team Chat',
        fileType: 'chat',
      })
    );

    expect(created).toContainEqual(
      expect.objectContaining({
        itemType: 'channel',
        itemId: 'doc-3',
        documentName: 'General',
        fileType: 'channel',
      })
    );

    expect(created).toContainEqual(
      expect.objectContaining({
        itemType: 'project',
        itemId: 'doc-4',
        documentName: 'My Project',
        fileType: 'project',
      })
    );

    expect(created).toContainEqual(
      expect.objectContaining({
        itemType: 'thread',
        itemId: 'doc-5',
        documentName: 'Inbox Thread',
        fileType: 'email',
      })
    );

    cleanup();
  });

  test('custom plugin passed to builder runs and cleans up', () => {
    const editor = createTestEditor();
    const pluginInit = vi.fn();
    const pluginCleanup = vi.fn();

    const plugin = (e: LexicalEditor) => {
      pluginInit(e);
      return pluginCleanup;
    };

    const dispose = plugin(editor);

    expect(pluginInit).toHaveBeenCalledOnce();
    expect(pluginInit).toHaveBeenCalledWith(editor);

    dispose();
    expect(pluginCleanup).toHaveBeenCalledOnce();
  });
});
