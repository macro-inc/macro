import CalendarBlank from '@icon/system/regular/calendar-blank.svg';
import { AvailabilityFieldRow } from './availability-field-row';
import { TextInput } from './fields';

export function AvailabilityScheduleTitle(props: {
  name: string;
  disabled: boolean;
  onChange: (name: string) => void;
}) {
  return (
    <AvailabilityFieldRow icon={<CalendarBlank />} align="center">
      <TextInput
        aria-label="Schedule name"
        placeholder="Schedule name"
        class="h-auto min-w-0 rounded-md border-transparent bg-transparent px-0 py-0.5 text-2xl font-semibold shadow-none focus-visible:border-transparent"
        required
        maxLength={100}
        value={props.name}
        disabled={props.disabled}
        onInput={(event) => props.onChange(event.currentTarget.value)}
      />
    </AvailabilityFieldRow>
  );
}
