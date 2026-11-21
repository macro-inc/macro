import { ViewSidebar } from '@app/components/view-shell';
import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { useAddInboxFlow } from '@core/email-link';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import GearIcon from '@icon/system/regular/gear.svg';
import MinusIcon from '@icon/system/regular/minus.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Key } from '@solid-primitives/keyed';
import { Button, Dropdown } from '@ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type CalendarAccount,
  useCalendarAccounts,
} from '../hooks/use-calendar-accounts';
import { useSetCalendarColor } from '../hooks/use-calendar-color';
import type { CalendarTimeFormat, CalendarWeekStart } from '../types';
import {
  type CalendarAccountGroup,
  groupCalendarSourcesByAccount,
} from '../utils/calendar-source-groups';
import { useCalendarView } from './CalendarViewContext';
import { CalendarColorPicker } from './calendar-color-picker';
import { MobilePeriodControls } from './PeriodSelector';
import { CalendarAccountLabel, CalendarSourceLabel } from './SourceControls';
import {
  TurnOffCalendarDialog,
  type TurnOffCalendarTarget,
} from './TurnOffCalendarDialog';

const WEEK_START_OPTIONS: Array<{
  value: CalendarWeekStart;
  label: string;
}> = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
];

const TIME_FORMAT_OPTIONS: Array<{
  value: CalendarTimeFormat;
  label: string;
}> = [
  { value: '12-hour', label: '12-hour' },
  { value: '24-hour', label: '24-hour' },
];

function createCalendarSettingsControls() {
  const calendarView = useCalendarView();
  const accounts = useCalendarAccounts();
  const startAddInbox = useAddInboxFlow();
  const [turnOffTarget, setTurnOffTarget] =
    createSignal<TurnOffCalendarTarget | null>(null);

  const showCalendarVisibility = () => calendarView.sources().length > 1;

  const weekStartLabel = createMemo(
    () =>
      WEEK_START_OPTIONS.find(
        (option) => option.value === calendarView.displaySettings.weekStartsOn
      )?.label ?? 'Sunday'
  );

  const timeFormatLabel = createMemo(
    () =>
      TIME_FORMAT_OPTIONS.find(
        (option) => option.value === calendarView.displaySettings.timeFormat
      )?.label ?? '12-hour'
  );

  // The account row checkbox shows or hides every calendar in the group.
  const changeAccountVisibility = (
    group: CalendarAccountGroup,
    visible: boolean
  ) => {
    calendarView.closeEventDetails();
    calendarView.setSourcesVisibility(
      group.calendars.map((source) => source.id),
      visible
    );
  };
  const isAccountVisible = (group: CalendarAccountGroup) =>
    group.calendars.every((source) => calendarView.isSourceVisible(source.id));
  const isAccountPartiallyVisible = (group: CalendarAccountGroup) =>
    !isAccountVisible(group) &&
    group.calendars.some((source) => calendarView.isSourceVisible(source.id));

  const changeCalendarVisibility = (sourceId: string, visible: boolean) => {
    calendarView.closeEventDetails();
    calendarView.setSourceVisibility(sourceId, visible);
  };

  const changeShowWeekends = (showWeekends: boolean) => {
    calendarView.closeEventDetails();
    calendarView.setShowWeekends(showWeekends);
  };

  const changeWeekStartsOn = (weekStartsOn: CalendarWeekStart) => {
    calendarView.closeEventDetails();
    calendarView.setWeekStartsOn(weekStartsOn);
  };

  const changeTimeFormat = (timeFormat: CalendarTimeFormat) => {
    calendarView.closeEventDetails();
    calendarView.setTimeFormat(timeFormat);
  };

  // Enable re-runs Google consent for calendar on an already-connected inbox;
  // turn off opens the confirmation, which lives outside the closing menu.
  const runAccountAction = (account: CalendarAccount) => {
    calendarView.closeEventDetails();
    match(account.action)
      .with('enable', () => {
        fireAndForget(
          startAddInbox({
            scopes: account.consentScopes,
            provider: account.provider,
            reconnectLinkId: account.linkId,
            emailAddress: account.emailAddress,
          }),
          'add-inbox'
        );
      })
      .with('reconnect', () => {
        fireAndForget(
          startAddInbox({
            scopes: account.consentScopes,
            provider: account.provider,
            reconnectLinkId: account.linkId,
            emailAddress: account.emailAddress,
          }),
          'add-inbox'
        );
      })
      .with('turnOff', () => {
        setTurnOffTarget({
          linkId: account.linkId,
          emailAddress: account.emailAddress,
        });
      })
      .exhaustive();
  };

  // A brand-new account needs the mailbox scopes alongside calendar.
  const connectAnotherAccount = () => {
    calendarView.closeEventDetails();
    fireAndForget(
      startAddInbox({ scopes: 'gmail_and_calendar' }),
      'calendar-settings'
    );
  };

  return {
    calendarView,
    showCalendarVisibility,
    weekStartLabel,
    timeFormatLabel,
    changeAccountVisibility,
    isAccountVisible,
    isAccountPartiallyVisible,
    changeCalendarVisibility,
    changeShowWeekends,
    changeWeekStartsOn,
    changeTimeFormat,
    accounts,
    runAccountAction,
    connectAnotherAccount,
    turnOffTarget,
    clearTurnOffTarget: () => setTurnOffTarget(null),
  };
}

