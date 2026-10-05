import { Item } from '@ui';

export function ParticipantsEmptyState(props: { searchQuery: string }) {
  return (
    <Item role="status">
      <Item.Content>
        <Item.Description>
          {props.searchQuery.trim().length > 0
            ? `No participants match "${props.searchQuery}".`
            : 'No participants found.'}
        </Item.Description>
      </Item.Content>
    </Item>
  );
}
