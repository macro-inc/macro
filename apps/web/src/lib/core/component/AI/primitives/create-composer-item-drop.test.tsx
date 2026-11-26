import { isEntityDragData } from '@app/features/entity/types/drag';
import type { EntityData } from '@app/features/entity/types/entity';
import {
  buildConfig,
  type EditorConfigBuilder,
} from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import {
  DocumentMentionNode,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import { Telemetry } from '@macro-inc/observability';
import { cleanup, render } from '@solidjs/testing-library';
import {
  createDraggable,
  DragDropProvider,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $nodesOfType,
  $setSelection,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mentionsPlugin } from '../../LexicalMarkdown/plugins/mentions';
import {
  composerItemToMention,
  createComposerItemDrop,
} from './create-composer-item-drop';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('composer item context', () => {
  it('preserves email, task, document and project identity in context mentions', () => {
    const items: EntityData[] = [
      {
        type: 'email',
        id: 'thread',
        name: 'Subject',
        ownerId: 'owner',
        isRead: true,
        isDraft: false,
        isImportant: false,
        done: false,
      },
      {
        type: 'document',
        id: 'task',
        name: 'Task',
        ownerId: 'owner',
        fileType: 'md',
        subType: { type: 'task', is_completed: false },
      },
      {
        type: 'document',
        id: 'pdf',
        name: 'Report',
        ownerId: 'owner',
        fileType: 'pdf',
      },
      { type: 'project', id: 'folder', name: 'Folder', ownerId: 'owner' },
    ];
    expect(items.map(composerItemToMention)).toEqual([
      { documentId: 'thread', documentName: 'Subject', blockName: 'email' },
      { documentId: 'task', documentName: 'Task', blockName: 'task' },
      { documentId: 'pdf', documentName: 'Report', blockName: 'pdf' },
      { documentId: 'folder', documentName: 'Folder', blockName: 'project' },
    ]);
  });

  it('references the parent channel and retains a message target', () => {
    expect(
      composerItemToMention({
        type: 'channel_message',
        id: 'message',
        channelId: 'channel',
        channelName: 'Channel',
        name: 'Message',
        channelType: 'private',
        messageId: 'message',
        threadId: 'thread',
        senderId: 'sender',
        content: '',
        ownerId: 'owner',
      })
    ).toEqual({
      documentId: 'channel',
      documentName: 'Message',
      blockName: 'channel',
      channelType: 'private',
      blockParams: {
        channel_message_id: 'message',
        channel_thread_id: 'thread',
      },
    });
  });
});

function contextIds(editor: LexicalEditor) {
  return editor.read(() =>
    $getRoot()
      .getAllTextNodes()
      .map((node) => node.getTextContent())
  );
}

function setupDrop(items: EntityData[]) {
  let context!: NonNullable<ReturnType<typeof useDragDropContext>>;
  let enabled!: (value: boolean) => void;
  const editors: LexicalEditor[] = [];
  function Composer() {
    const editor = createEditor({
      nodes: [...SupportedNodeTypes],
      onError: (error) => {
        throw error;
      },
    });
    editors.push(editor);
    onCleanup(mentionsPlugin({})(editor));
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('Keep this draft. '))
        );
        $setSelection(null);
      },
      { discrete: true }
    );
    const drop = createComposerItemDrop({
      editor: () => editor,
      enabled: isEnabled,
    });
    let root!: HTMLDivElement;
    onMount(() => {
      editor.setRootElement(root);
      drop.onConnect();
    });
    onCleanup(() => editor.setRootElement(null));
    return (
      <div ref={drop.ref}>
        <div ref={root} contentEditable />
      </div>
    );
  }
  const [isEnabled, setEnabled] = createSignal(true);
  enabled = setEnabled;
  function Harness() {
    context = useDragDropContext()!;
    const draggable = createDraggable('source', {
      ...items[0],
      dragType: 'entity',
      operation: () => 'move',
      selection: {
        entities: () => items,
        selected: () => items,
        clear: () => {
          throw new Error('Context drops must not clear selection');
        },
      },
    });
    return (
      <>
        <div ref={draggable.ref} />
        <Composer />
        <Composer />
      </>
    );
  }
  render(() => (
    <DragDropProvider
      collisionDetector={(_source, targets) => {
        const target = targets[1];
        const disabled = target?.data.isDropTargetDisabled;
        if (typeof disabled === 'function' && disabled()) return null;
        return target ?? null;
      }}
    >
      <Harness />
    </DragDropProvider>
  ));
  return {
    editors,
    enabled,
    drop: () => {
      context[1].dragStart('source');
      context[1].dragEnd();
    },
  };
}

