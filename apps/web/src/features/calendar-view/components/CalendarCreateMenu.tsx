import { ViewSidebar } from '@app/components/view-shell';
import { useQuickCallsFlag } from '@app/features/meetings/use-quick-calls-flag';
import { openStandaloneReminderComposer } from '@app/features/reminders/reminder-composer';
import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { enableReminders } from '@core/constant/featureFlags';
import BellIcon from '@phosphor/bell.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import PhoneIcon from '@phosphor/phone.svg';
import PlusIcon from '@phosphor/plus.svg';
import { useNavigate } from '@solidjs/router';
import { Dropdown } from '@ui';
import { Show } from 'solid-js';

export function CalendarCreateMenu(props: {
  onCreateEvent: () => void;
  onSelect?: () => void;
  sidebar?: boolean;
  header?: boolean;
  iconOnly?: boolean;
}) {
  const navigate = useNavigate();
  const quickCalls = useQuickCallsFlag();

  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        size={
          props.iconOnly ? 'icon-lg' : props.sidebar || props.header ? 'md' : 'sm'
        }
        label={props.iconOnly ? 'New' : undefined}
        class={
          props.iconOnly
            ? 'shrink-0 rounded-full border-transparent bg-transparent'
            : props.sidebar
              ? 'h-(--sidebar-row-height) w-full min-w-0 justify-start gap-(--sidebar-label-gap) px-(--sidebar-item-inset) text-left touch:h-11'
              : props.header
                ? 'h-(--sidebar-row-height) gap-(--sidebar-label-gap) rounded-full px-(--sidebar-item-inset) touch:h-11'
                : 'gap-1 rounded-lg px-2'
        }
      >
        <Show
          when={props.sidebar}
          fallback={
            <PlusIcon class={props.iconOnly ? 'size-5' : 'size-3.5'} />
          }
        >
          <ViewSidebar.Icon>
            <PlusIcon class="size-4" />
          </ViewSidebar.Icon>
        </Show>
        <Show when={!props.iconOnly}>
          <span class={props.sidebar ? 'min-w-0 flex-1 truncate' : undefined}>
            New
          </span>
          <CaretDownIcon class="size-3.5 shrink-0" />
        </Show>
      </Dropdown.Trigger>
      <Dropdown.Content
        class={
          props.sidebar
            ? 'w-[var(--kb-popper-anchor-width)] min-w-40'
            : 'min-w-40'
        }
      >
        <Dropdown.Group>
          <Dropdown.Item
            closeOnSelect
            onSelect={() => {
              props.onSelect?.();
              props.onCreateEvent();
            }}
          >
            <CalendarIcon class="size-4" />
            Event
          </Dropdown.Item>
          <Show when={quickCalls().enabled}>
            <Dropdown.Item
              closeOnSelect
              onSelect={() => {
                props.onSelect?.();
                navigate('/meet/new');
              }}
            >
              <PhoneIcon class="size-4" />
              Call
            </Dropdown.Item>
          </Show>
          <ShowFeatureFlag flag={enableReminders}>
            <Dropdown.Item
              closeOnSelect
              onSelect={() => {
                props.onSelect?.();
                openStandaloneReminderComposer();
              }}
            >
              <BellIcon class="size-4" />
              Reminder
            </Dropdown.Item>
          </ShowFeatureFlag>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
