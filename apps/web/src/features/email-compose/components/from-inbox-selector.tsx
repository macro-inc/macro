import { inboxIconProps } from '@core/component/inboxIcon';
import { UserIcon } from '@core/component/UserIcon';
import ChevronDown from '@phosphor/caret-down.svg';
import Check from '@phosphor/check.svg';
import { cn, Dropdown } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import type { FromInboxOption } from '../primitives/compose-view-state';

/** A single inbox or alias: the account's user icon, name, and address. */
function FromInboxOptionRow(props: {
  option: FromInboxOption;
  isAlias?: boolean;
}) {
  const name = () => props.option.displayName;
  return (
    <>
      <UserIcon
        {...inboxIconProps(props.option.email_address)}
        photoUrl={props.option.photo_url ?? undefined}
        size="sm"
        suppressClick
        class="shrink-0"
      />
      <span class={cn('flex-1 truncate', props.isAlias && 'ml-2')}>
        <Show when={name()} fallback={props.option.email_address}>
          {name()} &lt;{props.option.email_address}&gt;
        </Show>
      </span>
    </>
  );
}

function FromInboxPill(props: {
  option: FromInboxOption;
  selectable: boolean;
}) {
  const name = () => props.option.displayName;
  const label = () => name() || props.option.email_address;

  return (
    <div
      class={cn(
        'flex flex-row shrink-0 py-1 pl-2 gap-1 pr-2 overflow-hidden items-center bg-active rounded-full text-ink',
        props.selectable && 'hover:bg-hover'
      )}
    >
      <UserIcon
        {...inboxIconProps(props.option.email_address)}
        photoUrl={props.option.photo_url ?? undefined}
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
 * Lets the user pick which linked inbox or alias a compose/reply sends from.
 * Renders an identical "from" chip in every composer: the active inbox's icon,
 * name, and address, with a dropdown over the other inboxes/aliases when there's
 * more than one option.
 */
export function FromInboxSelector(props: {
  links: FromInboxOption[];
  activeInboxId: string | undefined;
  /** The currently selected sender email (alias or inbox email). Used to
   * highlight the correct option when an alias is selected. */
  activeEmail?: string;
  onSelect: (inboxId: string, aliasEmail?: string) => void;
  disabled?: boolean;
  compact?: boolean;
  pill?: boolean;
  class?: string;
  portalScope?: 'local';
}) {
  // Find the active option by matching the activeEmail (which can be an alias)
  // or fall back to matching by activeInboxId for inboxes
  const activeOption = () => {
    const email = props.activeEmail?.toLowerCase();
    if (email) {
      const byEmail = props.links.find(
        (l) => l.email_address.toLowerCase() === email
      );
      if (byEmail) return byEmail;
    }
    return props.links.find((l) => l.id === props.activeInboxId);
  };

  // Group options: primary inboxes first, then aliases grouped under their parent
  const groupedOptions = createMemo(() => {
    const inboxes = props.links.filter((l) => !l.isAlias);
    const aliases = props.links.filter((l) => l.isAlias);

    // Sort inboxes alphabetically
    inboxes.sort((a, b) => a.email_address.localeCompare(b.email_address));

    // Group aliases by parent inbox
    const aliasesByParent = new Map<string, FromInboxOption[]>();
    for (const alias of aliases) {
      if (!alias.parentInboxId) continue;
      const existing = aliasesByParent.get(alias.parentInboxId) ?? [];
      existing.push(alias);
      aliasesByParent.set(alias.parentInboxId, existing);
    }

    // Sort aliases within each group
    for (const group of aliasesByParent.values()) {
      group.sort((a, b) => a.email_address.localeCompare(b.email_address));
    }

    return { inboxes, aliasesByParent };
  });

  // Flat sorted list for simple dropdowns
  const sortedLinks = createMemo(() =>
    [...props.links].sort((a, b) =>
      a.email_address.localeCompare(b.email_address)
    )
  );

  const handleSelect = (option: FromInboxOption) => {
    if (option.isAlias && option.parentInboxId) {
      props.onSelect(option.parentInboxId, option.email_address);
    } else {
      props.onSelect(option.id);
    }
  };

  const unresolvedInboxPicker = () => (
    <Show when={props.links.length > 0}>
      <Dropdown>
        <Dropdown.Trigger
          disabled={props.disabled}
          class={cn(
            'inline-flex items-center gap-1 text-sm text-ink-muted',
            props.class
          )}
        >
          Select sending inbox
          <ChevronDown class="size-3 shrink-0" />
        </Dropdown.Trigger>
        <Dropdown.Content portalScope={props.portalScope}>
          <Dropdown.Group>
            <For each={sortedLinks()}>
              {(option) => (
                <Dropdown.Item onSelect={() => handleSelect(option)}>
                  <FromInboxOptionRow
                    option={option}
                    isAlias={option.isAlias}
                  />
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );

  const isActive = (option: FromInboxOption) =>
    activeOption()?.id === option.id;

  const renderDropdownContent = () => {
    const { inboxes, aliasesByParent } = groupedOptions();
    const hasAliases = aliasesByParent.size > 0;

    // If no aliases, render a simple flat list
    if (!hasAliases) {
      return (
        <Dropdown.Group>
          <For each={inboxes}>
            {(inbox) => (
              <Dropdown.Item onSelect={() => handleSelect(inbox)}>
                <FromInboxOptionRow option={inbox} />
                <Show when={isActive(inbox)}>
                  <Check class="size-3.5 shrink-0" />
                </Show>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      );
    }

    // With aliases, render inboxes and their aliases grouped together
    return (
      <For each={inboxes}>
        {(inbox, index) => {
          const inboxAliases = aliasesByParent.get(inbox.id) ?? [];
          return (
            <>
              <Show when={index() > 0}>
                <Dropdown.Separator />
              </Show>
              <Dropdown.Group>
                <Dropdown.Item onSelect={() => handleSelect(inbox)}>
                  <FromInboxOptionRow option={inbox} />
                  <Show when={isActive(inbox)}>
                    <Check class="size-3.5 shrink-0" />
                  </Show>
                </Dropdown.Item>
                <For each={inboxAliases}>
                  {(alias) => (
                    <Dropdown.Item onSelect={() => handleSelect(alias)}>
                      <FromInboxOptionRow option={alias} isAlias />
                      <Show when={isActive(alias)}>
                        <Check class="size-3.5 shrink-0" />
                      </Show>
                    </Dropdown.Item>
                  )}
                </For>
              </Dropdown.Group>
            </>
          );
        }}
      </For>
    );
  };

  if (props.compact) {
    return (
      <Show when={activeOption()} fallback={unresolvedInboxPicker()}>
        {(active) => (
          <Show
            when={props.links.length > 1}
            fallback={<span class={props.class}>{active().email_address}</span>}
          >
            <Dropdown>
              <Dropdown.Trigger
                disabled={props.disabled}
                class={`inline-flex min-w-0 max-w-full items-center gap-1 ${props.class ?? ''}`}
              >
                <span class="min-w-0 truncate">{active().email_address}</span>
                <ChevronDown class="size-3 shrink-0" />
              </Dropdown.Trigger>
              <Dropdown.Content portalScope={props.portalScope}>
                {renderDropdownContent()}
              </Dropdown.Content>
            </Dropdown>
          </Show>
        )}
      </Show>
    );
  }

  if (props.pill) {
    return (
      <Show when={activeOption()} fallback={unresolvedInboxPicker()}>
        {(active) => (
          <Show
            when={props.links.length > 1}
            fallback={
              <div class={props.class}>
                <FromInboxPill option={active()} selectable={false} />
              </div>
            }
          >
            <Dropdown>
              <Dropdown.Trigger
                disabled={props.disabled}
                class={cn(
                  'inline-flex h-auto min-w-0 max-w-full border-none bg-transparent p-0 not-disabled:hover:bg-transparent active:bg-transparent',
                  props.class
                )}
              >
                <FromInboxPill option={active()} selectable={true} />
              </Dropdown.Trigger>
              <Dropdown.Content portalScope={props.portalScope}>
                {renderDropdownContent()}
              </Dropdown.Content>
            </Dropdown>
          </Show>
        )}
      </Show>
    );
  }

  return (
    <Show when={activeOption()} fallback={unresolvedInboxPicker()}>
      {(active) => (
        <Show
          when={props.links.length > 1}
          fallback={
            <div class="flex items-center gap-2 min-w-0 text-sm text-ink-muted">
              <Show when={active()} keyed>
                {(option) => <FromInboxOptionRow option={option} />}
              </Show>
            </div>
          }
        >
          <Dropdown>
            <Dropdown.Trigger
              disabled={props.disabled}
              class="flex items-center min-w-0 max-w-full gap-2 text-sm text-ink-muted"
            >
              <Show when={active()} keyed>
                {(option) => <FromInboxOptionRow option={option} />}
              </Show>
              <ChevronDown class="size-3 shrink-0" />
            </Dropdown.Trigger>
            <Dropdown.Content portalScope={props.portalScope}>
              {renderDropdownContent()}
            </Dropdown.Content>
          </Dropdown>
        </Show>
      )}
    </Show>
  );
}
