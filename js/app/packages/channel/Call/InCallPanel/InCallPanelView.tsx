import { For, Show, createMemo, type Component } from 'solid-js';
import type { CallControlVariant } from '../CallControls/CallControlButton';
import type { UserIconProps } from '@core/component/UserIcon';
import ArrowsOut from '@icon/regular/arrows-out.svg';
import { CallControls } from '../CallControls/CallControls';
import { openChannelCallTab } from '../openChannelCallTab';
import { InCallAvatarPlaceholderShell } from '../InCallPanel/InCallAvatarPlaceholder';
import { InCallParticipantAvatar } from '../InCallPanel/InCallParticipantAvatar';
import { InCallParticipantsListPopover } from '../CallControls/InCallParticipantsListPopover';
import type { InCallPanelProps } from '../InCallPanel/types';
import { useInCallPanel } from '../InCallPanel/useInCallPanel';
import { cn } from '@ui/utils/classname';

export const InCallPanel: Component<InCallPanelProps> = (props) => {
  const panel = useInCallPanel({
    channelId: props.channelId,
    onLeaveCall: props.onLeaveCall,
    onJoinCall: props.onJoinCall,
  });

  /** Memo so `props.isSlim` (boolean or accessor) always drives updates. */
  const isSlimLayout = createMemo((): boolean => {
    const v = props.isSlim;
    return typeof v === 'function' ? v() : v;
  });
  const slim = () => isSlimLayout();

  const showCallLabel = createMemo(() => !isSlimLayout());

  const onCallPage = createMemo(() => panel.callCtx.isCallPage());

  const showHeaderPulse = createMemo(
    () => !isSlimLayout() || (isSlimLayout() && onCallPage())
  );

  const visibleSlots = createMemo(() => panel.visibleAvatarSlots());
  const overflowMembersList = createMemo(() => panel.overflowMembers());

  const avatarSize = createMemo((): NonNullable<UserIconProps['size']> =>
    slim() ? 'xs' : 'md'
  );

  const controlsVariant = createMemo((): CallControlVariant =>
    slim() ? 'panel-small' : 'panel'
  );

  const showExpandToFullCall = createMemo(() => !onCallPage());

  const headerRowClass = createMemo(() =>
    cn(
      'py-1 px-2 border-b border-edge-muted bg-accent/5 rounded-t-lg flex items-center gap-1 min-w-0 w-full',
      !slim() || showExpandToFullCall()
        ? 'justify-between gap-0'
        : 'justify-center'
    )
  );

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
        class="relative isolate overflow-hidden rounded-lg border border-edge-muted"
      >
        <div class={headerRowClass()}>
          <div class={cn("flex min-w-0 shrink-0 items-center gap-0.5", slim() && !showExpandToFullCall() && 'p-1')}>
            <Show when={showHeaderPulse()}>
              <span
                class={cn(
                  'size-1.5 shrink-0 rounded-full bg-accent animate-pulse',
                  showCallLabel() && 'mr-1'
                )}
              />
            </Show>

            <Show when={showCallLabel()}>
              <span class="text-sm text-accent truncate">
                Call
              </span>
            </Show>
          </div>

          <Show when={showExpandToFullCall()}>
            <button
              type="button"
              class={cn(
                'shrink-0 transition-colors cursor-pointer hover:bg-accent/30 outline-0 outline-accent/50 hover:outline-1 hover-transition-outline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-edge-muted',
                slim() && 'animate-pulse hover:outline-0'
              )}
              title="Open full call view"
              aria-label="Open full call view"
              onClick={() => {
                const id = panel.callCtx.activeChannelId();

                if (id) void openChannelCallTab(id);
              }}
            >
              <ArrowsOut
                class={cn(
                  'text-accent',
                  slim() ? 'h-3.5 w-3.5' : 'h-4 w-4'
                )}
              />
            </button>
          </Show>
        </div>

        <div
          class={cn(
            'px-2 py-3 bg-panel rounded-b-lg',
            slim() && 'px-2 pt-2 pb-1 flex flex-col items-center gap-2'
          )}
        >
          <InCallParticipantsListPopover
            panel={panel}
            class={cn(slim() && 'justify-center')}
          >
            {avatarCluster()}
          </InCallParticipantsListPopover>

          <Show when={showCallLabel()}>
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
        </div>

        <div class={cn(!slim() && 'bg-panel border-t border-edge-muted', slim() && 'px-2 pt-1 pb-2')}>
          <CallControls
            variant={controlsVariant()}
            when={props.showCallControls}
            onLeave={() => panel.controls.leaveCall()}
          />
        </div>
      </section>
    </Show>
  );
};
