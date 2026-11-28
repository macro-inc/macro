import { ViewSidebar } from '@app/components/view-shell';
import { useAddInboxFlow } from '@core/email-link';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import GearIcon from '@icon/system/regular/gear.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Dropdown } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type CalendarAccount,
  useCalendarAccounts,
} from '../hooks/use-calendar-accounts';
import type { CalendarTimeFormat, CalendarWeekStart } from '../types';
import { useCalendarView } from './CalendarViewContext';
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

export function createCalendarSettingsControls() {
  const calendarView = useCalendarView();
  const accounts = useCalendarAccounts();
  const startAddInbox = useAddInboxFlow();
  const [turnOffTarget, setTurnOffTarget] =
    createSignal<TurnOffCalendarTarget | null>(null);

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
    weekStartLabel,
    timeFormatLabel,
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
 * Calendar display settings menu. The turn-off confirmation lives outside the
 * menu so it survives the menu closing on select.
 */
export function CalendarSettingsDropdown(props: { sidebar?: boolean }) {
  const controls = createCalendarSettingsControls();

  return (
    <>
      <DesktopCalendarSettings controls={controls} sidebar={props.sidebar} />
      <TurnOffCalendarDialog
        target={controls.turnOffTarget()}
        onClose={controls.clearTurnOffTarget}
      />
    </>
  );
}
