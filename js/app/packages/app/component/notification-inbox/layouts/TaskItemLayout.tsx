import { For, Show } from 'solid-js';
import { PropertyPill } from '../InboxItem';
import { GenericItemLayout } from './GenericItemLayout';
import { type InboxItemLayoutProps } from './shared';
import { getInboxTaskProperties } from './utils';

/** Task assignment notifications: generic layout with trailing property pills. */
export function TaskItemLayout(props: InboxItemLayoutProps) {
  const properties = () => getInboxTaskProperties(props.item);

  return (
    <GenericItemLayout
      {...props}
      contentClass=""
      contentTrailing={
        <Show when={properties()?.length}>
          <span class="flex shrink-0 items-center gap-1">
            <For each={properties()}>
              {(property) => <PropertyPill property={property} />}
            </For>
          </span>
        </Show>
      }
    />
  );
}
