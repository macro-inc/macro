import { UserIcon } from '@core/component/UserIcon';
import { idToEmail } from '@core/user';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import IconX from '@icon/regular/x.svg';
import type { ChannelParticipant } from '@queries/channel/types';
import { Button } from '@ui';

export function ParticipantsListItem(props: {
  participant: ChannelParticipant;
  currentUserId?: string;
  editable: boolean;
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
    <div class="flex items-center gap-2 min-h-10 p-2 text-sm w-full border-b border-edge-muted last:border-b-0 hover:bg-hover">
      <button
        {...navigationHandlers}
        type="button"
        class="flex min-w-0 flex-1 items-center gap-2 rounded-xs px-2 py-1 text-left focus:outline-none"
      >
        <div class="shrink-0 flex items-center">
          <UserIcon
            id={props.participant.user_id}
            size="sm"
            isDeleted={false}
          />
        </div>
        <span class="ph-no-capture font-semibold truncate flex-1 text-ink">
          {idToEmail(props.participant.user_id)}
        </span>
      </button>
      <span class="text-xs font-mono text-ink-extra-muted uppercase font-light shrink-0">
        {props.participant.role}
      </span>
      <div class="shrink-0">
        <Button
          label={canRemove ? 'Remove participant' : 'Cannot remove participant'}
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
    </div>
  );
}
