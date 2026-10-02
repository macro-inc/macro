import { UserIcon } from '@core/component/UserIcon';
import { idToEmail } from '@core/user';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import IconX from '@phosphor/x.svg';
import type { ChannelParticipant } from '@queries/channel/types';
import { Button, Item } from '@ui';
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

  const navigationHandlers = useSplitNavigationHandler<HTMLButtonElement>(
    async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await props.onClick(event);
    }
  );

  return (
    <Item>
      <UserIcon id={props.participant.user_id} size="lg" isDeleted={false} />
      <Item.Content>
        <Item.Title>
          <Button
            {...navigationHandlers}
            label={idToEmail(props.participant.user_id)}
          >
            {idToEmail(props.participant.user_id)}
          </Button>
        </Item.Title>
        <Item.Description>{props.participant.role}</Item.Description>
      </Item.Content>
      <Show when={props.editable}>
        <Item.Actions>
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
        </Item.Actions>
      </Show>
    </Item>
  );
}
