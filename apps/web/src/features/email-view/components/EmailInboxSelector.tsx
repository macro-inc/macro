import { MobileFilterDrawer, ViewSidebar } from '@app/components/view-shell';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { inboxIconProps } from '@core/component/inboxIcon';
import { UserIcon, type UserIconSize } from '@core/component/UserIcon';
import { enableMultiInbox } from '@core/constant/featureFlags';
import { useAddInboxFlow } from '@core/email-link';
import CheckIcon from '@phosphor/check.svg';
import PlusIcon from '@phosphor/plus.svg';
import TrayIcon from '@phosphor/tray.svg';
import { useEmailLinksQuery } from '@queries/email/link';
import { Button, cn, Dropdown, pressHandlers } from '@ui';
import { createMemo, For, type JSX, Show } from 'solid-js';
import { useEmailView } from '../email-view-context';

const ALL_INBOXES_ID = 'all';

type InboxOption = { id: string; label: string; photoUrl?: string };

/**
 * Single-select over the user's linked inboxes: one inbox, or all of them.
 * `undefined` in view state means all; a chosen inbox is stored as `[id]`.
 * A stale multi-id selection persisted by the old picker still filters the
 * list, and every included inbox reads as selected until the user picks one.
 */
function useInboxSelection() {
  const { state, setInboxIds } = useEmailView();
  const linksQuery = useEmailLinksQuery();
  const multiInboxFlag = useFeatureFlag(enableMultiInbox);
  const addInbox = useAddInboxFlow();

  const options = createMemo((): InboxOption[] =>
    (linksQuery.isSuccess ? linksQuery.data.links : [])
      .map((link) => ({
        id: link.id,
        label: link.email_address,
        photoUrl: link.photo_url ?? undefined,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  );

  const isAll = () => state.inboxIds === undefined;
  const isSelected = (id: string) => state.inboxIds?.includes(id) ?? false;
  const selectedId = () => {
    const ids = state.inboxIds;
    return ids?.length === 1 ? ids[0] : undefined;
  };
  const selectedOption = () => {
    const id = selectedId();
    return id === undefined
      ? undefined
      : options().find((option) => option.id === id);
  };

  return {
    options,
    /** Shown whenever the flag is on or the user already has several inboxes. */
    visible: () => multiInboxFlag().enabled || options().length > 1,
    canAddInbox: () => multiInboxFlag().enabled,
    addInbox: () => void addInbox(),
    isAll,
    isSelected,
    selectedOption,
    selectAll: () => setInboxIds(undefined),
    select: (id: string) => setInboxIds([id]),
    label: () => {
      const sole = selectedOption();
      if (sole) return sole.label;
      if (isAll()) return 'All inboxes';
      const count = state.inboxIds?.length ?? 0;
      if (count === 0) return 'No inboxes';
      return count === 1 ? '1 inbox' : `${count} inboxes`;
    },
  };
}

function InboxAvatar(props: { option: InboxOption; size: UserIconSize }) {
  return (
    <UserIcon
      {...inboxIconProps(props.option.label)}
      photoUrl={props.option.photoUrl}
      size={props.size}
      suppressClick
      showTooltip={false}
    />
  );
}

function AllInboxesIcon(props: { class?: string }) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        'flex size-6 shrink-0 items-center justify-center',
        props.class
      )}
    >
      <TrayIcon class="size-5" />
    </span>
  );
}

/**
 * The inbox list at the top of the Email sidebar: `All inboxes` (with a
 * `Connect another account` button beside it) followed by one row per inbox.
 * Clicking a row selects that inbox alone; there is no multi-select.
 */
export function EmailInboxList(props: { class?: string }) {
  const selection = useInboxSelection();

  return (
    <Show when={selection.visible()}>
      <ViewSidebar.Nav
        aria-label="Inboxes"
        class={cn('border-b border-edge pb-3', props.class)}
      >
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.Item
            active={selection.isAll()}
            aria-current={selection.isAll() ? 'true' : undefined}
            class="min-w-0 flex-1"
            {...pressHandlers(selection.selectAll)}
          >
            <AllInboxesIcon />
            <span class="truncate">All inboxes</span>
          </ViewSidebar.Item>
          <Show when={selection.canAddInbox()}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              square
              class="size-8 shrink-0 rounded-full text-ink-muted transition-none"
              label="Connect another account"
              {...pressHandlers(selection.addInbox)}
            >
              <PlusIcon class="size-4" />
            </Button>
          </Show>
        </div>
        <For each={selection.options()}>
          {(option) => (
            <ViewSidebar.Item
              active={selection.isSelected(option.id)}
              aria-current={
                selection.isSelected(option.id) ? 'true' : undefined
              }
              {...pressHandlers(() => selection.select(option.id))}
            >
              <span
                aria-hidden="true"
                class="flex size-6 shrink-0 items-center"
              >
                <InboxAvatar option={option} size="md" />
              </span>
              <span class="truncate">{option.label}</span>
            </ViewSidebar.Item>
          )}
        </For>
      </ViewSidebar.Nav>
    </Show>
  );
}

