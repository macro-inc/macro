import CaretDownIcon from '@phosphor/caret-down.svg';
import CopyIcon from '@phosphor/copy.svg';
import PauseIcon from '@phosphor/pause.svg';
import PlayIcon from '@phosphor/play.svg';
import { Button, ButtonGroup, Dropdown } from '@ui';
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
      <ButtonGroup variant="outline" size="sm" depth={2} label="Run routine">
        <Button
          variant="ghost"
          disabled={props.runDisabled}
          onClick={props.onRun}
        >
          <PlayIcon class="size-3" />
          Run now
        </Button>
        <ButtonGroup.Divider />
        <Dropdown.Trigger
          variant="ghost"
          size="icon-sm"
          aria-label="Run options"
        >
          <CaretDownIcon class="size-3.5" />
        </Dropdown.Trigger>
      </ButtonGroup>
      <Dropdown.Content portalScope="local">
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
      </Dropdown.Content>
    </Dropdown>
  );
}
