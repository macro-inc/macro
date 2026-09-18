import { ViewSidebar } from '@app/components/view-shell/ViewSidebar';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import LightningIcon from '@phosphor/lightning.svg';
import PlusIcon from '@phosphor/plus.svg';
import VideoIcon from '@phosphor/video-camera.svg';
import { Dropdown, Hotkey } from '@ui';

export function CalendarCreateMenu(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onEvent: () => void;
  onQuickCall: () => void;
  onScheduledCall: () => void;
}) {
  return (
    <Dropdown
      placement="bottom-start"
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <Dropdown.Trigger
        as={ViewSidebar.Action}
        aria-label="Create"
        disabled={props.pending}
      >
        <ViewSidebar.Icon>
          <PlusIcon class="size-4" />
        </ViewSidebar.Icon>
        <span class="truncate">
          {props.pending ? 'Starting call…' : 'Create'}
        </span>
        <ViewSidebar.Trailing>
          <CaretDownIcon class="size-3 shrink-0" />
        </ViewSidebar.Trailing>
      </Dropdown.Trigger>
      <Dropdown.Content class="w-80 max-w-[calc(100vw-2rem)] p-2">
        <Dropdown.Item
          aria-keyshortcuts="E"
          closeOnSelect
          onSelect={props.onEvent}
          class="gap-3 py-3"
        >
          <span class="rounded-lg bg-active p-1.5">
            <CalendarIcon class="size-5" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block font-medium">Event</span>
            <span class="block text-xs leading-4 text-ink-muted">
              Pick a time. Add a Macro call with one toggle.
            </span>
          </span>
          <Hotkey shortcut="e" theme="subtle" class="shrink-0" />
        </Dropdown.Item>
        <Dropdown.Item
          aria-keyshortcuts="Q"
          closeOnSelect
          onSelect={props.onQuickCall}
          class="gap-3 py-3"
        >
          <span class="rounded-lg bg-active p-1.5">
            <LightningIcon class="size-5" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block font-medium">Quick Call</span>
            <span class="block text-xs leading-4 text-ink-muted">
              Starts now. Share the link from the call.
            </span>
          </span>
          <Hotkey shortcut="q" theme="subtle" class="shrink-0" />
        </Dropdown.Item>
        <Dropdown.Item
          aria-keyshortcuts="S"
          closeOnSelect
          onSelect={props.onScheduledCall}
          class="gap-3 py-3"
        >
          <span class="rounded-lg bg-active p-1.5">
            <VideoIcon class="size-5" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block font-medium">Scheduled Call</span>
            <span class="block text-xs leading-4 text-ink-muted">
              Create an event with a Macro call.
            </span>
          </span>
          <Hotkey shortcut="s" theme="subtle" class="shrink-0" />
        </Dropdown.Item>
      </Dropdown.Content>
    </Dropdown>
  );
}
