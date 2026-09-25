import { ManageMeetingsDialog } from '@app/features/meetings/manage-meetings-dialog';
import CaretDownIcon from '@phosphor/caret-down.svg';
import UsersIcon from '@phosphor/users.svg';
import VideoCameraIcon from '@phosphor/video-camera.svg';
import { Button, Dropdown } from '@ui';
import { createSignal, Show } from 'solid-js';
import { useQuickCallsFlag } from '../../meetings/use-quick-calls-flag';

export function NewMeetingButton(props: { onChannelCall: () => void }) {
  const flag = useQuickCallsFlag();
  return (
    <Show
      when={!flag().loading && flag().enabled}
      fallback={
        <Button variant="accent" size="sm" onClick={props.onChannelCall}>
          <VideoCameraIcon class="size-3.5" />
          New call
        </Button>
      }
    >
      <NewMeetingMenu onChannelCall={props.onChannelCall} />
    </Show>
  );
}

function NewMeetingMenu(props: { onChannelCall: () => void }) {
  const [managing, setManaging] = createSignal(false);
  return (
    <>
      <Dropdown placement="bottom-end" modal={false}>
        <Dropdown.Trigger
          variant="accent"
          size="sm"
          class="gap-1.5 rounded-lg px-2"
          label="New call"
        >
          <VideoCameraIcon class="size-3.5" />
          <span>New call</span>
          <CaretDownIcon class="size-3" />
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-60" blockingBackdrop>
          <Dropdown.Item closeOnSelect onSelect={props.onChannelCall}>
            <UsersIcon class="size-4 shrink-0" />
            <span>Call a channel or contact</span>
          </Dropdown.Item>
          <Dropdown.Item closeOnSelect onSelect={() => setManaging(true)}>
            <VideoCameraIcon class="size-4 shrink-0" />
            <span>Manage call links</span>
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown>
      <Show when={managing()}>
        <ManageMeetingsDialog onClose={() => setManaging(false)} />
      </Show>
    </>
  );
}
