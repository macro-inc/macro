import {
  type Accessor,
  createSignal,
  onCleanup,
  type Setter,
  Show,
} from 'solid-js';
import { createEntityDropZone } from '../Channel/create-entity-drop-zone';
import type { InputHandle, InputSnapshot } from '../Input';
import type { FocusRequest } from './focus-request';
import { ThreadReplyChannelInput } from './ThreadReplyChannelInput';
import { ThreadReplyInputConnector } from './ThreadReplyInputConnector';
import { replyInputOffsetX } from './utils/thread-rail-geometry';

type ThreadReplyInputProps = {
  channelId: string;
  messageId: string;
  replyInputState: Accessor<InputSnapshot | undefined>;
  setReplyInputState: Setter<InputSnapshot | undefined>;
  setIsReplying: Setter<boolean>;
  replyInputHandle?: Accessor<InputHandle | undefined>;
  setReplyInputEl?: Setter<HTMLElement | undefined>;
  setReplyInputHandle?: Setter<InputHandle | undefined>;
  focusRequest?: FocusRequest;
  /**
   * Render the rail connector chrome. On by default for inner-rail consumers
   * (standalone threads, discussions); channels have no inner rail.
   */
  connector?: boolean;
  /** Rail column from which the optional connector should originate. */
  connectorRail?: 'inner' | 'thread';
  /** Optional layout-specific horizontal anchor for the composer. */
  offsetX?: string;
};

/**
 * Inline face of the thread reply input: thread-rail chrome and entity drops
 * around the shared `ThreadReplyChannelInput` wiring.
 */
export function ThreadReplyInput(props: ThreadReplyInputProps) {
  onCleanup(() => {
    props.setReplyInputEl?.(undefined);
  });

  const [replyInputHandle, setLocalReplyInputHandle] =
    createSignal<InputHandle>();

  const entityDropZone = createEntityDropZone({
    droppableId: `thread-reply-entity-drop-${props.messageId}`,
    onDropEntity: (entity, coordinates) =>
      replyInputHandle()?.insertEntityMention?.(entity, coordinates),
    onDragEntityMove: (coordinates) =>
      replyInputHandle()?.previewEntityMentionInsertion?.(coordinates),
    onDragEntityEnd: () =>
      replyInputHandle()?.clearEntityMentionInsertionPreview?.(),
  });

  return (
    <div
      class="relative pt-2"
      style={{ 'margin-left': props.offsetX ?? replyInputOffsetX }}
      ref={(el) => props.setReplyInputEl?.(el)}
      data-reply-input
    >
      <Show when={props.connector !== false}>
        <ThreadReplyInputConnector rail={props.connectorRail} />
      </Show>
      {(() => {
        const droppable = entityDropZone.droppable;
        false && droppable;
        return (
          <div class="relative" use:droppable>
            <ThreadReplyChannelInput
              channelId={props.channelId}
              threadId={props.messageId}
              replyInputState={props.replyInputState}
              setReplyInputState={props.setReplyInputState}
              replyInputHandle={props.replyInputHandle}
              setReplyInputHandle={props.setReplyInputHandle}
              focusRequest={props.focusRequest}
              onReady={setLocalReplyInputHandle}
              onExit={() => props.setIsReplying(false)}
            />
          </div>
        );
      })()}
    </div>
  );
}
