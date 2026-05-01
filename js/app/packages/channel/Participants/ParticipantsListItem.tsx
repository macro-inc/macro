import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { UserIcon } from '@core/component/UserIcon';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { idToEmail } from '@core/user';
import IconX from '@icon/regular/x.svg';
import type { ChannelParticipant } from '@queries/channel/types';

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
    <div class="flex items-center gap-2 min-h-10 px-2 py-2 text-sm w-full border-b border-edge-muted last:border-b-0 hover:bg-hover/30">
      <button
        {...navigationHandlers}
        type="button"
        class="flex min-w-0 flex-1 items-center gap-2 rounded-xs px-2 py-1 text-left cursor-pointer focus:outline-none"
      >
        <div class="shrink-0">
          <UserIcon
            id={props.participant.user_id}
            size="xs"
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
        <DeprecatedIconButton
          tooltip={{
            label: canRemove
              ? 'Remove participant'
              : 'Cannot remove participant',
          }}
          icon={IconX}
          iconSize={16}
          theme="clear"
          size="sm"
          disabled={!canRemove}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!canRemove) return;
            props.onRemove();
          }}
        />
      </div>
    </div>
  );
}
