import { inboxIconProps } from '@core/component/inboxIcon';
import { UserIcon } from '@core/component/UserIcon';
import { emailToMacroId, useDisplayName } from '@core/user';
import ChevronDown from '@phosphor/caret-down.svg';
import Check from '@phosphor/check.svg';
import { cn, Dropdown } from '@ui';
import { For, Show } from 'solid-js';

type FromInbox = {
  id: string;
  email_address: string;
  photo_url?: string | null;
};

/** A single inbox: the account's user icon, name, and address. */
function FromInboxOption(props: { inbox: FromInbox }) {
  const [name] = useDisplayName(emailToMacroId(props.inbox.email_address));
  return (
    <>
      <UserIcon
        {...inboxIconProps(props.inbox.email_address)}
        photoUrl={props.inbox.photo_url ?? undefined}
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

function FromInboxPill(props: { inbox: FromInbox; selectable: boolean }) {
  const [name] = useDisplayName(emailToMacroId(props.inbox.email_address));
  const label = () => name() || props.inbox.email_address;

  return (
    <div
      class={cn(
        'flex flex-row shrink-0 py-1 pl-2 gap-1 pr-2 overflow-hidden items-center bg-active rounded-full text-ink',
        props.selectable && 'hover:bg-hover'
      )}
    >
      <UserIcon
        {...inboxIconProps(props.inbox.email_address)}
        photoUrl={props.inbox.photo_url ?? undefined}
        size="sm"
        suppressClick
        class="shrink-0"
      />
      <p class="text-sm whitespace-nowrap truncate max-w-60">{label()}</p>
      <Show when={props.selectable}>
        <ChevronDown class="size-3 shrink-0 text-ink-muted" />
      </Show>
    </div>
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
  compact?: boolean;
  pill?: boolean;
  class?: string;
  portalScope?: 'local';
}) {
  const activeInbox = () =>
    props.links.find((l) => l.id === props.activeLinkId) ?? props.links[0];
  const sortedLinks = () =>
    [...props.links].sort((a, b) =>
      a.email_address.localeCompare(b.email_address)
    );

  if (props.compact) {
    return (
      <Show when={activeInbox()}>
        {(active) => (
          <Show
            when={props.links.length > 1}
            fallback={<span class={props.class}>{active().email_address}</span>}
          >
            <Dropdown>
              <Dropdown.Trigger
                class={`inline-flex min-w-0 max-w-full items-center gap-1 ${props.class ?? ''}`}
              >
                <span class="min-w-0 truncate">{active().email_address}</span>
                <ChevronDown class="size-3 shrink-0" />
              </Dropdown.Trigger>
              <Dropdown.Content portalScope={props.portalScope}>
                <Dropdown.Group>
                  <For each={sortedLinks()}>
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

  if (props.pill) {
    return (
      <Show when={activeInbox()}>
        {(active) => (
          <Show
            when={props.links.length > 1}
            fallback={
              <div class={props.class}>
                <FromInboxPill inbox={active()} selectable={false} />
              </div>
            }
          >
            <Dropdown>
              <Dropdown.Trigger
                class={cn(
                  'inline-flex h-auto min-w-0 max-w-full rounded-full border-none bg-transparent p-0 not-disabled:hover:bg-transparent active:bg-transparent',
                  props.class
                )}
              >
                <FromInboxPill inbox={active()} selectable={true} />
              </Dropdown.Trigger>
              <Dropdown.Content portalScope={props.portalScope}>
                <Dropdown.Group>
                  <For each={sortedLinks()}>
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
            <Dropdown.Trigger class="flex items-center min-w-0 max-w-full gap-2 text-sm text-ink-muted">
              <Show when={active()} keyed>
                {(inbox) => <FromInboxOption inbox={inbox} />}
              </Show>
              <ChevronDown class="size-3 shrink-0" />
            </Dropdown.Trigger>
            <Dropdown.Content portalScope={props.portalScope}>
              <Dropdown.Group>
                <For each={sortedLinks()}>
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
