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
      <ButtonGroup
        variant="ghost"
        size="sm"
        depth={2}
        class="rounded-full border border-edge-muted"
      >
        <Button
          disabled={props.runDisabled}
          onClick={props.onRun}
          class="bg-transparent hover:bg-ink/[0.04]"
        >
          <PlayIcon class="size-3" />
          Run now
        </Button>
        <ButtonGroup.Divider />
        <Dropdown.Trigger
          variant="ghost"
          aria-label="Run options"
          class="bg-transparent p-1 hover:bg-ink/[0.04]"
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
