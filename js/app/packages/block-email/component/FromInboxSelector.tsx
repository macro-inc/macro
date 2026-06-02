import { UserIcon, type UserIconProps } from '@core/component/UserIcon';
import { tryMacroId, useDisplayName } from '@core/user';
import ChevronDown from '@phosphor/caret-down.svg';
import Check from '@phosphor/check.svg';
import { Dropdown } from '@ui';
import { For, type JSX, Show } from 'solid-js';

type FromInbox = { id: string; email_address: string; macro_id?: string };

/** The account's user icon, resolved by macro id when known, else by email. */
function inboxIconProps(inbox: FromInbox): UserIconProps {
  const macroId = tryMacroId(inbox.macro_id ?? '');
  return macroId ? { id: macroId } : { email: inbox.email_address };
}

/** A single inbox row: the account's user icon, name, and address. */
function FromInboxOption(props: { inbox: FromInbox }) {
  const [name] = useDisplayName(tryMacroId(props.inbox.macro_id ?? ''));
  return (
    <>
      <UserIcon
        {...inboxIconProps(props.inbox)}
        size="sm"
        suppressClick
        class="shrink-0"
      />
      <span class="flex-1 truncate">
        <Show when={name()} fallback={props.inbox.email_address}>
          {name()} &lt;{props.inbox.email_address}&gt;
        </Show>
      </span>
    </>
  );
}

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
  const activeInbox = () =>
    props.links.find((l) => l.id === props.activeLinkId);
  return (
    <Show
      when={props.links.length > 1}
      fallback={<span class="ml-2 truncate">{props.label}</span>}
    >
      <Dropdown>
        <Dropdown.Trigger
          class={props.triggerClass ?? 'ml-1 h-6 gap-1 text-ink-muted'}
        >
          <Show when={activeInbox()}>
            {(inbox) => (
              <UserIcon
                {...inboxIconProps(inbox())}
                size="sm"
                suppressClick
                class="shrink-0"
              />
            )}
          </Show>
          <span class="truncate">{props.label}</span>
          <ChevronDown class="size-3 shrink-0" />
        </Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Group>
            <For each={props.links}>
              {(inbox) => (
                <Dropdown.Item onSelect={() => props.onSelect(inbox.id)}>
                  <FromInboxOption inbox={inbox} />
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
