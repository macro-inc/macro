import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import PauseIcon from '@icon/system/regular/pause.svg';
import PlayIcon from '@icon/system/regular/play.svg';
import { ButtonGroup, Dropdown } from '@ui';
import { Show } from 'solid-js';

/** Routine actions share the task's compact agent-action control. */
export function RoutineRunButton(props: {
  enabled: boolean;
  runDisabled: boolean;
  activationDisabled: boolean;
  copyDisabled: boolean;
  onRun: () => void;
  onEnabled: (enabled: boolean) => void;
  onCopyPrompt: () => void;
}) {
  return (
    <Dropdown placement="bottom-end">
      <ButtonGroup
        finish="raised"
        variant="secondary"
        size="sm"
        aria-label="Run routine"
      >
        <ButtonGroup.Button
          variant="ghost"
          disabled={props.runDisabled}
          onClick={props.onRun}
        >
          <PlayIcon class="size-3" />
          Run now
        </ButtonGroup.Button>
        <ButtonGroup.Divider />
        <Dropdown.Trigger
          as={ButtonGroup.Button}
          variant="ghost"
          size="icon-sm"
          aria-label="Run options"
        >
          <CaretDownIcon class="size-3.5" />
        </Dropdown.Trigger>
      </ButtonGroup>
      <Dropdown.Content portalScope="local">
        <Dropdown.Group>
          <Dropdown.Item
            disabled={props.activationDisabled}
            onSelect={() => props.onEnabled(!props.enabled)}
          >
            <Show when={props.enabled} fallback={<PlayIcon class="size-4" />}>
              <PauseIcon class="size-4" />
            </Show>
            {props.enabled ? 'Disable routine' : 'Enable routine'}
          </Dropdown.Item>
          <Dropdown.Item
            disabled={props.copyDisabled}
            onSelect={props.onCopyPrompt}
          >
            <CopyIcon class="size-4" />
            Copy prompt
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
