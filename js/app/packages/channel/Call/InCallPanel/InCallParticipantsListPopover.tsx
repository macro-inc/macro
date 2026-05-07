import { useSplitLayout } from '@app/component/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { tryMacroId, useDisplayName } from '@core/user';
import UserCircle from '@icon/regular/user-circle.svg';
import { Popover } from '@kobalte/core/popover';
import { useGetOrCreateDirectMessageMutation } from '@queries/channel/get-or-create-dm';
import { cn } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { InCallParticipantAvatar } from './InCallParticipantAvatar';
import { profilePictureIdForMember } from './profile-picture-id-for-member';
import type { InCallPanelMember, UseInCallPanelResult } from './types';

/** Shared shell for “In this call” (popover content + +N tooltip). */
export const IN_CALL_ROSTER_CARD_CLASS =
  'z-modal min-w-[12rem] max-w-[18rem] rounded-md border border-edge-muted bg-panel shadow-lg';

export function InCallRosterListSection(props: {
  panel: UseInCallPanelResult;
  members: InCallPanelMember[];
  onClose: () => void;
  allowOpenDm?: boolean;
}) {
  return (
    <>
      <div class="rounded-t-md border-b border-edge px-2 py-2.5 text-xs font-medium text-accent">
        In this call
      </div>
      <div class="max-h-64 overflow-y-auto p-1">
        <Show
          when={props.members.length > 0}
          fallback={<div class="p-2 text-sm text-ink-muted">Connecting…</div>}
        >
          <For each={props.members}>
            {(member) => (
              <InCallParticipantNameRow
                panel={props.panel}
                member={member}
                onClose={props.onClose}
                allowOpenDm={props.allowOpenDm}
              />
            )}
          </For>
        </Show>
      </div>
    </>
  );
}

export function InCallParticipantNameRow(props: {
  panel: UseInCallPanelResult;
  member: InCallPanelMember;
  onClose: () => void;
  /** When false, the row is display-only (no DM on click). Default true. */
  allowOpenDm?: boolean;
}) {
  const { replaceOrInsertSplit } = useSplitLayout();
  const getOrCreateDmMutation = useGetOrCreateDirectMessageMutation({
    onError: () => toast.failure('Could not open direct message'),
  });

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
  const allowDm = () => props.allowOpenDm !== false;
  const isInteractive = () => isRemote() && allowDm();

  const openDm = () => {
    if (props.member.kind !== 'remote') return;
    const { identity } = props.member.participant;
    if (!identity.startsWith('macro|') || !identity.slice(6).includes('@'))
      return;
    getOrCreateDmMutation.mutate(
      { recipient_id: identity },
      {
        onSuccess: ({ channel_id }) => {
          props.onClose();
          replaceOrInsertSplit({ type: 'channel', id: channel_id });
        },
      }
    );
  };

  return (
    <div
      role={isInteractive() ? 'button' : undefined}
      tabIndex={isInteractive() ? 0 : undefined}
      onClick={isInteractive() ? openDm : undefined}
      onKeyDown={
        isInteractive() ? (e) => e.key === 'Enter' && void openDm() : undefined
      }
      class={cn(
        'flex min-w-0 items-center gap-2 rounded-xs p-1',
        isInteractive() ? 'hover:bg-hover' : 'cursor-default'
      )}
    >
      <InCallParticipantAvatar
        panel={props.panel}
        member={props.member}
        size="sm"
      />
      <span class="truncate text-sm text-ink">{label()}</span>
      <Show when={props.member.kind === 'local'}>
        <span class="ml-auto text-xs text-ink-muted shrink-0">You</span>
      </Show>
    </div>
  );
}

export type InCallParticipantsListPopoverProps = {
  panel: UseInCallPanelResult;
  class?: string;
};

/**
 * Slim in-call panel only: compact trigger opens the full roster (`InCallRosterListSection`).
 * Parent should render only when the panel is in slim layout.
 */
export function InCallParticipantsListPopover(
  props: InCallParticipantsListPopoverProps
) {
  const [open, setOpen] = createSignal(false);

  const members = createMemo(() => [
    ...props.panel.visibleMembers(),
    ...props.panel.overflowMembers(),
  ]);

  return (
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
          'inline-flex items-center justify-center rounded-full bg-transparent p-0 transition-colors hover:bg-accent/15 text-accent',
          props.class
        )}
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-label="Everyone in call"
      >
        <UserCircle class="block size-4" />
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content class={IN_CALL_ROSTER_CARD_CLASS}>
          <InCallRosterListSection
            panel={props.panel}
            members={members()}
            onClose={() => setOpen(false)}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
