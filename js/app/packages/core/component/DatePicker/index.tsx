import { floatWithElement } from '@core/component/LexicalMarkdown/directive/floatWithElement';
import clickOutside from '@core/directive/clickOutside';
import { DatePickerUI } from './DatePickerUI';

false && floatWithElement;
false && clickOutside;

export type DatePickerProps = {
  value: Date;
  onChange: (date: Date) => void;
  onClose: () => void;
  anchorRef: HTMLElement;
};

export function DatePicker(props: DatePickerProps) {
  return (
    <div
      class="absolute z-action-menu bg-dialog ring-1 ring-edge-muted font-mono text-sm"
      use:floatWithElement={{ element: () => props.anchorRef }}
      use:clickOutside={props.onClose}
    >
      <DatePickerUI value={props.value} onChange={props.onChange} />
    </div>
  );
}
