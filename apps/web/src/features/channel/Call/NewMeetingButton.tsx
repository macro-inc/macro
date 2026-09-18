import { ManageMeetingsDialog } from '@app/features/meetings/manage-meetings-dialog';
import CaretDownIcon from '@phosphor/caret-down.svg';
import PlusIcon from '@phosphor/plus.svg';
import UsersIcon from '@phosphor/users.svg';
import VideoCameraIcon from '@phosphor/video-camera.svg';
import { Dropdown } from '@ui';
import { createSignal, Show } from 'solid-js';

/** Creation entry shared by the calendar and the existing calls list. */
export function NewMeetingButton(props: {
  compact?: boolean;
  variant?: 'call' | 'create';
  onChannelCall?: () => void;
}) {
  const [managing, setManaging] = createSignal(false);
  return (
    <>
      <Dropdown placement="bottom-end" modal={false}>
        <Dropdown.Trigger
          variant={props.compact ? 'ghost' : 'accent'}
          size="sm"
          class="gap-1.5 rounded-lg px-2"
          label={props.variant === 'create' ? 'Create' : 'New call'}
        >
          <Show
            when={props.variant === 'create'}
            fallback={<VideoCameraIcon class="size-3.5" />}
          >
            <PlusIcon class="size-3.5" />
          </Show>
          <span>{props.variant === 'create' ? 'Create' : 'New call'}</span>
          <CaretDownIcon class="size-3" />
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-60" blockingBackdrop>
          <Show when={props.onChannelCall}>
            {(onChannelCall) => (
              <Dropdown.Item closeOnSelect onSelect={onChannelCall()}>
                <UsersIcon class="size-4 shrink-0" />
                <span>Call a channel or contact</span>
              </Dropdown.Item>
            )}
          </Show>
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
