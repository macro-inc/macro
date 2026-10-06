import { UserIcon } from '@core/component/UserIcon';
import { getDisplayName, idToEmail, tryMacroId } from '@core/user';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import IconX from '@phosphor/x.svg';
import type { ChannelParticipant } from '@queries/channel/types';
import { Badge, Button, Item } from '@ui';
import { Show } from 'solid-js';

export function ParticipantsListItem(props: {
  participant: ChannelParticipant;
  currentUserId?: string;
  editable: boolean;
  onClick: (event: MouseEvent) => void | Promise<void>;
  onRemove: () => void;
}) {
  const canRemove = () =>
    props.editable &&
    props.currentUserId !== props.participant.user_id &&
    props.participant.role !== 'owner';

  const displayName = () =>
    getDisplayName(tryMacroId(props.participant.user_id), {
      emailFallback: 'local-part',
    }) || idToEmail(props.participant.user_id);

  const navigationHandlers = useSplitNavigationHandler<HTMLAnchorElement>(
    async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await props.onClick(event);
    }
  );

  return (
    <div class="relative">
      <a
        {...navigationHandlers}
        role="link"
        tabIndex={0}
        aria-label={`Message ${displayName()}`}
        class="block rounded-xl hover:bg-hover focus-visible:outline-2 focus-visible:outline-edge"
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          event.currentTarget.click();
        }}
      >
        <Item class={props.editable ? 'pr-12' : undefined}>
          <UserIcon
            id={props.participant.user_id}
            size="lg"
            isDeleted={false}
            suppressClick
            showTooltip={false}
          />
          <Item.Content>
            <Item.Title class="truncate">{displayName()}</Item.Title>
            <Item.Description class="truncate">
              {idToEmail(props.participant.user_id)}
            </Item.Description>
          </Item.Content>
          <Item.Actions>
            <Badge variant="outline" size="sm">
              {
                { owner: 'Owner', admin: 'Admin', member: 'Member' }[
                  props.participant.role
                ]
              }
            </Badge>
          </Item.Actions>
        </Item>
      </a>
      <Show when={props.editable}>
        <div class="absolute right-3 top-1/2 -translate-y-1/2">
          <Button
            label={
              canRemove() ? 'Remove participant' : 'Cannot remove participant'
            }
            size="icon-sm"
            disabled={!canRemove()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!canRemove()) return;
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
