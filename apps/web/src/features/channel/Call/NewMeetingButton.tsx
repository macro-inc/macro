import { ManageMeetingsDialog } from '@app/features/meetings/manage-meetings-dialog';
import CaretDownIcon from '@phosphor/caret-down.svg';
import PhoneIcon from '@phosphor/phone.svg';
import UsersIcon from '@phosphor/users.svg';
import VideoCameraIcon from '@phosphor/video-camera.svg';
import { Button, Dropdown } from '@ui';
import { createSignal, Show } from 'solid-js';
import { useQuickCallsFlag } from '../../meetings/use-quick-calls-flag';

type NewMeetingActions = {
  /** Opens the recipient picker for a channel or direct-message call. */
  onChannelCall: () => void;
  /** Opens instant call setup; only offered when quick calls are enabled. */
  onInstantCall: () => void;
};

export function NewMeetingButton(props: NewMeetingActions) {
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
      <NewMeetingMenu
        onChannelCall={props.onChannelCall}
        onInstantCall={props.onInstantCall}
      />
    </Show>
  );
}

function NewMeetingMenu(props: NewMeetingActions) {
  const [managing, setManaging] = createSignal(false);
  return (
    <>
      <Dropdown placement="bottom-end" modal={false}>
        <Dropdown.Trigger
          variant="accent"
          size="sm"
          class="gap-1.5 px-2"
          label="New call"
        >
          <VideoCameraIcon class="size-3.5" />
          <span>New call</span>
          <CaretDownIcon class="size-3" />
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-60" blockingBackdrop>
          <Dropdown.Group>
            <Dropdown.Item closeOnSelect onSelect={props.onInstantCall}>
              <PhoneIcon class="size-4 shrink-0" />
              <span>Start an instant call</span>
            </Dropdown.Item>
            <Dropdown.Item closeOnSelect onSelect={props.onChannelCall}>
              <UsersIcon class="size-4 shrink-0" />
              <span>Call a channel or contact</span>
            </Dropdown.Item>
            <Dropdown.Item closeOnSelect onSelect={() => setManaging(true)}>
              <VideoCameraIcon class="size-4 shrink-0" />
              <span>Manage call links</span>
            </Dropdown.Item>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
      <Show when={managing()}>
        <ManageMeetingsDialog onClose={() => setManaging(false)} />
      </Show>
    </>
  );
}
