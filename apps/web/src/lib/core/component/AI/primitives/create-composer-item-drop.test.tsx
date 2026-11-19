import { isEntityDragData } from '@app/features/entity/types/drag';
import type { EntityData } from '@app/features/entity/types/entity';
import {
  DocumentMentionNode,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
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
import { afterEach, describe, expect, it } from 'vitest';
import { mentionsPlugin } from '../../LexicalMarkdown/plugins/mentions';
import {
  composerItemToMention,
  createComposerItemDrop,
} from './create-composer-item-drop';

afterEach(cleanup);

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
    const drop = createComposerItemDrop({ editor, enabled: isEnabled });
    let root!: HTMLDivElement;
    onMount(() => editor.setRootElement(root));
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
      collisionDetector={(_source, targets) => targets[1] ?? null}
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
