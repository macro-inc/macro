import { DebugSuspense } from '@channel/DebugSuspense';
import { useChannelName } from '@core/context/channels';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Scroll } from '@ui';
import { Show } from 'solid-js';
import { EditableThread } from '../StandaloneThread';
import type { ChannelThreadPanel as ThreadPanelState } from './thread-panel';

/**
 * Thread pane beside the channel's messages: the root message,
 * every reply, and a reply composer that stays open.
 */
export function ChannelThreadPanel(props: {
  channelId: string;
  threadId: string;
  panel: ThreadPanelState;
}) {
  const channelName = useChannelName(props.channelId);

  return (
    <aside
      aria-label="Thread"
      class="flex min-h-0 w-[26rem] shrink-0 flex-col border-l border-edge-muted @max-[44rem]/channel-body:w-full @max-[44rem]/channel-body:border-l-0"
      data-channel-thread-panel
    >
      <div class="flex h-10 shrink-0 items-center gap-2 pr-2 pl-4">
        <div class="flex min-w-0 flex-1 items-baseline gap-2">
          <span class="text-sm font-semibold">Thread</span>
          <Show when={channelName()}>
            {(name) => (
              <span class="ph-no-capture truncate text-xs text-ink-muted">
                {name()}
              </span>
            )}
          </Show>
        </div>
        <Button
          aria-label="Close thread"
          tooltip="Close thread"
          variant="ghost"
          size="icon-sm"
          onClick={() => props.panel.close()}
        >
          <XIcon class="size-3.5 shrink-0 pointer-events-none" />
        </Button>
      </div>
      <Scroll class="min-h-0 flex-1">
        <div class="ph-no-capture px-2 pb-4">
          <DebugSuspense name="ChannelThreadPanel.thread">
            <Show when={props.threadId} keyed>
              {(threadId) => (
                <EditableThread
                  channelId={props.channelId}
                  messageId={threadId}
                  expanded
                  keepReplying
                  replyInputFocusRequest={props.panel.replyFocusRequest}
                />
              )}
            </Show>
          </DebugSuspense>
        </div>
      </Scroll>
    </aside>
  );
}