/**
 * Icon-only trigger the narrow header falls back to while the sidebar is
 * collapsed; opens the same single-select list as a menu.
 */
export function EmailInboxMenu(props: { class?: string }) {
  const selection = useInboxSelection();

  const radioValue = () => {
    if (selection.isAll()) return ALL_INBOXES_ID;
    return selection.selectedOption()?.id ?? '';
  };

  const onRadioChange = (value: string) => {
    if (value === ALL_INBOXES_ID) selection.selectAll();
    else selection.select(value);
  };

  return (
    <Show when={selection.visible()}>
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger
          variant="ghost"
          size="sm"
          square
          depth={2}
          aria-label={`Inbox: ${selection.label()}`}
          tooltip={selection.label()}
          class={cn('size-8 shrink-0 rounded-full', props.class)}
        >
          <Show
            when={selection.selectedOption()}
            fallback={<TrayIcon aria-hidden="true" class="size-4 shrink-0" />}
          >
            {(option) => <InboxAvatar option={option()} size="sm" />}
          </Show>
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-56">
          <Dropdown.Group>
            <Dropdown.RadioGroup value={radioValue()} onChange={onRadioChange}>
              <InboxRadioItem
                value={ALL_INBOXES_ID}
                icon={<TrayIcon class="size-4" />}
              >
                All inboxes
              </InboxRadioItem>
              <For each={selection.options()}>
                {(option) => (
                  <InboxRadioItem
                    value={option.id}
                    icon={<InboxAvatar option={option} size="sm" />}
                  >
                    {option.label}
                  </InboxRadioItem>
                )}
              </For>
            </Dropdown.RadioGroup>
          </Dropdown.Group>
          <Show when={selection.canAddInbox()}>
            <Dropdown.Group>
              <Dropdown.Item closeOnSelect onSelect={selection.addInbox}>
                <span
                  aria-hidden="true"
                  class="flex size-4 shrink-0 items-center justify-center"
                >
                  <PlusIcon class="size-4" />
                </span>
                <span class="flex-1">Connect another account</span>
              </Dropdown.Item>
            </Dropdown.Group>
          </Show>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}

function InboxRadioItem(props: {
  value: string;
  icon?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <Dropdown.RadioItem closeOnSelect value={props.value}>
      <span
        aria-hidden="true"
        class="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4"
      >
        {props.icon}
      </span>
      <span class="min-w-0 flex-1 truncate">{props.children}</span>
      <Dropdown.ItemIndicator>
        <CheckIcon class="size-3.5 text-accent" />
      </Dropdown.ItemIndicator>
    </Dropdown.RadioItem>
  );
}

/**
 * Inbox section of the mobile filter drawer; must render inside the drawer's
 * `Accordion`. Radio semantics match the sidebar list: one inbox or all.
 */
export function EmailInboxDrawerSection(props: { value: string }) {
  const selection = useInboxSelection();

  return (
    <Show when={selection.visible()}>
      <MobileFilterDrawer.Section
        value={props.value}
        label="Inbox"
        activeCount={selection.isAll() ? 0 : 1}
      >
        <div role="radiogroup" aria-label="Inbox">
          <MobileFilterDrawer.Option
            selectionMode="single"
            checked={selection.isAll()}
            onChange={selection.selectAll}
            icon={<TrayIcon class="size-4" />}
          >
            All inboxes
          </MobileFilterDrawer.Option>
          <For each={selection.options()}>
            {(option) => (
              <MobileFilterDrawer.Option
                selectionMode="single"
                checked={selection.isSelected(option.id)}
                onChange={() => selection.select(option.id)}
                icon={<InboxAvatar option={option} size="sm" />}
              >
                {option.label}
              </MobileFilterDrawer.Option>
            )}
          </For>
        </div>
      </MobileFilterDrawer.Section>
    </Show>
  );
}
