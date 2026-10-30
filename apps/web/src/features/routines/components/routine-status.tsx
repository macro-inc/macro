import { SidePanel } from '@components/app/side-panel';
import CheckIcon from '@icon/system/regular/check.svg';
import { cn, Dropdown } from '@ui';

/** The routine's status in its details panel: on or off, as a pill menu. */
export function RoutineStatus(props: {
  enabled: boolean;
  disabled?: boolean;
  /** Why it can't change right now, on hover. */
  hint?: string;
  onChange(enabled: boolean): void;
}) {
  return (
    <Dropdown modal={false} placement="bottom-start">
      <Dropdown.Trigger
        as="button"
        aria-label={`Status: ${props.enabled ? 'On' : 'Off'}`}
        title={props.hint}
        disabled={props.disabled}
        class={cn(
          SidePanel.pillClass,
          'text-ink outline-none hover:bg-hover focus-visible:bg-hover disabled:opacity-50'
        )}
      >
        <span
          aria-hidden="true"
          class={cn(
            'size-1.5 shrink-0 rounded-full',
            props.enabled ? 'bg-success' : 'bg-ink-extra-muted'
          )}
        />
        {props.enabled ? 'On' : 'Off'}
      </Dropdown.Trigger>
      <Dropdown.Content
        portalScope="local"
        class="w-72 max-w-[calc(100vw-1rem)]"
      >
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={props.enabled ? 'on' : 'off'}
            onChange={(value) => props.onChange(value === 'on')}
          >
            <Dropdown.RadioItem value="on">
              <span class="flex min-w-0 flex-1 flex-col">
                <Dropdown.ItemLabel>On</Dropdown.ItemLabel>
                <Dropdown.ItemDescription class="text-xs text-ink-muted">
                  Runs whenever its triggers fire.
                </Dropdown.ItemDescription>
              </span>
              <Dropdown.ItemIndicator>
                <CheckIcon class="size-3.5 text-accent" />
              </Dropdown.ItemIndicator>
            </Dropdown.RadioItem>
            <Dropdown.RadioItem value="off">
              <span class="flex min-w-0 flex-1 flex-col">
                <Dropdown.ItemLabel>Off</Dropdown.ItemLabel>
                <Dropdown.ItemDescription class="text-xs text-ink-muted">
                  Paused. Nothing runs until you turn it back on.
                </Dropdown.ItemDescription>
              </span>
              <Dropdown.ItemIndicator>
                <CheckIcon class="size-3.5 text-accent" />
              </Dropdown.ItemIndicator>
            </Dropdown.RadioItem>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
