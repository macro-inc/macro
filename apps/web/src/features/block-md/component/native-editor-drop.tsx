import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { DragInsertIndicator } from '@core/component/LexicalMarkdown/component/misc/DragInsertIndicator';
import { createDragInsertStore } from '@core/component/LexicalMarkdown/plugins/drag-insert/dragInsertPlugin';
import {
  calculateNativeInsertPoint,
  type NativeInsertPoint,
  placeAtInsertion,
} from '@core/component/LexicalMarkdown/plugins/drag-insert/native';
import { ownsNativeBlockDrag } from '@core/component/LexicalMarkdown/plugins/draggable-block/native';
import { dispatchApplicationCommandSettledIfSessionEdit } from '@core/component/LexicalMarkdown/plugins/group-b/command';
import { itemToBlockName } from '@core/constant/allBlocks';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { trackMention } from '@core/signal/mention';
import { fireAndForget } from '@core/util/fireAndForget';
import { type EntityDragEvent, isEntityDragEvent } from '@entity';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import {
  createViewCommand,
  DROP_COMMAND,
} from '@macro-inc/lexical-wasm-view/view/commands';
import { throttle } from '@solid-primitives/scheduled';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { type Accessor, onCleanup } from 'solid-js';

// Source dragInsertPlugin overrides DRAGOVER/DROP at COMMAND_PRIORITY_HIGH.
const HIGH = 3;
// Source dragInsertPlugin and useEditorEntityDrop paddings.
const COLLISION_PADDING = 8;
const DRAG_EVENT_PADDING = 8;

const DRAGOVER = createViewCommand(
  'Dragover',
  (payload): payload is DragEvent => payload instanceof DragEvent
);

const carriesFiles = (event: DragEvent) =>
  event.dataTransfer?.types.includes('Files') ?? false;

/**
 * Source drops on the document body for the native editor: the dragInsertPlugin
 * indicator, OS files placed at the block insertion point (fileFolderDrop ->
 * dropFiles), sidebar items as a wrapped mention beside a block or as inline
 * media (useEditorEntityDrop), and no other drop (Source DROP_COMMAND -> true).
 */
