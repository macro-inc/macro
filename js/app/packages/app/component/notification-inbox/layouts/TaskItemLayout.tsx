import { For, Show } from 'solid-js';
import { PropertyPill } from '../InboxItem';
import { GenericItemLayout } from './GenericItemLayout';
import { type InboxItemLayoutProps } from './shared';

/** Task assignment notifications: generic layout with trailing property pills. */
export function TaskItemLayout(props: InboxItemLayoutProps) {
  const item = () => props.item;

  return (
    <GenericItemLayout
      {...props}
      contentClass=""
      contentTrailing={
        <Show when={item().properties?.length}>
          <span class="flex shrink-0 items-center gap-1">
            <For each={item().properties}>
              {(property) => <PropertyPill property={property} />}
            </For>
          </span>
        </Show>
      }
    />
  );
}
