import { UserIcon, type UserIconProps } from '@core/component/UserIcon';
import { emailToMacroId, useDisplayName } from '@core/user';
import ChevronDown from '@phosphor/caret-down.svg';
import Check from '@phosphor/check.svg';
import { Dropdown } from '@ui';
import { For, Show } from 'solid-js';

type FromInbox = { id: string; email_address: string };

// Resolve each inbox's identity from its own address, not the link's macro_id:
// an own secondary inbox shares the parent account's macro_id, so keying on the
// address gives each inbox its own name and icon.
function inboxIconProps(inbox: FromInbox): UserIconProps {
  const macroId = emailToMacroId(inbox.email_address);
  return macroId ? { id: macroId } : { email: inbox.email_address };
}

/** A single inbox: the account's user icon, name, and address. */
function FromInboxOption(props: { inbox: FromInbox }) {
  const [name] = useDisplayName(emailToMacroId(props.inbox.email_address));
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
 * Lets the user pick which linked inbox a compose/reply sends from. Renders an
 * identical "from" chip in every composer: the active inbox's icon, name, and
 * address, with a dropdown over the other inboxes when there's more than one.
 */
export function FromInboxSelector(props: {
  links: FromInbox[];
  activeLinkId: string | undefined;
  onSelect: (linkId: string) => void;
}) {
  const activeInbox = () =>
    props.links.find((l) => l.id === props.activeLinkId) ?? props.links[0];
  return (
    <Show when={activeInbox()}>
      {(active) => (
        <Show
          when={props.links.length > 1}
          fallback={
            <div class="flex items-center gap-2 min-w-0 text-sm text-ink-muted">
              <Show when={active()} keyed>
                {(inbox) => <FromInboxOption inbox={inbox} />}
              </Show>
            </div>
          }
        >
          <Dropdown>
            <Dropdown.Trigger class="gap-2 text-sm text-ink-muted">
              <Show when={active()} keyed>
                {(inbox) => <FromInboxOption inbox={inbox} />}
              </Show>
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
      )}
    </Show>
  );
}