export function createNativeEditorDrop(options: {
  view: Accessor<EditorView | undefined>;
  canEdit: Accessor<boolean>;
  /** Source editingSource.id: the document that tracks dropped mentions. */
  sourceId: Accessor<string>;
  /** The solid-dnd droppable id (Source uses the editor namespace). */
  droppableId: string;
  dropFiles(
    files: FileSystemFileEntry[],
    folders: FileSystemDirectoryEntry[],
    at: NativeInsertPoint | null
  ): void;
}) {
  const [indicator, setIndicator] = createDragInsertStore();
  const hide = () => setIndicator({ visible: false });
  const show = (point: NativeInsertPoint | null) => {
    if (!point) return hide();
    setIndicator({
      nodeKey: String(point.key),
      position: point.position,
      visible: true,
    });
  };

  /** Source dragInsertPlugin over the view's own drag events. */
  const bindView = (view: EditorView) => {
    const releaseOver = view.registerViewCommand(
      DRAGOVER,
      (event) => {
        if (event.dataTransfer && ownsNativeBlockDrag(view, event.dataTransfer))
          return false;
        event.preventDefault();
        show(
          calculateNativeInsertPoint(
            view,
            event,
            COLLISION_PADDING,
            carriesFiles(event)
          )
        );
        return true;
      },
      HIGH
    );
    const releaseDrop = view.registerViewCommand(
      DROP_COMMAND,
      (event) => {
        if (event.dataTransfer && ownsNativeBlockDrag(view, event.dataTransfer))
          return false;
        event.preventDefault();
        hide();
        return true;
      },
      HIGH
    );
    return () => {
      releaseOver();
      releaseDrop();
      hide();
    };
  };

  /** Source fileFolderDrop -> editing.dropFiles on the editor container. */
  const connectFiles = (container: HTMLElement) =>
    fileFolderDrop(container, () => ({
      onDrop: (files, folders, event) => {
        const view = options.view();
        if (!event || !view) return;
        options.dropFiles(
          files,
          folders,
          calculateNativeInsertPoint(view, event, DRAG_EVENT_PADDING, true)
        );
      },
    }));

  // solid-dnd registers a droppable in onMount of its creating owner, so it
  // is created where the container is connected (Source passes it at mount).
  let droppable: ReturnType<typeof createDroppable> | undefined;
  const [dragDropState, { onDragEnd, onDragMove }] = useDragDropContext() ?? [
    undefined,
    { onDragEnd: () => {}, onDragMove: () => {} },
  ];

  // Source wrapDndEvent.
  const wrapDndEvent = (event: EntityDragEvent) => {
    const current = dragDropState?.active.sensor?.coordinates?.current;
    if (!current) return;
    const mousePos = { clientX: current.x, clientY: current.y };
    const item = event.draggable.data;
    if (item.type === 'foreign') return;
    const blockName = itemToBlockName(item);
    if (!blockName) return;
    const id =
      item.type === 'channel_message' ? item.channelId : String(item.id);
    return { id, blockName, mousePos, item };
  };

  const dropEntity = async (event: EntityDragEvent) => {
    if (!indicator.visible) return;
    hide();
    const view = options.view();
    if (!options.canEdit() || !view) return;
    const dropped = wrapDndEvent(event);
    if (!dropped) return;
    const generation = view.mirror.keyGeneration;
    if (generation === null) return;
    const fresh = () =>
      view.isMounted && view.mirror.keyGeneration === generation;

    if (dropped.blockName === 'image' || dropped.blockName === 'video') {
      // Source getDragDropPosition(editor, mousePos, true), then INSERT_MEDIA.
      const at = calculateNativeInsertPoint(
        view,
        dropped.mousePos,
        DRAG_EVENT_PADDING,
        true
      );
      if (at && !(await placeAtInsertion(view, at, fresh))) return;
      const inserted = await dispatchApplicationCommandSettledIfSessionEdit(
        view,
        'group-b.media',
        () => ({
          action: 'insert',
          kind: dropped.blockName,
          media: { srcType: 'dss', id: dropped.id },
        }),
        { admit: fresh }
      );
      if (inserted.status === 'error') throw inserted.error;
      return;
    }

    const at = calculateNativeInsertPoint(
      view,
      dropped.mousePos,
      COLLISION_PADDING
    );
    if (!at) return;
    // Source editingSource.trackMentions is true for the document body.
    const mentionUuid = await trackMention(
      options.sourceId(),
      dropped.item.type === 'agent_session' ? 'agent_session' : 'document',
      dropped.id
    );
    const blockParams: Record<string, string> = {};
    if (dropped.blockName === 'channel') {
      if (dropped.item.messageId)
        blockParams[CHANNEL_PARAMS.message] = dropped.item.messageId;
      if (dropped.item.threadId)
        blockParams[CHANNEL_PARAMS.thread] = dropped.item.threadId;
    }
    const result = await dispatchApplicationCommandSettledIfSessionEdit(
      view,
      'group-b.drop-document-mention',
      () => ({
        key: at.key,
        before: at.position === 'before',
        mention: {
          documentId: dropped.id,
          documentName: dropped.item.name,
          blockName: dropped.blockName,
          ...(dropped.blockName === 'channel' ? { blockParams } : {}),
          ...(mentionUuid === undefined ? {} : { mentionUuid }),
          createdAt: Date.now(),
        },
      }),
      { admit: fresh }
    );
    if (result.status === 'error') throw result.error;
  };

  const dragMove = throttle((event: EntityDragEvent) => {
    const view = options.view();
    if (!droppable?.isActiveDroppable || !view) return hide();
    const dropped = wrapDndEvent(event);
    if (!dropped) return;
    show(calculateNativeInsertPoint(view, dropped.mousePos, COLLISION_PADDING));
  }, 60);

  onDragEnd((event) => {
    // Source: a trailing throttled move must not re-show the indicator.
    dragMove.clear();
    if (!isEntityDragEvent(event)) return;
    fireAndForget(dropEntity(event), 'native-markdown-entity-drop');
  });
  onDragMove((event) => {
    if (!isEntityDragEvent(event)) return;
    dragMove(event);
  });

  return {
    bindView,
    connect(container: HTMLElement) {
      connectFiles(container);
      const connected = createDroppable(options.droppableId, {
        type: 'markdown-editor',
      });
      connected(container);
      droppable = connected;
      onCleanup(() => {
        if (droppable === connected) droppable = undefined;
      });
    },
    Indicator: () => (
      <DragInsertIndicator
        state={indicator}
        active={options.canEdit()}
        host={{
          element: (key) =>
            options.view()?.getElementByKey(Number(key)) ?? null,
          root: () => options.view()?.root ?? null,
        }}
      />
    ),
  };
}
