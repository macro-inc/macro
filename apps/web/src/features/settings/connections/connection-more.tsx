import DotsThreeIcon from '@phosphor/dots-three.svg';
import LinkBreakIcon from '@phosphor/link-break.svg';
import { Dropdown } from '@ui';
import { For, type JSX, Show } from 'solid-js';

export type ConnectionMenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

export function ConnectionMore(props: {
  items: ConnectionMenuItem[];
}): JSX.Element {
  return (
    <Show when={props.items.length > 0}>
      <Dropdown>
        <Dropdown.Trigger
          aria-label="More"
          class="relative inline-flex size-6 items-center justify-center rounded-md border-1 border-edge bg-transparent text-ink-muted outline-none hover:bg-hover hover:text-ink"
        >
          <DotsThreeIcon class="size-4" />
        </Dropdown.Trigger>
        <Dropdown.Content class="w-48">
          <Dropdown.Group>
            <For each={props.items}>
              {(item) => (
                <Dropdown.Item
                  class={item.danger ? 'text-failure' : undefined}
                  disabled={item.disabled}
                  onSelect={item.onSelect}
                >
                  <Show when={item.danger}>
                    <LinkBreakIcon class="size-4" />
                  </Show>
                  {item.label}
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}

export function ConnectionRowActions(props: {
  primary?: JSX.Element;
  items: ConnectionMenuItem[];
}): JSX.Element {
  return (
    <div class="flex items-center gap-2">
      {props.primary}
      <ConnectionMore items={props.items} />
    </div>
  );
}
