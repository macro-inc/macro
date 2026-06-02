import ChevronDown from '@phosphor/caret-down.svg';
import Check from '@phosphor/check.svg';
import { Dropdown } from '@ui';
import { For, type JSX, Show } from 'solid-js';

type FromInbox = { id: string; email_address: string };

/**
 * Lets the user pick which linked inbox a compose/reply sends from. Renders a
 * dropdown over `links` when there's more than one inbox; otherwise falls back
 * to the static `label`.
 */
export function FromInboxSelector(props: {
  links: FromInbox[];
  activeLinkId: string | undefined;
  label: JSX.Element;
  onSelect: (linkId: string) => void;
  triggerClass?: string;
}) {
  return (
    <Show
      when={props.links.length > 1}
      fallback={<span class="ml-2 truncate">{props.label}</span>}
    >
      <Dropdown>
        <Dropdown.Trigger
          class={props.triggerClass ?? 'ml-1 h-6 gap-1 text-ink-muted'}
        >
          <span class="truncate">{props.label}</span>
          <ChevronDown class="size-3 shrink-0" />
        </Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Group>
            <For each={props.links}>
              {(inbox) => (
                <Dropdown.Item onSelect={() => props.onSelect(inbox.id)}>
                  <span class="flex-1 truncate">{inbox.email_address}</span>
                  <Show when={inbox.id === props.activeLinkId}>
                    <Check class="size-3.5 shrink-0" />
                  </Show>
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}
