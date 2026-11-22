import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import type { ToolPermissionState } from '@service-agent-harness/generated/schemas';
import { Dropdown, SingleSelectCheck } from '@ui';
import { For } from 'solid-js';
import { stateLabel } from './labels';

/** One choice in a state menu; `null` is "Use default". */
export type StateMenuOption = {
  state: ToolPermissionState | null;
  label: string;
};

/**
 * A pill showing a permission state that opens a menu of states: an action's
 * default (Allow ✓ · Ask · Deny) or an exception's (the states other than the
 * default, then "Use default (X)"). Without `value` it shows `placeholder`,
 * as a new exception does before its state is chosen.
 */
export function PermissionStateMenu(props: {
  /** The trigger's accessible name, e.g. "Read default permission". */
  label: string;
  value?: ToolPermissionState;
  placeholder?: string;
  options: StateMenuOption[];
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect: (state: ToolPermissionState | null) => void;
}) {
  const shown = () =>
    props.value === undefined ? props.placeholder : stateLabel(props.value);

  return (
    <Dropdown
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement="bottom-end"
    >
      <Dropdown.Trigger
        variant="secondary"
        size="md"
        class="w-44 shrink-0 justify-between @max-md:w-32"
        aria-label={props.label}
        disabled={props.disabled}
      >
        <span class="min-w-0 truncate text-ink-muted">{shown()}</span>
        <CaretDownIcon
          aria-hidden="true"
          class="size-3 shrink-0 text-ink-extra-muted"
        />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-44 max-w-[min(20rem,calc(100vw-2rem))]">
        <Dropdown.Group>
          <For each={props.options}>
            {(option) => (
              <Dropdown.Item onSelect={() => props.onSelect(option.state)}>
                <span class="min-w-0 flex-1 truncate">{option.label}</span>
                <SingleSelectCheck
                  active={option.state !== null && option.state === props.value}
                />
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

/** Allow, Ask, Deny: the default menu's options. */
export function defaultOptions(): StateMenuOption[] {
  const states: ToolPermissionState[] = ['always', 'ask', 'never'];
  return states.map((state) => ({ state, label: stateLabel(state) }));
}
