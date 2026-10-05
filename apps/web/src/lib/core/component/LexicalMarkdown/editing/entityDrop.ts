/**
 * @file Dropping app items (documents, channels, media...) dragged from lists
 * into a markdown editor: media becomes inline media, everything else a
 * mention at the drop point.
 */

import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import type { BlockName } from '@core/block';
import { itemToBlockName } from '@core/constant/allBlocks';
import { trackMention } from '@core/signal/mention';
import { type EntityDragEvent, isEntityDragEvent } from '@entity';
import { throttle } from '@solid-primitives/scheduled';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import type { LexicalEditor } from 'lexical';
import type { Accessor } from 'solid-js';
import { INSERT_MEDIA_COMMAND } from '../plugins/media';
import {
  getValidDragInsertPosition,
  insertDocumentMentionAtDragInsertPosition,
  updateDragInsertPreviewFromCoordinates,
} from '../utils/dragInsertUtils';
import { getDragDropPosition } from '../utils/fileUploadUtils';
import type {
  MarkdownEditing,
  MarkdownEditingSource,
} from './registerMarkdownEditing';

/** Accept item drags over the editor; returns the `use:` droppable directive. */
export function useEditorEntityDrop(props: {
  editor: LexicalEditor;
  canEdit: Accessor<boolean>;
  dragInsert: MarkdownEditing['dragInsert'];
  source: MarkdownEditingSource;
}) {
  const { editor } = props;
  const [dragInsertStore, setDragInsertStore] = props.dragInsert;
  const droppable = createDroppable(editor._config.namespace, {
    type: 'markdown-editor',
  });

  const [dragDropState, { onDragEnd, onDragMove }] = useDragDropContext() ?? [
    undefined,
    {
      onDragEnd: () => {},
      onDragMove: () => {},
    },
  ];

  // turn the solid dnd events into something we can use.
  const wrapDndEvent = (event: EntityDragEvent) => {
    const currentPos = dragDropState?.active.sensor?.coordinates?.current;
    if (!currentPos) return;
    const mousePos = {
      clientX: currentPos.x,
      clientY: currentPos.y,
    };
    const item = event.draggable.data;
    if (item.type === 'foreign') return;
    const blockName = itemToBlockName(item);
    if (!blockName) return;
    let id = event.draggable.data.id as string;
    if (event.draggable.data.type === 'channel_message') {
      id = event.draggable.data.channelId;
    }
    return {
      id,
      blockName: blockName as BlockName,
      mousePos,
      item,
    };
  };

  const dndDragEnd = async (event: EntityDragEvent) => {
    if (!dragInsertStore.visible) return;
    setDragInsertStore({ visible: false });
    if (!props.canEdit()) return;

    const res = wrapDndEvent(event);
    if (!res) return;

    if (res.blockName === 'image' || res.blockName === 'video') {
      getDragDropPosition(editor, res.mousePos, true);
      editor.dispatchCommand(INSERT_MEDIA_COMMAND, {
        type: 'dss',
        id: res.id,
        mediaType: res.blockName,
      });
      return;
    }

    if (res.blockName === undefined) return;
    const dragInsertPosition = getValidDragInsertPosition(editor, res.mousePos);
    if (!dragInsertPosition) return;

    const mentionId = props.source.trackMentions
      ? await trackMention(
          props.source.id,
          res.item.type === 'agent_session' ? 'agent_session' : 'document',
          res.id
        )
      : undefined;

    let blockParams: Record<string, string> | undefined;
    if (res.blockName === 'channel') {
      blockParams = {};
      if (res.item.messageId) {
        blockParams[CHANNEL_PARAMS.message] = res.item.messageId;
      }
      if (res.item.threadId) {
        blockParams[CHANNEL_PARAMS.thread] = res.item.threadId;
      }
    }

    insertDocumentMentionAtDragInsertPosition(editor, dragInsertPosition, {
      documentId: res.id,
      documentName: res.item.name,
      blockName: res.blockName,
      blockParams,
      mentionUuid: mentionId,
      createdAt: Date.now(),
    });
  };

  const dndDragMove = throttle((event: EntityDragEvent) => {
    if (!droppable.isActiveDroppable) {
      return setDragInsertStore({ visible: false });
    }
    const res = wrapDndEvent(event);
    if (!res) return;
    const { mousePos } = res;
    updateDragInsertPreviewFromCoordinates({
      editor,
      coordinates: mousePos,
      setState: setDragInsertStore,
    });
  }, 60);

  onDragEnd((event) => {
    // dndDragMove is a trailing throttle, so a callback scheduled just before
    // the drop would otherwise fire after it and could re-show the indicator.
    dndDragMove.clear();
    // Only soup entity drags insert mentions (not e.g. sidebar favorite drags).
    if (!isEntityDragEvent(event)) return;
    dndDragEnd(event);
  });

  onDragMove((event) => {
    if (!isEntityDragEvent(event)) return;
    dndDragMove(event);
  });

  return droppable;
}
