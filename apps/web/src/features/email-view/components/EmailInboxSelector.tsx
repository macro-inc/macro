import { MobileFilterDrawer, ViewSidebar } from '@app/components/view-shell';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { inboxIconProps } from '@core/component/inboxIcon';
import { UserIcon, type UserIconSize } from '@core/component/UserIcon';
import { enableMultiInbox } from '@core/constant/featureFlags';
import { useAddInboxFlow } from '@core/email-link';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import PlusIcon from '@phosphor/plus.svg';
import TrayIcon from '@phosphor/tray.svg';
import { useMailAccountsQuery } from '@queries/email/mail-accounts';
import { AvatarGroup, Button, cn, Dropdown, pressHandlers } from '@ui';
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
    addInbox: () => fireAndForget(addInbox(), 'add-inbox'),
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

function AllInboxesAvatar(props: { options: readonly InboxOption[] }) {
  const inboxes = () =>
    props.options.filter((option) => !option.aliasAddress).slice(0, 2);

  return (
    <Show
      when={!isTouchDevice() && inboxes().length > 0}
      fallback={<TrayIcon aria-hidden="true" class="size-4 shrink-0" />}
    >
      <AvatarGroup size="sm" aria-hidden="true">
        <For each={inboxes()}>
          {(option) => <InboxAvatar option={option} size="sm" />}
        </For>
      </AvatarGroup>
    </Show>
  );
}

function InboxAccountGroup(props: {
  selection: ReturnType<typeof useInboxSelection>;
  class?: string;
}) {
  const selection = props.selection;
  const selectedOption = () =>
    selection.selectedOption() ??
    (selection.options().length === 1 && selection.isAll()
      ? selection.options()[0]
      : undefined);
  const label = () =>
    selectedOption()?.label ??
    (selection.options().length ? selection.label() : 'No inboxes connected');

  return (
    <section
      aria-label="Email accounts"
      class={cn(
        'shrink-0 rounded-xl border border-edge-button bg-control not-touch:elevated p-1',
        props.class
      )}
    >
      <h2 class="px-2 pt-1 pb-1.5 text-xs font-medium text-ink-muted">
        Accounts
      </h2>
      <Dropdown placement="bottom-start">
        <Dropdown.Trigger
          variant="ghost"
          size="md"
          disabled={selection.options().length === 0}
          aria-label={`Select inbox: ${label()}`}
          title={label()}
          class="w-full min-w-0 justify-start gap-2 rounded-lg px-2 text-ink"
        >
          <Show
            when={selectedOption()}
            fallback={<AllInboxesAvatar options={selection.options()} />}
          >
            {(option) => (
              <InboxAvatar option={option()} size="sm" class="size-5" />
            )}
          </Show>
          <span class="min-w-0 flex-1 truncate text-left">{label()}</span>
          <CaretDownIcon aria-hidden="true" class="size-3.5 shrink-0" />
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-[var(--kb-popper-anchor-width)] max-w-80">
          <Dropdown.Group>
            <Dropdown.RadioGroup
              value={
                selectedOption()?.id ??
                (selection.isAll() ? ALL_INBOXES_ID : '')
              }
              onChange={(value) => {
                if (value === ALL_INBOXES_ID) selection.selectAll();
                else selection.select(value);
              }}
            >
              <Show when={selection.hasMultipleInboxes()}>
                <InboxRadioItem
                  value={ALL_INBOXES_ID}
                  icon={<AllInboxesAvatar options={selection.options()} />}
                >
                  All inboxes
                </InboxRadioItem>
              </Show>
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
      <Show when={selection.canAddInbox()}>
        <div class="mt-1 border-t border-edge-divider pt-1">
          <Button
            variant="ghost"
            size="md"
            class="w-full justify-start gap-2 rounded-lg px-2 text-xs"
            onClick={selection.addInbox}
          >
            <PlusIcon class="size-4" />
            Connect another account
          </Button>
        </div>
      </Show>
    </section>
  );
}

function InboxAccountList(props: {
  selection: ReturnType<typeof useInboxSelection>;
  class?: string;
}) {
  const selection = props.selection;
  return (
    <div
      class={cn('flex shrink-0 flex-col gap-(--sidebar-row-gap)', props.class)}
    >
      <ViewSidebar.Nav
        aria-label="Inboxes"
        class="max-h-[calc(4*var(--sidebar-row-height)+3*var(--sidebar-row-gap))] overflow-y-auto overscroll-none touch:max-h-[calc(11rem+3*var(--sidebar-row-gap))]"
      >
        <Show when={selection.hasMultipleInboxes()}>
          <ViewSidebar.Item
            active={selection.isAll()}
            aria-current={selection.isAll() ? 'true' : undefined}
            {...pressHandlers(selection.selectAll)}
          >
            <ViewSidebar.Icon>
              <Show
                when={selection.isAll()}
                fallback={<TrayIcon class="size-4" />}
              >
                <CheckIcon class="size-4 text-accent" />
              </Show>
            </ViewSidebar.Icon>
            <span class="truncate">All inboxes</span>
          </ViewSidebar.Item>
        </Show>
        <For each={selection.options()}>
          {(option) => (
            <ViewSidebar.Item
              active={selection.isSelected(option.id)}
              aria-current={
                selection.isSelected(option.id) ? 'true' : undefined
              }
              {...pressHandlers(() => selection.select(option.id))}
            >
              <ViewSidebar.Icon>
                <Show
                  when={selection.isSelected(option.id)}
                  fallback={
                    <InboxAvatar option={option} size="sm" class="size-5" />
                  }
                >
                  <CheckIcon class="size-4 text-accent" />
                </Show>
              </ViewSidebar.Icon>
              <span
                class={cn('truncate', option.aliasAddress && 'pl-2')}
                title={option.label}
              >
                {option.label}
              </span>
            </ViewSidebar.Item>
          )}
        </For>
      </ViewSidebar.Nav>
      <Show when={selection.canAddInbox()}>
        <ViewSidebar.Item {...pressHandlers(selection.addInbox)}>
          <ViewSidebar.Icon>
            <PlusIcon class="size-4" />
          </ViewSidebar.Icon>
          <span class="truncate">Connect another account</span>
        </ViewSidebar.Item>
      </Show>
    </div>
  );
}

/** A contained desktop account selector; touch keeps its existing inbox list. */
export function EmailInboxList(props: { class?: string }) {
  const selection = useInboxSelection();

  return (
    <Show when={selection.visible()}>
      <Show
        when={!isTouchDevice()}
        fallback={
          <InboxAccountList selection={selection} class={props.class} />
        }
      >
        <InboxAccountGroup selection={selection} class={props.class} />
      </Show>
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
                    icon={<AllInboxesAvatar options={selection.options()} />}
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
          size="icon-md"
          depth={2}
          aria-label={`Inbox: ${selection.label()}`}
          tooltip={selection.label()}
          class={cn('shrink-0', props.class)}
        >
          <Show
            when={selection.selectedOption()}
            fallback={<AllInboxesAvatar options={selection.options()} />}
          >
            {(option) => <InboxAvatar option={option()} size="sm" />}
          </Show>
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-56">
          <Dropdown.Group>
            <Dropdown.RadioGroup value={radioValue()} onChange={onRadioChange}>
              <InboxRadioItem
                value={ALL_INBOXES_ID}
                icon={<AllInboxesAvatar options={selection.options()} />}
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
