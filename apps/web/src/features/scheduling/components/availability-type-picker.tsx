import { Tabs } from '@ui';
import type { AvailabilityChange } from '../core/availability';

export function AvailabilityTypePicker(props: {
  mode: AvailabilityChange['mode'];
  label?: string;
  disabled?: boolean;
  onChange: (mode: AvailabilityChange['mode']) => void;
}) {
  return (
    <Tabs
      touch="pills"
      aria-label={props.label ?? 'Availability type'}
      size="sm"
      disabled={props.disabled}
      options={[
        { value: 'available', label: 'Available' },
        { value: 'unavailable', label: 'Unavailable' },
      ]}
      value={props.mode}
      onChange={props.onChange}
    />
  );
}
