import { For, Show, createMemo, type Component } from 'solid-js';
import { CallControls } from '../CallControls';
import { InCallAvatarPlaceholderShell } from './InCallAvatarPlaceholder';
import { InCallParticipantAvatar } from './InCallParticipantAvatar';
import type { InCallPanelProps } from './types';
import { useInCallPanel } from './useInCallPanel';

export const InCallPanel: Component<InCallPanelProps> = ({
  channelId,
  onLeaveCall,
  onJoinCall,
  showCallControls,
}) => {
  const panel = useInCallPanel({
    channelId,
    onLeaveCall,
    onJoinCall,
  });

  const visibleSlots = createMemo(() => panel.visibleAvatarSlots());
  const overflowMembersList = createMemo(() => panel.overflowMembers());

  return (
    <Show when={panel.isActive()}>
      <section
        data-in-call-panel
        aria-label="In call"
        class=" rounded-lg border border-edge-muted"
      >
        <div class="py-1 px-2 border-b border-edge-muted bg-accent/5 rounded-t-lg flex items-center gap-0.5">
          <span class="size-1.5 rounded-full bg-accent animate-pulse mr-1" />

          <span class="text-sm text-accent animate-pulse">Call</span>
        </div>

        <div class="p-2 bg-panel rounded-b-lg">
          <div
            class="flex flex-row flex-wrap items-center gap-1 "
            data-in-call-panel-avatars
          >
            <For each={visibleSlots()}>
              {(slot) => (
                <div data-in-call-panel-avatar>
                  {slot.type === 'member' ? (
                    <InCallParticipantAvatar
                      panel={panel}
                      member={slot.member}
                      size="md"
                    />
                  ) : (
                    <InCallAvatarPlaceholderShell size="md" />
                  )}
                </div>
              )}
            </For>
          </div>
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
          <div data-in-call-panel-controls>
            <CallControls
              variant="panel"
              when={showCallControls}
              onLeave={() => panel.controls.leaveCall()}
              class="pt-2"
            />
          </div>
        </div>
      </section>
    </Show>
  );
};
