import { For, Show, createMemo, type Component } from 'solid-js';
import type { UserIconProps } from '@core/component/UserIcon';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import ArrowsOut from '@icon/regular/arrows-out.svg';
import { CallControls } from '../CallControls';
import { openChannelCallTab } from '../openChannelCallTab';
import { InCallAvatarPlaceholderShell } from './InCallAvatarPlaceholder';
import { InCallParticipantAvatar } from './InCallParticipantAvatar';
import { InCallParticipantsListPopover } from './InCallParticipantsListPopover';
import type { InCallPanelProps } from './types';
import { useInCallPanel } from './useInCallPanel';
import { cn } from '@ui/utils/classname';

export const InCallPanel: Component<InCallPanelProps> = (props) => {
  const panel = useInCallPanel({
    channelId: props.channelId,
    onLeaveCall: props.onLeaveCall,
    onJoinCall: props.onJoinCall,
  });

  const visibleSlots = createMemo(() => panel.visibleAvatarSlots());
  const overflowMembersList = createMemo(() => panel.overflowMembers());

  const avatarSize = createMemo((): NonNullable<UserIconProps['size']> =>
    props.isSlim ? 'xs' : 'md'
  );

  // const showOpenFullCallButton = createMemo(() => {
  //   if (!ENABLE_CALLS()) return false;
  //   if (!panel.callCtx.activeChannelId()) return false;
  //   return !panel.callCtx.isCallPage();
  // });

  const avatarCluster = createMemo(() => (
    <div
      class="flex flex-row flex-wrap items-center gap-1"
      data-in-call-panel-avatars
    >
      <For each={visibleSlots()}>
        {(slot) => (
          <div data-in-call-panel-avatar>
            {slot.type === 'member' ? (
              <InCallParticipantAvatar
                panel={panel}
                member={slot.member}
                size={avatarSize()}
              />
            ) : (
              <InCallAvatarPlaceholderShell size={avatarSize()} />
            )}
          </div>
        )}
      </For>
    </div>
  ));

  return (
    <Show when={() => panel.isActive()}>
      <section
        data-in-call-panel
        aria-label="In call"
        class="rounded-lg border border-edge-muted"
      >
        <div
          class={cn(
            'py-1 px-2 border-b border-edge-muted bg-accent/5 rounded-t-lg flex items-center gap-1 min-w-0',
            props.isSlim ? 'justify-center' : 'justify-between'
          )}
        >
          <div class="flex min-w-0 items-center gap-0.5">
            <span
              class={cn(
                'size-1.5 shrink-0 rounded-full bg-accent animate-pulse',
                !props.isSlim && 'mr-1'
              )}
            />
            <Show when={!props.isSlim}>
              <span class="text-sm text-accent animate-pulse truncate">
                Call
              </span>
            </Show>
          </div>

          <Show when={!panel.callCtx.isCallPage()}>
            <button
              type="button"
              class="shrink-0 transition-colors cursor-pointer hover:bg-accent/30 outline-0 outline-accent/50 hover:outline-1 hover-transition-outline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-edge-muted"
              title="Open full call view"
              aria-label="Open full call view"
              onClick={() => {
                const id = panel.callCtx.activeChannelId();
                if (id) void openChannelCallTab(id);
              }}
            >
              <ArrowsOut
                class={cn('text-accent',props.isSlim ? 'h-3.5 w-3.5' : 'h-4 w-4')}
              />
            </button>
          </Show>
        </div>

        <div class={cn("p-2 bg-panel rounded-b-lg", props.isSlim && "p-1 flex flex-col items-center")}>
          <InCallParticipantsListPopover panel={panel} class={cn(props.isSlim && "justify-center")}>
            {avatarCluster()}
          </InCallParticipantsListPopover>

          <Show when={() => !props.isSlim}>
            <div
              class="flex flex-row flex-wrap items-center gap-1"
              data-in-call-panel-overflow
            >
              <For each={overflowMembersList()}>
                {(member) => (
                  <div data-in-call-panel-avatar>
                    <InCallParticipantAvatar
                      panel={panel}
                      member={member}
                      size="sm"
                    />
                  </div>
                )}
              </For>
            </div>
          </Show>

          <div data-in-call-panel-controls>
            <CallControls
              variant={props.isSlim ? "panel-small" : "panel"}
              when={props.showCallControls}
              onLeave={() => panel.controls.leaveCall()}
              class="pt-2"
            />
          </div>
        </div>
      </section>
    </Show>
  );
};