describe('composer item drop integration', () => {
  it('rejects drag-over and drop before MarkdownShell connects without reading the builder or reporting errors', () => {
    let context!: NonNullable<ReturnType<typeof useDragDropContext>>;
    let builder!: EditorConfigBuilder;
    let drop!: ReturnType<typeof createComposerItemDrop>;
    const readEditor = vi.fn(() => builder.lexical);
    const reportError = vi.spyOn(Telemetry, 'error');
    function PendingComposer() {
      context = useDragDropContext()!;
      builder = buildConfig('chat').withMentions();
      const source = createDraggable('pending-source', {
        type: 'document',
        id: 'document',
        name: 'Document',
        ownerId: 'owner',
        fileType: 'md',
        dragType: 'entity',
        operation: () => 'move',
      });
      drop = createComposerItemDrop({
        editor: readEditor,
        enabled: () => true,
      });
      return (
        <>
          <div ref={source.ref} />
          <div ref={drop.ref} />
        </>
      );
    }
    render(() => (
      <DragDropProvider
        collisionDetector={(_source, targets) => targets[0] ?? null}
      >
        <PendingComposer />
      </DragDropProvider>
    ));
    expect(() => builder.lexical).toThrow(
      'editor.lexical accessed before <MarkdownShell> mounted'
    );
    context[1].dragStart('pending-source');
    expect(drop.isDraggedOver()).toBe(false);
    context[1].dragEnd();
    expect(readEditor).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('rejects a drop after the editor root detaches', () => {
    const { editors, drop } = setupDrop([
      {
        type: 'document',
        id: 'document',
        name: 'Document',
        ownerId: 'owner',
        fileType: 'md',
      },
    ]);
    const reportError = vi.spyOn(Telemetry, 'error');
    editors[1].setRootElement(null);
    drop();
    expect(contextIds(editors[1])).toEqual(['Keep this draft. ']);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('appends dropped context after the draft even when the old caret is at the start', () => {
    const { editors, drop } = setupDrop([
      {
        type: 'document',
        id: 'document',
        name: 'Context',
        ownerId: 'owner',
        fileType: 'md',
      },
    ]);
    editors[1].update(() => $getRoot().selectStart(), { discrete: true });
    drop();
    expect(editors[1].read(() => $getRoot().getTextContent())).toMatch(
      /^Keep this draft\. /
    );
    expect(
      editors[1].read(() =>
        $nodesOfType(DocumentMentionNode).map((node) => node.getDocumentId())
      )
    ).toEqual(['document']);
  });

  it('rejects documents with an unrecognized file type instead of inserting an unknown mention', () => {
    const document: EntityData = {
      type: 'document',
      id: 'document',
      name: 'Unsupported',
      ownerId: 'owner',
      fileType: 'unsupported-file-type',
    };
    expect(composerItemToMention(document)).toBeUndefined();
    const { editors, drop } = setupDrop([document]);
    drop();
    expect(editors[1].read(() => $nodesOfType(DocumentMentionNode))).toEqual(
      []
    );
    expect(contextIds(editors[1])).toEqual(['Keep this draft. ']);
  });
  it('keeps supported selected context when the dragged row has an unknown file type', () => {
    const { editors, drop } = setupDrop([
      {
        type: 'document',
        id: 'unknown',
        name: 'Unknown',
        ownerId: 'owner',
        fileType: 'unsupported-file-type',
      },
      {
        type: 'document',
        id: 'supported',
        name: 'Context',
        ownerId: 'owner',
        fileType: 'md',
      },
    ]);
    drop();
    expect(
      editors[1].read(() =>
        $nodesOfType(DocumentMentionNode).map((node) => node.getDocumentId())
      )
    ).toEqual(['supported']);
  });

  it('adds the selected items once to the targeted editor without replacing its draft', () => {
    const { editors, drop } = setupDrop([
      {
        type: 'email',
        id: 'thread',
        name: 'Subject',
        ownerId: 'owner',
        isRead: true,
        isDraft: false,
        isImportant: false,
        done: false,
      },
      {
        type: 'document',
        id: 'task',
        name: 'Task',
        ownerId: 'owner',
        fileType: 'md',
        subType: { type: 'task', is_completed: false },
      },
    ]);
    drop();
    expect(contextIds(editors[0])).toEqual(['Keep this draft. ']);
    expect(
      editors[1].read(() => {
        const paragraph = $getRoot().getFirstChildOrThrow();
        return paragraph.getTextContent();
      })
    ).toContain('Keep this draft. ');
    expect(
      editors[1].read(() => {
        return $nodesOfType(DocumentMentionNode).map((node) =>
          node.getDocumentId()
        );
      })
    ).toEqual(['thread', 'task']);
  });

  it('accepts native project rows as initiative context, not Drive folders', () => {
    const project: EntityData = {
      type: 'initiative',
      id: 'native-project',
      name: 'Project',
      ownerId: 'owner',
    };
    expect(
      isEntityDragData({
        ...project,
        dragType: 'entity',
        operation: () => 'move',
      })
    ).toBe(true);
    const { editors, drop } = setupDrop([project]);
    drop();
    expect(
      editors[1].read(() =>
        $nodesOfType(DocumentMentionNode).map((node) => ({
          id: node.getDocumentId(),
          block: node.getBlockName(),
        }))
      )
    ).toEqual([{ id: 'native-project', block: 'initiative' }]);
  });
  it('does not change a disabled composer', () => {
    const { editors, enabled, drop } = setupDrop([
      {
        type: 'email',
        id: 'thread',
        name: 'Subject',
        ownerId: 'owner',
        isRead: true,
        isDraft: false,
        isImportant: false,
        done: false,
      },
    ]);
    enabled(false);
    drop();
    expect(contextIds(editors[1])).toEqual(['Keep this draft. ']);
  });
});
