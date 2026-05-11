import { StackedAvatarsRow } from '@core/component/StackedAvatarsRow';
import ArrowsOut from '@icon/regular/arrows-out.svg';
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

  /** Full roster order for the in-call avatar strip. */
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
          <div
            class={cn(
              'flex min-w-0 shrink-0 items-center gap-0.5',
              slim() && !showExpandToFullCall() && 'p-1'
            )}
          >
            <Show when={showHeaderPulse()}>
              <span
                class={cn(
                  'size-1.5 shrink-0 rounded-full bg-accent animate-pulse',
                  showCallLabel() && 'mr-1'
                )}
              />
            </Show>

            <Show when={showCallLabel()}>
              <span class="text-sm text-accent truncate">Call</span>
            </Show>
          </div>

          <Show when={showExpandToFullCall()}>
            <button
              type="button"
              class={cn(
                'shrink-0 transition-colors hover:bg-accent/30 outline-0 outline-accent/50 hover:outline-1 hover-transition-outline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-edge-muted',
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
                class={cn('text-accent', slim() ? 'size-3.5' : 'size-4')}
              />
            </button>
          </Show>
        </div>

        <div
          class={cn(
            'px-2 py-3 bg-panel rounded-b-lg w-full',
            slim() && 'px-2 pt-2 pb-1 flex flex-col items-center gap-2'
          )}
        >
          <div
            class={cn(
              'flex flex-row items-center leading-none min-w-0 w-full',
              slim() ? 'justify-center' : 'justify-between'
            )}
            data-in-call-panel-avatars
          >
            <Show when={!slim()}>
              <StackedAvatarsRow<InCallStripImage>
                class="w-full min-w-0"
                distribute="fill"
                each={stripStackEach}
                max={6}
                size={IN_CALL_STRIP_IMAGE_SIZE}
                defaultEmptyUserPlaceholder
                overflowChipClass="bg-edge-muted"
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

            <Show when={slim()}>
              <InCallParticipantsListPopover panel={panel} />
            </Show>
          </div>
        </div>

        <div
          class={cn(
            !slim() && 'bg-panel border-t border-edge-muted',
            slim() && 'px-2 pt-1 pb-2'
          )}
        >
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
