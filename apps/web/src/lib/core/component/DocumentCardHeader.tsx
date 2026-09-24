import { Card, Item } from '@ui';
import { type JSX, Show } from 'solid-js';

/** Shared identity row for embedded documents and tasks. */
export function DocumentCardHeader(props: {
  icon: JSX.Element;
  title: JSX.Element;
  description?: JSX.Element;
  actions?: JSX.Element;
}) {
  return (
    <Card.Header class="shrink-0 py-2.5">
      <Item class="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-2 border-0 p-0">
        <Item.Icon class="col-start-1 row-start-1">{props.icon}</Item.Icon>
        <Item.Content class="col-start-2 row-start-1">
          <Item.Title>{props.title}</Item.Title>
          <Show when={props.description}>
            <Item.Description class="text-left wrap-anywhere">
              {props.description}
            </Item.Description>
          </Show>
        </Item.Content>
        <Show when={props.actions}>
          <Item.Actions class="col-start-3 row-start-1 h-5">
            {props.actions}
          </Item.Actions>
        </Show>
      </Item>
    </Card.Header>
  );
}
