import { DateGroupHeading } from '@app/features/next-soup/soup-view/date-group-heading';
import type { SoupGroupHeaderRow } from '@app/features/soup';

export function EmailDateGroupHeader(props: {
  row: SoupGroupHeaderRow;
  isFirst: boolean;
}) {
  return (
    <div id={props.row.id} role="row">
      <div role="gridcell">
        <DateGroupHeading label={props.row.label} isFirst={props.isFirst} />
      </div>
    </div>
  );
}
