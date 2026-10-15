import { inboxIconProps } from '@core/component/inboxIcon';
import { UserIcon } from '@core/component/UserIcon';
import ChevronDown from '@icon/system/regular/caret-down.svg';
import Check from '@icon/system/regular/check.svg';
import { cn, Dropdown, Tooltip } from '@ui';
import { For, Show } from 'solid-js';
import type { FromInboxOption } from '../core/email-sender';

function SenderRow(props: { inbox: FromInboxOption }) {
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
        <Show
          when={props.inbox.displayName}
          fallback={props.inbox.email_address}
        >
          {props.inbox.displayName} &lt;{props.inbox.email_address}&gt;
        </Show>
      </span>
    </>
  );
}

function SenderPill(props: { inbox: FromInboxOption; selectable: boolean }) {
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
      <p class="text-sm whitespace-nowrap truncate max-w-60">
        {props.inbox.email_address}
      </p>
      <Show when={props.selectable}>
        <ChevronDown class="size-3 shrink-0 text-ink-muted" />
      </Show>
    </div>
  );
}

/** Shared From control: inboxes followed by their verified aliases. Identities
 * are keyed by inbox AND address, including addresses shared by two accounts. */
export function FromInboxSelector(props: {
  links: FromInboxOption[];
  activeInboxId: string | undefined;
  activeEmail?: string;
  onSelect: (inboxId: string, senderEmail?: string) => void;
  disabled?: boolean;
  compact?: boolean;
  pill?: boolean;
  class?: string;
  portalScope?: 'local';
}) {
  const active = () => {
    const inbox = props.links.find(
      (option) => option.inboxId === props.activeInboxId && !option.isAlias
    );
    const email = props.activeEmail?.toLowerCase();
    if (!email) return inbox;
    return (
      props.links.find(
        (option) =>
          option.inboxId === props.activeInboxId &&
          option.email_address.toLowerCase() === email
      ) ??
      (inbox
        ? {
            ...inbox,
            email_address: props.activeEmail!,
            displayName: undefined,
          }
        : undefined)
    );
  };
  const choices = () => (
    <Dropdown.Content portalScope={props.portalScope}>
      <Dropdown.Group>
        <For each={props.links}>
          {(option, index) => (
            <>
              <Show
                when={
                  index() > 0 &&
                  props.links[index() - 1].inboxId !== option.inboxId
                }
              >
                <Dropdown.Separator />
              </Show>
              <Dropdown.Item
                onSelect={() =>
                  props.onSelect(option.inboxId, option.email_address)
                }
                class={cn(option.isAlias && 'pl-7')}
              >
                <Tooltip label={option.email_address}>
                  <span class="flex items-center gap-2 min-w-0 flex-1">
                    <SenderRow inbox={option} />
                  </span>
                </Tooltip>
                <Show
                  when={
                    option.inboxId === props.activeInboxId &&
                    option.email_address.toLowerCase() ===
                      active()?.email_address.toLowerCase()
                  }
                >
                  <Check class="size-3.5 shrink-0" />
                </Show>
              </Dropdown.Item>
            </>
          )}
        </For>
      </Dropdown.Group>
    </Dropdown.Content>
  );
  const label = (selectable: boolean) => (
    <Show
      when={active()}
      fallback={
        <>
          Select sending inbox
          <ChevronDown class="size-3 shrink-0" />
        </>
      }
    >
      {(inbox) => (
        <Show
          when={props.pill}
          fallback={
            <>
              <Show
                when={props.compact}
                fallback={<SenderRow inbox={inbox()} />}
              >
                <span class="min-w-0 truncate">{inbox().email_address}</span>
              </Show>
              <Show when={selectable}>
                <ChevronDown class="size-3 shrink-0" />
              </Show>
            </>
          }
        >
          <SenderPill inbox={inbox()} selectable={selectable} />
        </Show>
      )}
    </Show>
  );
  return (
    <Show when={props.links.length > 0}>
      <Show
        when={props.links.length > 1 || !active()}
        fallback={
          <div
            class={cn(
              'flex items-center gap-2 min-w-0 text-sm text-ink-muted',
              props.class
            )}
          >
            {label(false)}
          </div>
        }
      >
        <Dropdown>
          <Tooltip label={active()?.email_address ?? 'Select sending inbox'}>
            <Dropdown.Trigger
              disabled={props.disabled}
              aria-label={active() ? 'From address' : 'Select sending inbox'}
              class={cn(
                'inline-flex min-w-0 max-w-full items-center gap-2 text-sm text-ink-muted',
                props.pill &&
                  'h-auto border-none bg-transparent p-0 not-disabled:hover:bg-transparent active:bg-transparent',
                props.class
              )}
            >
              {label(true)}
            </Dropdown.Trigger>
          </Tooltip>
          {choices()}
        </Dropdown>
      </Show>
    </Show>
  );
}
