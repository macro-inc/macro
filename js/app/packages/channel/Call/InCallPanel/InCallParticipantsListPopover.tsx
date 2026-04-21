import { Popover } from '@kobalte/core/popover';
import UserCircle from '@icon/regular/user-circle.svg';
import {
  For,
  Show,
  createMemo,
  createSignal,
} from 'solid-js';
import { tryMacroId, useDisplayName } from '@core/user';
import { isOk } from '@core/util/maybeResult';
import { commsServiceClient } from '@service-comms/client';
import { useSplitLayout } from '@app/component/split-layout/layout';
import type { InCallPanelMember, UseInCallPanelResult } from './types';
import { InCallAvatarPlaceholderShell } from './InCallAvatarPlaceholder';
import { InCallParticipantAvatar } from './InCallParticipantAvatar';
import { profilePictureIdForMember } from './profilePictureIdForMember';
import { cn } from '@ui/utils/classname';

function InCallParticipantNameRow(props: {
  panel: UseInCallPanelResult;
  member: InCallPanelMember;
  onClose: () => void;
}) {
  const { replaceOrInsertSplit } = useSplitLayout();

  const raw = profilePictureIdForMember(props.panel, props.member);
  const [displayName] = useDisplayName(tryMacroId(raw ?? ''));
  const label = createMemo(() => {
    props.panel.callCtx.trackVersion();
    const r = profilePictureIdForMember(props.panel, props.member);
    return (
      displayName() ||
      r ||
      (props.member.kind === 'local' ? 'You' : 'Participant')
    );
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
    if (channelId) {
      props.onClose();
      replaceOrInsertSplit({ type: 'channel', id: channelId });
    }
  };

  return (
    <div
      role={isRemote() ? 'button' : undefined}
      tabIndex={isRemote() ? 0 : undefined}
      onClick={isRemote() ? openDm : undefined}
      onKeyDown={isRemote() ? (e) => e.key === 'Enter' && openDm() : undefined}
      class={cn(
        'flex min-w-0 items-center gap-2 rounded-xs px-1 py-1',
        isRemote() ? 'hover:bg-hover cursor-pointer' : 'cursor-default'
      )}
    >
      <InCallParticipantAvatar panel={props.panel} member={props.member} size="sm" />
      <span class="truncate text-sm text-ink">{label()}</span>
      <Show when={props.member.kind === 'local'}>
        <span class="ml-auto text-xs text-ink-muted shrink-0">You</span>
      </Show>
    </div>
  );
}

export type InCallParticipantsListPopoverProps = {
  panel: UseInCallPanelResult;
  /** 'sm' shrinks the trigger icon; defaults to regular size */
  size?: 'slim' | 'default';
  class?: string;
};

/** In-call roster; remote rows open a DM. Omitted in default layout when under 5 people. */
export function InCallParticipantsListPopover(
  props: InCallParticipantsListPopoverProps
) {
  const [open, setOpen] = createSignal(false);

  const members = createMemo(() => [
    ...props.panel.visibleMembers(),
    ...props.panel.overflowMembers(),
  ]);

  const showTrigger = createMemo(
    () => props.size === 'slim' || members().length >= 5
  );

  const iconClass = () =>
    props.size === 'slim' ? 'w-4 h-4' : 'w-10 h-10';

  return (
    <Show when={showTrigger()}>
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="right-start"
      gutter={8}
      overflowPadding={8}
    >
      <Popover.Trigger
        as="button"
        type="button"
        class={cn(
          'inline-flex items-center justify-center rounded-full bg-transparent p-0 transition-colors hover:bg-accent/15 cursor-pointer text-accent',
          props.class
        )}
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-label="Everyone in call"
      >
        <Show
          when={props.size === 'slim'}
          fallback={
            <InCallAvatarPlaceholderShell size="md" variant="view-more" />
          }
        >
          <UserCircle class={cn(iconClass(), 'block')} />
        </Show>
      </Popover.Trigger>
      
      <Popover.Portal>
        <Popover.Content class="z-modal min-w-[12rem] max-w-[18rem] rounded-md border border-edge-muted bg-panel shadow-lg">
          <div class="rounded-t-md border-b border-edge px-2 py-2.5 text-xs font-medium text-accent ">
            In this call
          </div>
          <div class="p-1 max-h-64 overflow-y-auto">
            <Show
              when={members().length > 0}
              fallback={
                <div class="px-2 py-2 text-sm text-ink-muted">Connecting…</div>
              }
            >
              <For each={members()}>
                {(member) => (
                  <InCallParticipantNameRow
                    panel={props.panel}
                    member={member}
                    onClose={() => setOpen(false)}
                  />
                )}
              </For>
            </Show>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
    </Show>
  );
}
