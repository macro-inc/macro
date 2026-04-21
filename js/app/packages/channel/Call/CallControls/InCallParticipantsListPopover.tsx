import { Popover } from '@kobalte/core/popover';
import {
  For,
  Show,
  createMemo,
  createSignal,
  type JSX,
} from 'solid-js';
import { tryMacroId, useDisplayName } from '@core/user';
import type { InCallPanelMember, UseInCallPanelResult } from '../InCallPanel/types';
import { InCallParticipantAvatar } from '../InCallPanel/InCallParticipantAvatar';
import { profilePictureIdForMember } from '../InCallPanel/profilePictureIdForMember';
import { cn } from '@ui/utils/classname';

function InCallParticipantNameRow(props: {
  panel: UseInCallPanelResult;
  member: InCallPanelMember;
}) {
  props.panel.callCtx.trackVersion();
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

  return (
    <div class="flex min-w-0 items-center gap-2 rounded-xs px-2 py-1 hover:bg-hover">
      <InCallParticipantAvatar panel={props.panel} member={props.member} size="sm" />
      <span class="truncate text-sm text-ink">{label()}</span>
    </div>
  );
}

export type InCallParticipantsListPopoverProps = {
  panel: UseInCallPanelResult;
  children: JSX.Element;
  class?: string;
};

/**
 * Click the trigger (avatar cluster) to open a roster of everyone in the call.
 * Kobalte Popover — same pattern as message `ReactionChip` / `EmojiReactionPopover`.
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
        class={cn("flex w-full max-w-full flex-row flex-wrap items-center gap-1 rounded-xs border border-transparent bg-transparent p-0 text-left transition-colors hover:border-edge-muted hover:bg-ink/5 cursor-pointer", props.class)}
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-label="Everyone in call"
      >
        {props.children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-modal min-w-[12rem] max-w-[18rem] max-h-64 overflow-y-auto rounded-md border border-edge-muted bg-panel py-1 shadow-lg">
          <div class="border-b border-edge px-2 py-1.5 text-xs font-medium text-ink-muted">
            In this call
          </div>
          <Show
            when={members().length > 0}
            fallback={
              <div class="px-2 py-2 text-sm text-ink-muted">Connecting…</div>
            }
          >
            <For each={members()}>
              {(member) => (
                <InCallParticipantNameRow panel={props.panel} member={member} />
              )}
            </For>
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
