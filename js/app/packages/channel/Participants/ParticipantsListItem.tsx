import { UserIcon } from '@core/component/UserIcon';
import { idToEmail } from '@core/user';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import IconX from '@phosphor/x.svg';
import type { ChannelParticipant } from '@queries/channel/types';
import { Button } from '@ui';
import { Show } from 'solid-js';

export function ParticipantsListItem(props: {
  participant: ChannelParticipant;
  currentUserId?: string;
  editable: boolean;
  isLast?: boolean;
  onClick: () => void | Promise<void>;
  onRemove: () => void;
}) {
  const canRemove =
    props.editable && props.currentUserId !== props.participant.user_id;

  const navigationHandlers = useSplitNavigationHandler<HTMLButtonElement>(
    async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await props.onClick();
    }
  );

  return (
    <div
      class="flex items-center justify-between gap-2 py-2 px-6 text-sm w-full bg-surface hover:bg-hover"
      classList={{ 'border-b': !props.isLast }}
      style={{ 'border-color': 'var(--b3)' }}
    >
      <button
        {...navigationHandlers}
        type="button"
        class="flex min-w-0 flex-1 items-center gap-3 rounded-xs text-left focus:outline-none"
      >
        <div class="shrink-0">
          <UserIcon
            id={props.participant.user_id}
            size="lg"
            isDeleted={false}
          />
        </div>
        <div class="min-w-0 flex-1">
          <div class="ph-no-capture text-sm font-medium text-ink truncate">
            {idToEmail(props.participant.user_id)}
          </div>
          <div class="text-xs text-ink-muted capitalize">
            {props.participant.role}
          </div>
        </div>
      </button>
      <Show when={props.editable}>
        <div class="shrink-0">
          <Button
            label={
              canRemove ? 'Remove participant' : 'Cannot remove participant'
            }
            variant="ghost"
            size="icon-sm"
            disabled={!canRemove}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!canRemove) return;
              props.onRemove();
            }}
          >
            <IconX />
          </Button>
        </div>
      </Show>
    </div>
  );
}