type CalendarSettingsControls = ReturnType<
  typeof createCalendarSettingsControls
>;

function DesktopCalendarSettings(props: {
  controls: CalendarSettingsControls;
  sidebar?: boolean;
}) {
  const controls = props.controls;
  const calendarView = controls.calendarView;

  return (
    <Dropdown placement={props.sidebar ? 'top-end' : 'bottom-end'}>
      <Dropdown.Trigger
        variant="ghost"
        size={props.sidebar ? 'md' : 'icon-lg'}
        class={
          props.sidebar
            ? 'h-(--sidebar-row-height) w-full justify-start gap-(--sidebar-label-gap) rounded-lg border-transparent bg-transparent px-(--sidebar-item-inset) text-left font-normal touch:h-11'
            : 'shrink-0 border-transparent bg-transparent'
        }
        aria-label="Calendar settings"
      >
        <Show when={props.sidebar} fallback={<GearIcon class="size-5" />}>
          <ViewSidebar.Icon>
            <GearIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
          </ViewSidebar.Icon>
          <span class="min-w-0 truncate">Settings</span>
        </Show>
      </Dropdown.Trigger>
      <Dropdown.Content class="w-60 max-w-[calc(100vw-1rem)]">
        <Dropdown.Group>
          <Dropdown.GroupLabel>Display</Dropdown.GroupLabel>
          <Dropdown.CheckboxItem
            checked={calendarView.displaySettings.showWeekends}
            closeOnSelect={false}
            onChange={controls.changeShowWeekends}
          >
            <span class="flex-1 truncate">Show weekends</span>
          </Dropdown.CheckboxItem>

          <Dropdown.Sub>
            <Dropdown.SubTrigger>
              <span class="min-w-0 flex-1 truncate text-xs text-ink-muted">
                Week starts on
              </span>
              <span class="text-sm font-medium text-ink">
                {controls.weekStartLabel()}
              </span>
              <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
            </Dropdown.SubTrigger>
            <Dropdown.SubContent class="min-w-36">
              <Dropdown.Group>
                <Dropdown.RadioGroup
                  value={String(calendarView.displaySettings.weekStartsOn)}
                  onChange={(value) =>
                    controls.changeWeekStartsOn(
                      Number(value) as CalendarWeekStart
                    )
                  }
                >
                  <For each={WEEK_START_OPTIONS}>
                    {(option) => (
                      <Dropdown.RadioItem
                        closeOnSelect
                        value={String(option.value)}
                      >
                        <span class="flex-1">{option.label}</span>
                        <Dropdown.ItemIndicator>
                          <CheckIcon class="size-3.5 text-accent" />
                        </Dropdown.ItemIndicator>
                      </Dropdown.RadioItem>
                    )}
                  </For>
                </Dropdown.RadioGroup>
              </Dropdown.Group>
            </Dropdown.SubContent>
          </Dropdown.Sub>

          <Dropdown.Sub>
            <Dropdown.SubTrigger>
              <span class="min-w-0 flex-1 truncate text-xs text-ink-muted">
                Time format
              </span>
              <span class="text-sm font-medium text-ink">
                {controls.timeFormatLabel()}
              </span>
              <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
            </Dropdown.SubTrigger>
            <Dropdown.SubContent class="min-w-36">
              <Dropdown.Group>
                <Dropdown.RadioGroup
                  value={calendarView.displaySettings.timeFormat}
                  onChange={(value) =>
                    controls.changeTimeFormat(value as CalendarTimeFormat)
                  }
                >
                  <For each={TIME_FORMAT_OPTIONS}>
                    {(option) => (
                      <Dropdown.RadioItem closeOnSelect value={option.value}>
                        <span class="flex-1">{option.label}</span>
                        <Dropdown.ItemIndicator>
                          <CheckIcon class="size-3.5 text-accent" />
                        </Dropdown.ItemIndicator>
                      </Dropdown.RadioItem>
                    )}
                  </For>
                </Dropdown.RadioGroup>
              </Dropdown.Group>
            </Dropdown.SubContent>
          </Dropdown.Sub>
        </Dropdown.Group>

        <Dropdown.Group>
          <Dropdown.GroupLabel>Accounts</Dropdown.GroupLabel>
          <For each={controls.accounts()}>
            {(account) => (
              <Dropdown.Item
                closeOnSelect
                onSelect={() => controls.runAccountAction(account)}
              >
                <span class="min-w-0 flex-1 truncate">
                  {account.emailAddress}
                </span>
                <span
                  class="shrink-0 text-xs font-medium"
                  classList={{
                    'text-accent': account.action !== 'turnOff',
                    'text-failure': account.action === 'turnOff',
                  }}
                >
                  {match(account.action)
                    .with('enable', () => 'Enable')
                    .with('reconnect', () => 'Reconnect')
                    .with('turnOff', () => 'Turn off')
                    .exhaustive()}
                </span>
              </Dropdown.Item>
            )}
          </For>
          <Dropdown.Item
            closeOnSelect
            onSelect={controls.connectAnotherAccount}
          >
            <PlusIcon class="size-3.5 shrink-0 text-ink-muted" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate">Connect another account</span>
              <span class="truncate text-xs text-ink-muted">
                Email and calendar together
              </span>
            </span>
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

/**
 * The phone sheet's calendar list, folded per account like the desktop
 * sidebar's and laid out like the mobile filter drawer's groups: each account
 * is its own card whose header row shows or hides all of its calendars, and
 * whose trailing caret reveals them as filter options, so neighbouring shown
 * calendars join into one selection. Accounts start folded.
 */
function MobileCalendarVisibility(props: {
  controls: CalendarSettingsControls;
}) {
  const controls = props.controls;
  const setCalendarColor = useSetCalendarColor();
  const [expandedKeys, setExpandedKeys] = createSignal<readonly string[]>([]);
  const isExpanded = (key: string) => expandedKeys().includes(key);
  const toggleExpanded = (key: string) =>
    setExpandedKeys((current) =>
      current.includes(key)
        ? current.filter((expandedKey) => expandedKey !== key)
        : [...current, key]
    );

  return (
    <div class="flex flex-col gap-3">
      <For
        each={groupCalendarSourcesByAccount(controls.calendarView.sources())}
      >
        {(group) => {
          const shown = () =>
            controls.isAccountVisible(group) ||
            controls.isAccountPartiallyVisible(group);

          return (
            <MobileDrawer.Section class="flex shrink-0 flex-col">
              {/* The selection fills the whole header, caret included. */}
              <div
                class="flex min-w-0 items-center rounded-[20px]"
                classList={{ 'bg-ink/8': shown() }}
              >
                <MobileDrawer.Item
                  role="checkbox"
                  class="min-w-0 flex-1 aria-checked:bg-transparent aria-[checked=mixed]:bg-transparent"
                  aria-checked={
                    controls.isAccountPartiallyVisible(group)
                      ? 'mixed'
                      : controls.isAccountVisible(group)
                  }
                  onClick={() =>
                    controls.changeAccountVisibility(
                      group,
                      !controls.isAccountVisible(group)
                    )
                  }
                >
                  <span class="flex min-w-0 flex-1 items-center gap-2 font-medium">
                    <CalendarAccountLabel group={group} />
                  </span>
                  <span class="flex size-5 shrink-0 items-center justify-center">
                    <Show
                      when={controls.isAccountPartiallyVisible(group)}
                      fallback={
                        <Show when={controls.isAccountVisible(group)}>
                          <CheckIcon class="size-4 text-ink" />
                        </Show>
                      }
                    >
                      <MinusIcon class="size-4 text-ink" />
                    </Show>
                  </span>
                </MobileDrawer.Item>
                <MobileDrawer.Item
                  class="w-11 shrink-0 justify-center px-0 text-ink-muted"
                  aria-label={`${isExpanded(group.key) ? 'Collapse' : 'Expand'} ${group.emailAddress}`}
                  aria-expanded={isExpanded(group.key)}
                  onClick={() => toggleExpanded(group.key)}
                >
                  <CaretDownIcon
                    class="size-4 -rotate-90 transition-transform"
                    classList={{ 'rotate-0': isExpanded(group.key) }}
                  />
                </MobileDrawer.Item>
              </div>
              <CollapseTransition open={isExpanded(group.key)}>
                <div class="flex min-w-0 flex-col pt-1">
                  <Key each={group.calendars} by={(calendar) => calendar.id}>
                    {(source) => {
                      const visible = () =>
                        controls.calendarView.isSourceVisible(source().id);
                      // Like the account header: the selection fills the
                      // whole row, the color button included, and shown
                      // neighbours join into one selection.
                      return (
                        <div
                          class="flex min-w-0 items-center rounded-[20px] [&[data-shown]:has(+[data-shown])]:rounded-b-none [&[data-shown]+[data-shown]]:rounded-t-none"
                          classList={{ 'bg-ink/8': visible() }}
                          data-shown={visible() ? '' : undefined}
                        >
                          <span class="flex shrink-0 pl-1">
                            <CalendarColorPicker
                              compact
                              label={`Color for ${source().name} (${source().emailAddress ?? ''})`}
                              color={source().color}
                              overridden={source().hasCustomColor === true}
                              onChange={(color) =>
                                setCalendarColor(source().id, color)
                              }
                            />
                          </span>
                          <MobileDrawer.Item
                            role="checkbox"
                            aria-checked={visible()}
                            class="min-w-0 flex-1 pl-1 aria-checked:bg-transparent"
                            onClick={() =>
                              controls.changeCalendarVisibility(
                                source().id,
                                !visible()
                              )
                            }
                          >
                            <span class="flex min-w-0 flex-1 items-center gap-2">
                              <CalendarSourceLabel source={source()} />
                            </span>
                            <span class="flex size-5 shrink-0 items-center justify-center">
                              <Show when={visible()}>
                                <CheckIcon class="size-4 text-ink" />
                              </Show>
                            </span>
                          </MobileDrawer.Item>
                        </div>
                      );
                    }}
                  </Key>
                </div>
              </CollapseTransition>
            </MobileDrawer.Section>
          );
        }}
      </For>
    </div>
  );
}

function MobileCalendarSettings(props: {
  controls: CalendarSettingsControls;
  sidebar?: boolean;
}) {
  const controls = props.controls;
  const calendarView = controls.calendarView;
  const [open, setOpen] = createSignal(false);
  const weekStartLabelId = createUniqueId();
  const timeFormatLabelId = createUniqueId();

  return (
    <MobileDrawer
      side="bottom"
      open={open()}
      onOpenChange={setOpen}
      preventScroll={false}
      preventScrollbarShift={false}
    >
      <MobileDrawer.Trigger
        as={Button}
        variant="ghost"
        size={props.sidebar ? 'md' : 'icon-lg'}
        class={
          props.sidebar
            ? 'h-(--sidebar-row-height) w-full justify-start gap-(--sidebar-label-gap) rounded-lg px-(--sidebar-item-inset) text-left font-normal touch:h-11'
            : 'shrink-0 rounded-full'
        }
        aria-label="Calendar settings"
      >
        <Show when={props.sidebar} fallback={<GearIcon class="size-6" />}>
          <ViewSidebar.Icon>
            <GearIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
          </ViewSidebar.Icon>
          <span class="min-w-0 truncate">Settings</span>
        </Show>
      </MobileDrawer.Trigger>

      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label="Calendar settings">
          <MobileDrawer.Handle />
          <MobileDrawer.ScrollBody>
            <MobilePeriodControls onSelect={() => setOpen(false)} />

            <Show when={controls.showCalendarVisibility()}>
              <MobileDrawer.Label>Calendars</MobileDrawer.Label>
              <MobileCalendarVisibility controls={controls} />
              <div class="mt-4" />
            </Show>

            <MobileDrawer.Label>Display</MobileDrawer.Label>
            <MobileDrawer.Section class="flex shrink-0 flex-col">
              <MobileFilterDrawer.Option
                checked={calendarView.displaySettings.showWeekends}
                onChange={controls.changeShowWeekends}
              >
                Show weekends
              </MobileFilterDrawer.Option>
            </MobileDrawer.Section>

            <MobileDrawer.Label id={weekStartLabelId} class="pt-4">
              Week starts on
            </MobileDrawer.Label>
            <MobileDrawer.Section
              role="radiogroup"
              aria-labelledby={weekStartLabelId}
              class="flex shrink-0 flex-col"
            >
              <For each={WEEK_START_OPTIONS}>
                {(option) => (
                  <MobileFilterDrawer.Option
                    selectionMode="single"
                    checked={
                      calendarView.displaySettings.weekStartsOn === option.value
                    }
                    onChange={() => controls.changeWeekStartsOn(option.value)}
                  >
                    {option.label}
                  </MobileFilterDrawer.Option>
                )}
              </For>
            </MobileDrawer.Section>

            <MobileDrawer.Label id={timeFormatLabelId} class="pt-4">
              Time format
            </MobileDrawer.Label>
            <MobileDrawer.Section
              role="radiogroup"
              aria-labelledby={timeFormatLabelId}
              class="flex shrink-0 flex-col"
            >
              <For each={TIME_FORMAT_OPTIONS}>
                {(option) => (
                  <MobileFilterDrawer.Option
                    selectionMode="single"
                    checked={
                      calendarView.displaySettings.timeFormat === option.value
                    }
                    onChange={() => controls.changeTimeFormat(option.value)}
                  >
                    {option.label}
                  </MobileFilterDrawer.Option>
                )}
              </For>
            </MobileDrawer.Section>

            <MobileDrawer.Label class="pt-4">Accounts</MobileDrawer.Label>
            <MobileDrawer.Section class="mb-3 flex shrink-0 flex-col">
              <For each={controls.accounts()}>
                {(account) => (
                  <MobileDrawer.Item
                    onClick={() => {
                      setOpen(false);
                      controls.runAccountAction(account);
                    }}
                  >
                    <span class="min-w-0 flex-1 truncate">
                      {account.emailAddress}
                    </span>
                    <span
                      class="shrink-0 text-xs font-medium"
                      classList={{
                        'text-accent': account.action !== 'turnOff',
                        'text-failure': account.action === 'turnOff',
                      }}
                    >
                      {match(account.action)
                        .with('enable', () => 'Enable')
                        .with('reconnect', () => 'Reconnect')
                        .with('turnOff', () => 'Turn off')
                        .exhaustive()}
                    </span>
                  </MobileDrawer.Item>
                )}
              </For>
              <MobileDrawer.Item
                onClick={() => {
                  setOpen(false);
                  controls.connectAnotherAccount();
                }}
              >
                <PlusIcon class="size-4 shrink-0 text-ink-muted" />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate">Connect another account</span>
                  <span class="truncate text-xs text-ink-muted">
                    Email and calendar together
                  </span>
                </span>
              </MobileDrawer.Item>
            </MobileDrawer.Section>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

/**
 * Responsive calendar display settings menu. The turn-off confirmation lives
 * outside the menu so it survives the menu closing on select.
 */
export function CalendarSettingsDropdown(props: { sidebar?: boolean }) {
  const controls = createCalendarSettingsControls();

  return (
    <>
      <Show
        when={isMobile()}
        fallback={
          <DesktopCalendarSettings
            controls={controls}
            sidebar={props.sidebar}
          />
        }
      >
        <MobileCalendarSettings controls={controls} sidebar={props.sidebar} />
      </Show>
      <TurnOffCalendarDialog
        target={controls.turnOffTarget()}
        onClose={controls.clearTurnOffTarget}
      />
    </>
  );
}
