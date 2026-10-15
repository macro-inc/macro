import { MobileFilterDrawer } from '@app/components/view-shell';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { inboxIconProps } from '@core/component/inboxIcon';
import { UserIcon, type UserIconSize } from '@core/component/UserIcon';
import { enableMultiInbox } from '@core/constant/featureFlags';
import { useAddInboxFlow } from '@core/email-link';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import TrayIcon from '@icon/system/regular/tray.svg';
import { useMailAccountsQuery } from '@queries/email/mail-accounts';
import { Button, cn, Dropdown, TabsInset } from '@ui';
import { createMemo, For, type JSX, Show } from 'solid-js';
import { fromInboxOptions } from '../../email-compose/core/email-sender';
import { useEmailView } from '../email-view-context';

const ALL_INBOXES_ID = 'all';

type InboxOption = {
  id: string;
  label: string;
  photoUrl?: string;
  inboxId?: string;
  aliasAddress?: string;
};

/**
 * Single-select over the user's linked inboxes: one inbox, or all of them.
 * `undefined` in view state means all; a chosen inbox is stored as `[id]`.
 * Legacy multi-id selections are normalized to their first inbox on restore.
 */
function useInboxSelection() {
  const { state, setInboxIds, setAliasFilter } = useEmailView();
  const linksQuery = useMailAccountsQuery();
  const multiInboxFlag = useFeatureFlag(enableMultiInbox);
  const addInbox = useAddInboxFlow();

  const options = createMemo((): InboxOption[] =>
    fromInboxOptions(
      linksQuery.isSuccess ? (linksQuery.data?.links ?? []) : []
    ).map((option) => ({
      id: option.id,
      inboxId: option.inboxId,
      label: option.email_address,
      photoUrl: option.photo_url ?? undefined,
      aliasAddress: option.isAlias ? option.email_address : undefined,
    }))
  );

  const isAll = () => state.inboxIds === undefined && !state.aliasFilter;
  // A persisted alias still needs a clear/switch control if it disappears.
  const hasMultipleInboxes = () => options().length > 1 || !!state.aliasFilter;
  const isSelected = (id: string) =>
    (options().length === 1 && !state.aliasFilter) || selectedId() === id;
  const selectedId = () => {
    if (state.aliasFilter)
      return `${state.aliasFilter.inboxId}:${state.aliasFilter.emailAddress.toLowerCase()}`;
    const ids = state.inboxIds;
    return ids?.length === 1 ? ids[0] : undefined;
  };
  const selectedOption = () => {
    const id = selectedId();
    return id === undefined
      ? undefined
      : (options().find((option) => option.id === id) ??
          (state.aliasFilter
            ? { id, label: state.aliasFilter.emailAddress }
            : undefined));
  };

  return {
    options,
    /** Keep the connected account visible even when there is no choice to make. */
    visible: () => multiInboxFlag().enabled || options().length > 0,
    hasMultipleInboxes,
    canAddInbox: () => multiInboxFlag().enabled,
    addInbox: () => void addInbox(),
    isAll,
    isSelected,
    selectedOption,
    selectAll: () => setInboxIds(undefined),
    select: (id: string) => {
      const option = options().find((option) => option.id === id);
      if (!option) return;
      if (option.aliasAddress && option.inboxId)
        setAliasFilter({
          inboxId: option.inboxId,
          emailAddress: option.aliasAddress,
        });
      else setInboxIds([option.id]);
    },
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

function InboxAvatar(props: {
  option: InboxOption;
  size: UserIconSize;
  class?: string;
}) {
  return (
    <UserIcon
      {...inboxIconProps(props.option.label)}
      photoUrl={props.option.photoUrl}
      size={props.size}
      class={props.class}
      suppressClick
      showTooltip={false}
    />
  );
}

/** Always-visible account switcher; one account or all inboxes at a time. */
export function EmailInboxList(props: { class?: string }) {
  const selection = useInboxSelection();

  return (
    <Show when={selection.visible()}>
      <section
        aria-label="Accounts"
        class={cn('flex shrink-0 flex-col gap-2', props.class)}
      >
        <div class="flex h-6 items-center justify-between pl-(--sidebar-item-inset) pr-1">
          <h2 class="text-xs font-medium text-ink-extra-muted">Accounts</h2>
          <Show when={selection.canAddInbox()}>
            <Button
              variant="ghost"
              size="sm"
              square
              aria-label="Connect another account"
              tooltip="Connect another account"
              onClick={selection.addInbox}
            >
              <PlusIcon class="size-3.5" />
            </Button>
          </Show>
        </div>
        <TabsInset
          aria-label="Email account"
          orientation="vertical"
          fullWidth
          class="h-auto"
          labelClass="min-h-10 gap-2.5 px-3 py-2 text-sm font-normal"
          value={selection.selectedOption()?.id ?? ALL_INBOXES_ID}
          onChange={(value) => {
            if (value === ALL_INBOXES_ID) selection.selectAll();
            else selection.select(value);
          }}
          list={[
            {
              value: ALL_INBOXES_ID,
              label: (
                <>
                  <TrayIcon aria-hidden="true" class="size-4 shrink-0" />
                  <span>All inboxes</span>
                </>
              ),
            },
            ...selection.options().map((option) => ({
              value: option.id,
              label: (
                <>
                  <span aria-hidden="true" class="shrink-0">
                    <InboxAvatar option={option} size="sm" class="size-4" />
                  </span>
                  <span class="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left [mask-image:linear-gradient(to_right,black_calc(100%_-_1rem),transparent)]">
                    {option.label}
                  </span>
                </>
              ),
            })),
          ]}
        />
      </section>
    </Show>
  );
}

/** Visible account scope beside the list title; clearing restores all inboxes. */
export function EmailInboxFilter(props: { class?: string }) {
  const selection = useInboxSelection();

  return (
    <Show when={selection.hasMultipleInboxes() && selection.selectedOption()}>
      {(selected) => (
        <div
          class={cn(
            'flex min-w-0 items-baseline gap-1 text-xs text-ink-muted',
            props.class
          )}
        >
          <span class="shrink-0">from</span>
          <Dropdown placement="bottom-start">
            <Dropdown.Trigger
              variant="ghost"
              size="sm"
              aria-label={`Switch inbox: ${selected().label}`}
              class="max-w-[min(16rem,30cqw)] text-sm font-semibold tracking-[-0.03em] text-ink @max-[720px]/view-shell:h-8 @max-[480px]/view-shell:max-w-[min(16rem,60cqw)]"
            >
              <span class="truncate">{selected().label}</span>
              <CaretDownIcon aria-hidden="true" class="size-3" />
            </Dropdown.Trigger>
            <Dropdown.Content class="min-w-56">
              <Dropdown.Group>
                <Dropdown.RadioGroup
                  value={selected().id}
                  onChange={(value) => {
                    if (value === ALL_INBOXES_ID) selection.selectAll();
                    else selection.select(value);
                  }}
                >
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
            </Dropdown.Content>
          </Dropdown>
        </div>
      )}
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
    <Show when={selection.hasMultipleInboxes()}>
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger
          variant="ghost"
          size="md"
          square
          depth={2}
          aria-label={`Inbox: ${selection.label()}`}
          tooltip={selection.label()}
          class={cn('size-8 shrink-0', props.class)}
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
        <CheckIcon class="size-3.5 text-ink" />
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
    <Show when={selection.hasMultipleInboxes()}>
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
