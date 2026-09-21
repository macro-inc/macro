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
      <Dropdown.Content class="min-w-52">
        <Dropdown.Group>
          <Dropdown.Item
            aria-keyshortcuts="E"
            closeOnSelect
            onSelect={props.onEvent}
            class="min-h-9 gap-2 px-2.5"
          >
            <div class="size-4 shrink-0 flex items-center rounded-sm text-ink-muted [&_svg]:size-4">
              <CalendarIcon />
            </div>
            <span class="flex-1 text-ink">Event</span>
            <Hotkey shortcut="e" theme="subtle" class="ml-6" />
          </Dropdown.Item>
          <Dropdown.Item
            aria-keyshortcuts="Q"
            closeOnSelect
            onSelect={props.onQuickCall}
            class="min-h-9 gap-2 px-2.5"
          >
            <div class="size-4 shrink-0 flex items-center rounded-sm text-ink-muted [&_svg]:size-4">
              <LightningIcon />
            </div>
            <span class="flex-1 text-ink">Quick Call</span>
            <Hotkey shortcut="q" theme="subtle" class="ml-6" />
          </Dropdown.Item>
          <Dropdown.Item
            aria-keyshortcuts="S"
            closeOnSelect
            onSelect={props.onScheduledCall}
            class="min-h-9 gap-2 px-2.5"
          >
            <div class="size-4 shrink-0 flex items-center rounded-sm text-ink-muted [&_svg]:size-4">
              <VideoIcon />
            </div>
            <span class="flex-1 text-ink">Scheduled Call</span>
            <Hotkey shortcut="s" theme="subtle" class="ml-6" />
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
