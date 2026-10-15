import { SidebarCreateAction } from '@app/components/view-shell/SidebarCreateAction';
import { ManageMeetingsDialog } from '@app/features/meetings/manage-meetings-dialog';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import VideoCameraIcon from '@icon/system/regular/video-camera.svg';
import { Dropdown } from '@ui';
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
        <SidebarCreateAction
          aria-label="New call"
          onClick={props.onChannelCall}
        >
          New
        </SidebarCreateAction>
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
      <Dropdown placement="bottom-start" modal={false}>
        <Dropdown.Trigger as={SidebarCreateAction} label="New call">
          <span>New</span>
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
