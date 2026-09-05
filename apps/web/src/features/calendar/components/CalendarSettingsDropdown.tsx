import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { enableMultiInbox } from '@core/constant/featureFlags';
import { useAddInboxFlow } from '@core/email-link';
import { isMobile } from '@core/mobile/isMobile';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import GearIcon from '@phosphor/gear.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button, Checkbox, Dropdown } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type CalendarAccount,
  useCalendarAccounts,
} from '../hooks/use-calendar-accounts';
import type { CalendarTimeFormat, CalendarWeekStart } from '../types';
import {
  type CalendarAccountGroup,
  groupCalendarSourcesByAccount,
} from '../utils/calendar-source-groups';
import { useCalendarView } from './CalendarViewContext';
import { MobilePeriodControls } from './PeriodSelector';
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

function createCalendarSettingsControls(isNarrow: () => boolean) {
  const calendarView = useCalendarView();
  const accounts = useCalendarAccounts();
  const startAddInbox = useAddInboxFlow();
  const multiInboxFlag = useFeatureFlag(enableMultiInbox);
  const [turnOffTarget, setTurnOffTarget] =
    createSignal<TurnOffCalendarTarget | null>(null);

  const showCalendarVisibility = () =>
    isNarrow() && calendarView.sources().length > 1;

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
    for (const source of group.calendars) {
      calendarView.setSourceVisibility(source.id, visible);
    }
  };
  const isAccountVisible = (group: CalendarAccountGroup) =>
    group.calendars.every((source) => calendarView.isSourceVisible(source.id));
  const isAccountPartiallyVisible = (group: CalendarAccountGroup) =>
    !isAccountVisible(group) &&
    group.calendars.some((source) => calendarView.isSourceVisible(source.id));

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

  // The add-inbox flow is entitlement-gated by the backend (402 -> paywall), so
  // "Connect another account" follows the multi-inbox flag like the email
  // inbox selector rather than mirroring that rule on the client.
  const showConnectAccount = () => multiInboxFlag().enabled;

  // Enable re-runs Google consent for calendar on an already-connected inbox;
  // turn off opens the confirmation, which lives outside the closing menu.
  const runAccountAction = (account: CalendarAccount) => {
    calendarView.closeEventDetails();
    match(account.action)
      .with('enable', () => {
        startAddInbox({ scopes: 'calendar' });
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
    startAddInbox({ scopes: 'gmail_and_calendar' });
  };

  return {
    calendarView,
    showCalendarVisibility,
    weekStartLabel,
    timeFormatLabel,
    changeAccountVisibility,
    isAccountVisible,
    isAccountPartiallyVisible,
    changeShowWeekends,
    changeWeekStartsOn,
    changeTimeFormat,
    accounts,
    showConnectAccount,
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
}) {
  const controls = props.controls;
  const calendarView = controls.calendarView;

  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        variant="ghost"
        size="icon-sm"
        class="shrink-0 rounded-lg"
        aria-label="Calendar settings"
      >
        <GearIcon class="size-3.5" />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-60 max-w-[calc(100vw-1rem)]">
        <Show when={controls.showCalendarVisibility()}>
          <Dropdown.Group>
            <Dropdown.GroupLabel>Calendars</Dropdown.GroupLabel>
            <For each={groupCalendarSourcesByAccount(calendarView.sources())}>
              {(group) => (
                <Dropdown.CheckboxItem
                  checked={controls.isAccountVisible(group)}
                  closeOnSelect={false}
                  onChange={(checked) =>
                    controls.changeAccountVisibility(group, checked)
                  }
                >
                  <span class="min-w-0 flex-1 truncate">
                    {group.emailAddress}
                  </span>
                </Dropdown.CheckboxItem>
              )}
            </For>
          </Dropdown.Group>
        </Show>

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

        <Show
          when={controls.accounts().length > 0 || controls.showConnectAccount()}
        >
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
                      'text-accent': account.action === 'enable',
                      'text-failure': account.action === 'turnOff',
                    }}
                  >
                    {account.action === 'enable' ? 'Enable' : 'Turn off'}
                  </span>
                </Dropdown.Item>
              )}
            </For>
            <Show when={controls.showConnectAccount()}>
              <Dropdown.Item
                closeOnSelect
                onSelect={controls.connectAnotherAccount}
              >
                <PlusIcon class="size-3.5 shrink-0 text-ink-muted" />
                <span class="min-w-0 flex-1 truncate">
                  Connect another account
                </span>
              </Dropdown.Item>
            </Show>
          </Dropdown.Group>
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}

const DRAWER_ROW_CLASS =
  "relative flex w-full items-center gap-3 bg-surface px-4 py-3 text-left text-sm text-ink not-last:after:absolute not-last:after:inset-x-2 not-last:after:bottom-0 not-last:after:h-px not-last:after:bg-edge-muted not-last:after:content-['']";

