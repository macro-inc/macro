import { StackedAvatarsRow } from '@core/component/StackedAvatarsRow';
import PhoneDisconnect from '@icon/wide-call-disconnect.svg';
import ArrowsOut from '@phosphor/arrows-out.svg';
import { cn, Surface } from '@ui';
import { type Component, createMemo, Show } from 'solid-js';
import type { CallControlsVariant } from '../CallControls/CallControls';
import { CallControls } from '../CallControls/CallControls';
import type { InCallPanelProps } from '../InCallPanel/types';
import { openChannelCallTab } from '../open-channel-call-tab';
import {
  InCallParticipantsListPopover,
  InCallRosterListSection,
} from './InCallParticipantsListPopover';
import {
  IN_CALL_LOCAL_STRIP_PENDING_ID,
  IN_CALL_STRIP_IMAGE_SIZE,
  InCallStripAvatarImage,
  type InCallStripImage,
} from './InCallStripAvatarImage';
import { profilePictureIdForMember } from './profile-picture-id-for-member';
import { useInCallPanel } from './use-in-call-panel';

export const InCallPanel: Component<InCallPanelProps> = (props) => {
  const panel = useInCallPanel({
    channelId: props.channelId,
    onLeaveCall: props.onLeaveCall,
    onJoinCall: props.onJoinCall,
  });
  const slim = createMemo((): boolean => {
    const v = props.isSlim;
    return typeof v === 'function' ? v() : v;
  });

  const onCallPage = createMemo(() => panel.callCtx.isCallPage());

  // Hide the pulse in the slim sidebar unless we're on the active call page,
  // so the icon-only strip doesn't read as a distracting live indicator.
  const showHeaderPulse = () => !slim() || onCallPage();

  const orderedMembers = createMemo(() => [
    ...panel.visibleMembers(),
    ...panel.overflowMembers(),
  ]);

  const stripStackEach = createMemo((): InCallStripImage[] => {
    if (!panel.isActive()) return [];
    const out: InCallStripImage[] = [];
    for (const member of orderedMembers()) {
      if (member.kind === 'local') {
        const id = profilePictureIdForMember(panel, member);
        if (id) {
          out.push({ userId: id, stripMemberKind: 'local' });
        } else {
          out.push({
            userId: IN_CALL_LOCAL_STRIP_PENDING_ID,
            stripMemberKind: 'local',
            stripLocalPending: true,
          });
        }
        continue;
      }
      const id = profilePictureIdForMember(panel, member);
      if (!id) continue;
      const name = member.participant.name?.trim();
      out.push({
        userId: id,
        stripMemberKind: 'remote',
        ...(name ? { tooltip: name } : {}),
      });
    }
    return out;
  });

  const controlsVariant = createMemo(
    (): CallControlsVariant => (slim() ? 'panel-small' : 'panel')
  );

  const showExpandToFullCall = createMemo(() => !onCallPage());

  return (
    <Show when={() => panel.isActive()}>
      <section
        data-in-call-panel
        aria-label="In call"
        class="relative isolate overflow-hidden rounded-lg border border-ink-muted/[0.08] bg-ink-muted/[0.025] divide-y divide-ink-muted/[0.08]"
      >
        {/* Header — soup notification vocabulary: muted label, accent pulse,
            share affordance is a single icon button (no chunky toggle switch).
            Active = subtle accent-tinted bg. */}
        <div
          class={cn(
            'flex items-center min-w-0 w-full px-3 h-8',
            slim() ? 'justify-center' : 'justify-between'
          )}
        >
          <div class="flex min-w-0 shrink-0 items-center gap-2">
            <Show when={showHeaderPulse()}>
              <span class="size-1.5 shrink-0 rounded-full bg-accent animate-pulse" />
            </Show>
            <Show when={!slim()}>
              <span class="text-xs font-medium text-ink truncate">In call</span>
            </Show>
          </div>

          <div class="flex items-center gap-0.5 shrink-0">
            <Show when={showExpandToFullCall()}>
              <button
                type="button"
                class={cn(
                  'inline-flex items-center justify-center size-6 rounded transition-colors text-ink-muted/70 hover:text-ink hover:bg-ink-muted/[0.06]',
                  slim() && 'animate-pulse'
                )}
                title="Open full call view"
                aria-label="Open full call view"
                onClick={() => {
                  const id = panel.callCtx.activeChannelId();
                  if (id) void openChannelCallTab(id);
                }}
              >
                <ArrowsOut class="size-3.5" />
              </button>
            </Show>
          </div>
        </div>

        {/* Avatars */}
        <div
          class={cn(
            'px-3 py-2.5',
            slim() && 'flex flex-col items-center gap-2 pt-2 pb-1'
          )}
        >
          <div
            class={cn(
              'flex flex-row items-center leading-none min-w-0 w-full',
              slim() ? 'justify-center' : 'justify-between'
            )}
            data-in-call-panel-avatars
          >
            <Show
              when={!slim()}
              fallback={<InCallParticipantsListPopover panel={panel} />}
            >
              <StackedAvatarsRow<InCallStripImage>
                class="w-full min-w-0"
                distribute="fill"
                each={stripStackEach}
                max={6}
                size={IN_CALL_STRIP_IMAGE_SIZE}
                defaultEmptyUserPlaceholder
                overflowChipClass="bg-ink-muted/10"
                overflowTooltipContent={(close) => (
                  <Surface depth={3} class="min-w-48 max-w-72">
                    <InCallRosterListSection
                      panel={panel}
                      members={orderedMembers()}
                      onClose={() => close()}
                      allowOpenDm={false}
                    />
                  </Surface>
                )}
              >
                {(image) => (
                  <InCallStripAvatarImage
                    image={image}
                    trackCall={() => panel.callCtx.trackVersion()}
                  />
                )}
              </StackedAvatarsRow>
            </Show>
          </div>
        </div>

        {/* Controls */}
        <div class="flex justify-center px-1 py-1">
          <CallControls
            variant={controlsVariant()}
            when={props.showCallControls}
            onLeave={() => panel.controls.leaveCall()}
          />
        </div>

        <Show when={slim()}>
          <div class="flex items-center justify-center px-1 py-1">
            <button
              class="flex items-center justify-center size-5 shrink-0 rounded-md transition-colors text-failure hover:bg-failure/10"
              onClick={() => void panel.controls.leaveCall()}
              aria-label="Leave call"
              type="button"
            >
              <PhoneDisconnect class="size-4" />
            </button>
          </div>
        </Show>
      </section>
    </Show>
  );
};
