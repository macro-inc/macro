import { Show } from 'solid-js';
import { InputFlag } from '../Input';
import type { MessageData } from '../Message';
import { SenderName } from '../Message/SenderName';
import type { ThreadState } from '../Thread';
import { ThreadReplyChannelInput } from '../Thread/ThreadReplyChannelInput';

/**
 * Thread-reply face of the unified-input mode. Registers into the same
 * `ThreadState` slots and persistence keys as the inline `ThreadReplyInput`,
 * so drafts and the reply-reference insertion flow are shared
 * between inline and unified-input modes.
 */
export function UnifiedReplyInput(props: {
  channelId: string;
  threadId: string;
  state: ThreadState;
  /**
   * The message the reply is bound to — a specific referenced reply,
   * otherwise the thread root.
   */
  getTargetMessage: () => MessageData | undefined;
  /**
   * Whether the target thread already has replies. When it does, the flag
   * reads "Replying to thread"; otherwise it names the message's sender.
   */
  threadHasReplies: () => boolean;
  onNavigateToTarget: () => void;
  onExit: () => void;
}) {
  return (
    <div
      data-keep-keyboard
      class="relative w-full flex flex-col items-center gap-1"
    >
      <InputFlag
        label={
          <Show
            when={!props.threadHasReplies() && props.getTargetMessage()}
            keyed
            fallback="Replying to thread"
          >
            {(target) => (
              <>
                Replying to <SenderName message={target} />
              </>
            )}
          </Show>
        }
        dismissLabel="Stop replying"
        onActivate={() => props.onNavigateToTarget()}
        onDismiss={() => props.onExit()}
      />
      <ThreadReplyChannelInput
        channelId={props.channelId}
        threadId={props.threadId}
        replyInputState={props.state.replyInputState}
        setReplyInputState={props.state.setReplyInputState}
        replyInputHandle={props.state.replyInputHandle}
        setReplyInputHandle={props.state.setReplyInputHandle}
        focusRequest={props.state.replyInputFocusRequest}
        host="unified"
        collapsible
        onExit={() => props.onExit()}
      />
    </div>
  );
}