function MobileCalendarSettings(props: { controls: CalendarSettingsControls }) {
  const controls = props.controls;
  const calendarView = controls.calendarView;
  const [open, setOpen] = createSignal(false);

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
        size="icon-sm"
        class="shrink-0 rounded-full"
        aria-label="Calendar settings"
      >
        <GearIcon class="size-3.5" />
      </MobileDrawer.Trigger>

      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content
          aria-label="Calendar settings"
          class="overflow-y-auto"
        >
          <MobileDrawer.Handle />
          <MobilePeriodControls onSelect={() => setOpen(false)} />

          <Show when={controls.showCalendarVisibility()}>
            <MobileDrawer.Label>Calendars</MobileDrawer.Label>
            <MobileDrawer.Section class="flex shrink-0 flex-col">
              <For each={groupCalendarSourcesByAccount(calendarView.sources())}>
                {(group) => (
                  <Checkbox
                    checked={controls.isAccountVisible(group)}
                    indeterminate={controls.isAccountPartiallyVisible(group)}
                    onChange={(checked) =>
                      controls.changeAccountVisibility(group, checked)
                    }
                    class={DRAWER_ROW_CLASS}
                  >
                    <Checkbox.Label class="min-w-0 flex-1 truncate">
                      {group.emailAddress}
                    </Checkbox.Label>
                    <Checkbox.Control />
                  </Checkbox>
                )}
              </For>
            </MobileDrawer.Section>
            <div class="mt-4" />
          </Show>

          <MobileDrawer.Label>Display</MobileDrawer.Label>
          <MobileDrawer.Section class="flex shrink-0 flex-col">
            <Checkbox
              checked={calendarView.displaySettings.showWeekends}
              onChange={controls.changeShowWeekends}
              class={DRAWER_ROW_CLASS}
            >
              <Checkbox.Label class="min-w-0 flex-1 truncate">
                Show weekends
              </Checkbox.Label>
              <Checkbox.Control />
            </Checkbox>
          </MobileDrawer.Section>

          <MobileDrawer.Label class="pt-4">Week starts on</MobileDrawer.Label>
          <MobileDrawer.Section class="flex shrink-0 flex-col">
            <For each={WEEK_START_OPTIONS}>
              {(option) => (
                <button
                  type="button"
                  class={DRAWER_ROW_CLASS}
                  aria-pressed={
                    calendarView.displaySettings.weekStartsOn === option.value
                  }
                  onClick={() => controls.changeWeekStartsOn(option.value)}
                >
                  <span class="flex-1">{option.label}</span>
                  <CheckIcon
                    class="size-4 shrink-0 text-accent"
                    classList={{
                      invisible:
                        calendarView.displaySettings.weekStartsOn !==
                        option.value,
                    }}
                  />
                </button>
              )}
            </For>
          </MobileDrawer.Section>

          <MobileDrawer.Label class="pt-4">Time format</MobileDrawer.Label>
          <MobileDrawer.Section class="flex shrink-0 flex-col">
            <For each={TIME_FORMAT_OPTIONS}>
              {(option) => (
                <button
                  type="button"
                  class={DRAWER_ROW_CLASS}
                  aria-pressed={
                    calendarView.displaySettings.timeFormat === option.value
                  }
                  onClick={() => controls.changeTimeFormat(option.value)}
                >
                  <span class="flex-1">{option.label}</span>
                  <CheckIcon
                    class="size-4 shrink-0 text-accent"
                    classList={{
                      invisible:
                        calendarView.displaySettings.timeFormat !==
                        option.value,
                    }}
                  />
                </button>
              )}
            </For>
          </MobileDrawer.Section>

          <Show
            when={
              controls.accounts().length > 0 || controls.showConnectAccount()
            }
          >
            <MobileDrawer.Label class="pt-4">Accounts</MobileDrawer.Label>
            <MobileDrawer.Section class="mb-3 flex shrink-0 flex-col">
              <For each={controls.accounts()}>
                {(account) => (
                  <button
                    type="button"
                    class={DRAWER_ROW_CLASS}
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
                        'text-accent': account.action === 'enable',
                        'text-failure': account.action === 'turnOff',
                      }}
                    >
                      {account.action === 'enable' ? 'Enable' : 'Turn off'}
                    </span>
                  </button>
                )}
              </For>
              <Show when={controls.showConnectAccount()}>
                <button
                  type="button"
                  class={DRAWER_ROW_CLASS}
                  onClick={() => {
                    setOpen(false);
                    controls.connectAnotherAccount();
                  }}
                >
                  <PlusIcon class="size-4 shrink-0 text-ink-muted" />
                  <span class="min-w-0 flex-1 truncate">
                    Connect another account
                  </span>
                </button>
              </Show>
            </MobileDrawer.Section>
          </Show>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

/**
 * Responsive calendar display settings menu. The turn-off confirmation lives
 * outside the menu so it survives the menu closing on select.
 */
export function CalendarSettingsDropdown(props: { isNarrow?: boolean }) {
  const controls = createCalendarSettingsControls(
    () => props.isNarrow ?? false
  );

  return (
    <>
      <Show
        when={isMobile()}
        fallback={<DesktopCalendarSettings controls={controls} />}
      >
        <MobileCalendarSettings controls={controls} />
      </Show>
      <TurnOffCalendarDialog
        target={controls.turnOffTarget()}
        onClose={controls.clearTurnOffTarget}
      />
    </>
  );
}
