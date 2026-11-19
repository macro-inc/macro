import { isEntityDragData } from '@app/features/entity/types/drag';
import type { EntityData } from '@app/features/entity/types/entity';
import { startUiOperation } from '@app/observability/ui-operation';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { itemToBlockName } from '@core/constant/allBlocks';
import { Telemetry } from '@macro-inc/observability';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { $getRoot, $getSelection, type LexicalEditor } from 'lexical';
import { createSignal, createUniqueId, onCleanup } from 'solid-js';
import { INSERT_DOCUMENT_MENTION_COMMAND } from '../../LexicalMarkdown/plugins/mentions';
import type { ChatAttachmentMention } from '../util/chatAttachmentMention';

/** Use the same entity names, task aliases and channel targets as the mention menu. */
export function composerItemToMention(
  item: EntityData
): ChatAttachmentMention | undefined {
  if (item.type === 'foreign') return;

  const mention: ChatAttachmentMention = {
    documentId: item.id,
    documentName: item.name,
    blockName: itemToBlockName(item),
  };

  if (
    item.type === 'channel' ||
    item.type === 'channel_message' ||
    item.type === 'channel_thread'
  ) {
    mention.channelType = item.channelType;
    const target = item.target;
    const messageId =
      target?.messageId ?? ('messageId' in item ? item.messageId : undefined);
    const threadId =
      target?.threadId ?? ('threadId' in item ? item.threadId : undefined);
    mention.blockParams = {};
    if (item.type !== 'channel') mention.documentId = item.channelId;
    if (messageId) mention.blockParams[CHANNEL_PARAMS.message] = messageId;
    if (threadId) mention.blockParams[CHANNEL_PARAMS.thread] = threadId;
  }

  return mention;
}

/** Register the whole composer, not only its editable text, as an item target. */
export function createComposerItemDrop(options: {
  editor: () => LexicalEditor;
  enabled: () => boolean;
}) {
  const context = useDragDropContext();
  if (!context)
    return {
      ref: (_element: HTMLElement) => {},
      isDraggedOver: () => false,
      onConnect: () => {},
    };

  // MarkdownShell owns editor creation and plugin registration. A composer
  // surface can exist first, so do not read the builder until its onConnect.
  const [connected, setConnected] = createSignal(false);
  onCleanup(() => setConnected(false));
  const enabled = () => connected() && options.enabled();
  const [state, { onDragEnd }] = context;
  const accepts = () => {
    const data = state.active.draggable?.data;
    return enabled() && isEntityDragData(data) && !!composerItemToMention(data);
  };
  const id = `composer-item-${createUniqueId()}`;
  const droppable = createDroppable(id, {
    isDropTargetDisabled: () => !accepts(),
  });

  onDragEnd((event) => {
    if (event.droppable?.id !== id || !enabled()) return;
    const editor = options.editor();
    if (!editor.getRootElement()?.isConnected) return;
    const data = event.draggable.data;
    if (!isEntityDragData(data)) return;
    const items = data.selection?.entities() ?? [data];
    const mentions = items.flatMap((item) => {
      const mention = composerItemToMention(item);
      return mention ? [mention] : [];
    });
    if (!mentions.length) return;

    const operation = startUiOperation('composer.item_drop', {
      attributes: {
        'entity.id': data.id,
        'entity.type': data.type,
        'composer.item_count': mentions.length,
      },
    });
    try {
      operation.run(() => {
        editor.update(
          () => {
            // List drags leave no editor selection. Append rather than replacing the draft.
            if (!$getSelection()) $getRoot().selectEnd();
            for (const mention of mentions) {
              editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, mention);
            }
          },
          { discrete: true }
        );
        editor.focus();
      });
      operation.afterPaint();
    } catch (error) {
      operation.span.error('Failed to add composer context');
      operation.finish('error');
      Telemetry.error(error, { surface: 'composer-item-drop' });
    }
  });

  return {
    ref: droppable.ref,
    onConnect: () => setConnected(true),
    isDraggedOver: () => droppable.isActiveDroppable && accepts(),
  };
}
