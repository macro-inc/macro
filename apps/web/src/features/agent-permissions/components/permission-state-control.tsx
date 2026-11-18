import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { PermissionStateDto } from '@service-agent-harness/tool-permission-types';
import { Tabs } from '@ui';
import { stateHint, stateLabel } from './labels';

const STATES: readonly PermissionStateDto[] = ['always', 'ask', 'never'];

const STRICTNESS: Record<PermissionStateDto, number> = {
  always: 0,
  ask: 1,
  never: 2,
};

/**
 * Allow · Ask · Never for one group action or tool. The full state name is
 * each option's description and tooltip. Options looser than `floor` (a
 * limit for this session) are disabled, with `floorHint` saying why.
 */
export function PermissionStateControl(props: {
  /** The control's accessible name, e.g. "Email: Send". */
  label: string;
  value: PermissionStateDto;
  floor?: PermissionStateDto;
  floorHint?: string;
  disabled?: boolean;
  onChange: (state: PermissionStateDto) => void;
}) {
  const belowFloor = (state: PermissionStateDto) =>
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
