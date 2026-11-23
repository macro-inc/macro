import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { ToolPermissionState } from '@service-agent-harness/generated/schemas';
import { Tabs } from '@ui';
import { stateHint, stateLabel } from './labels';

const STATES: readonly ToolPermissionState[] = ['always', 'ask', 'never'];

const STRICTNESS: Record<ToolPermissionState, number> = {
  always: 0,
  ask: 1,
  never: 2,
};

/**
 * Allow · Ask · Never for an action's default, an entity's exception, or a
 * tool, with the saved state highlighted (none while a new exception has no
 * state yet). The full state name is each option's description and tooltip. Options looser than `floor` (a
 * limit for this session) are disabled, with `floorHint` saying why.
 */
export function PermissionStateControl(props: {
  /** The control's accessible name, e.g. "Email: Send". */
  label: string;
  value: ToolPermissionState | undefined;
  floor?: ToolPermissionState;
  floorHint?: string;
  disabled?: boolean;
  onChange: (state: ToolPermissionState) => void;
}) {
  const belowFloor = (state: ToolPermissionState) =>
    props.floor !== undefined && STRICTNESS[state] < STRICTNESS[props.floor];

  const options = () =>
    STATES.map((state) => ({
      value: state,
      label: stateLabel(state),
      tooltip: belowFloor(state) ? props.floorHint : stateHint(state),
      disabled: belowFloor(state),
    }));

  return (
    <Tabs
      aria-label={props.label}
      options={options()}
      value={props.value}
      disabled={props.disabled}
      size={isTouchDevice() ? 'md' : 'sm'}
      touch="segmented"
      fullWidth={isTouchDevice()}
      onChange={(state) => {
        if (state !== props.value) props.onChange(state);
      }}
    />
  );
}
