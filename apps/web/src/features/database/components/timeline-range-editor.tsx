import { TimeRangeEditor } from '@app/components/date-time-range/time-range-editor';
import { fireAndForget } from '@core/util/fireAndForget';
import { Dropdown } from '@ui/components/Dropdown';
import { createSignal } from 'solid-js';
import { type CellTimeRange, toCellTimeRange } from '../core/cell-date-range';
import type { DatabaseCellValue } from '../core/database-view';

/**
 * A record's time range edited beside its bar, as the grid's range cell
 * edits it. Each complete range saves as it is chosen.
 */
export function TimelineRangeEditor(props: {
  label: string;
  range: CellTimeRange | undefined;
  /** Where the editor opens: the bar's box when it was asked for. */
  anchor: DOMRect;
  onWrite: (value: DatabaseCellValue) => Promise<boolean>;
  /** Called once the editor has closed, to hand focus back. */
  onClose: () => void;
}) {
  const [open, setOpen] = createSignal(true);
  return (
    <Dropdown
      open={open()}
      onOpenChange={setOpen}
      getAnchorRect={() => props.anchor}
      placement="bottom-start"
    >
      <Dropdown.Content
        // The range fields open their date and time lists inside.
        class="portal-scope w-max max-w-[calc(100vw-1rem)] overflow-visible p-0 text-sm"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          props.onClose();
        }}
      >
        <TimeRangeEditor
          subject={props.label}
          range={props.range}
          onChange={(range) =>
            fireAndForget(
              props.onWrite(range ? toCellTimeRange(range) : null),
              'database'
            )
          }
          onClear={() => setOpen(false)}
        />
      </Dropdown.Content>
    </Dropdown>
  );
}
