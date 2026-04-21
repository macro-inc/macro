import { For, Show, createMemo, type Component } from 'solid-js';
import type { CallControlVariant } from '../CallControls/CallControlButton';
import type { UserIconProps } from '@core/component/UserIcon';
import { tryMacroId, useDisplayName } from '@core/user';
import { isOk } from '@core/util/maybeResult';
import { commsServiceClient } from '@service-comms/client';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { Tooltip } from '@core/component/Tooltip';
import ArrowsOut from '@icon/regular/arrows-out.svg';
import { CallControls } from '../CallControls/CallControls';
import { openChannelCallTab } from '../openChannelCallTab';
import { InCallAvatarPlaceholderShell } from '../InCallPanel/InCallAvatarPlaceholder';
import { InCallParticipantAvatar } from '../InCallPanel/InCallParticipantAvatar';
import { InCallParticipantsListPopover } from './InCallParticipantsListPopover'
import { profilePictureIdForMember } from '../InCallPanel/profilePictureIdForMember';
import {
  IN_CALL_PANEL_CROWDED_MEMBER_THRESHOLD,
  IN_CALL_PANEL_VISIBLE_AVATAR_COUNT,
  IN_CALL_PANEL_VISIBLE_AVATAR_COUNT_CROWDED,
} from './members';
import type { InCallPanelMember, InCallPanelProps, InCallVisibleAvatarSlot, UseInCallPanelResult } from '../InCallPanel/types';
import { useInCallPanel } from '../InCallPanel/useInCallPanel';
import { cn } from '@ui/utils/classname';

function InCallAvatarButton(props: {
  panel: UseInCallPanelResult;
  member: InCallPanelMember;
  size: NonNullable<UserIconProps['size']>;
}) {
  const { replaceOrInsertSplit } = useSplitLayout();

  const raw = profilePictureIdForMember(props.panel, props.member);
  const [displayName] = useDisplayName(tryMacroId(raw ?? ''));
  const nameLabel = createMemo(() => {
    props.panel.callCtx.trackVersion();
    const r = profilePictureIdForMember(props.panel, props.member);
    return displayName() || r || (props.member.kind === 'local' ? 'You' : 'Participant');
  });

  const isRemote = () => props.member.kind === 'remote';

  const openDm = async () => {
    if (props.member.kind !== 'remote') return;
    const macroId = tryMacroId(props.member.participant.identity);
    if (!macroId) return;
    const result = await commsServiceClient.getOrCreateDirectMessage({
      recipient_id: macroId,
    });
    const channelId = isOk(result) && result[1]?.channel_id;
    if (channelId) replaceOrInsertSplit({ type: 'channel', id: channelId });
  };

  return (
    <Tooltip
      tooltip={nameLabel()}
      placement="top"
      class="inline-flex"
    >
      <button
        type="button"
        onClick={isRemote() ? openDm : undefined}
        class={cn(
          'inline-flex items-center justify-center rounded-full p-0 transition-opacity',
          isRemote() ? 'cursor-pointer hover:opacity-80' : 'cursor-default pointer-events-none'
        )}
        aria-label={isRemote() ? `Message ${nameLabel()}` : nameLabel()}
      >
        <InCallParticipantAvatar panel={props.panel} member={props.member} size={props.size} />
      </button>
    </Tooltip>
  );
}

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

  const orderedMembers = createMemo(() => [
    ...panel.visibleMembers(),
    ...panel.overflowMembers(),
  ]);

  /** Non-slim: first 4 when more than 5 in call; otherwise same cap as `useInCallPanel` (3). */
  const visibleSlotsNonSlim = createMemo((): InCallVisibleAvatarSlot[] => {
    if (!panel.isActive()) return [];
    const members = orderedMembers();
    if (members.length === 0) {
      return [{ type: 'placeholder', key: 'connecting' }];
    }
    const crowded = members.length > IN_CALL_PANEL_CROWDED_MEMBER_THRESHOLD;
    const cap = crowded
      ? IN_CALL_PANEL_VISIBLE_AVATAR_COUNT_CROWDED
      : IN_CALL_PANEL_VISIBLE_AVATAR_COUNT;
    return members.slice(0, cap).map((member) => ({
      type: 'member' as const,
      member,
      key: member.kind === 'local' ? 'local' : member.participant.sid,
    }));
  });

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
          <div
            class={cn(
              'flex flex-row items-center gap-1 leading-none',
              slim() ? 'justify-center' : 'justify-between'
            )}
            data-in-call-panel-avatars
          >
            <Show when={!slim()}>
              <For each={visibleSlotsNonSlim()}>
                {(slot) => (
                  <>
                    {slot.type === 'member' ? (
                      <InCallAvatarButton
                        panel={panel}
                        member={slot.member}
                        size={avatarSize()}
                      />
                    ) : (
                      <InCallAvatarPlaceholderShell size={avatarSize()} />
                    )}
                  </>
                )}
              </For>
            </Show>

            <InCallParticipantsListPopover
              panel={panel}
              size={slim() ? 'slim' : 'default'}
            />
          </div>
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
