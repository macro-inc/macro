import { DateGroupHeading } from '@app/features/next-soup/soup-view/date-group-heading';
import type {
  SoupGroupHeaderRow,
  SoupSectionHeaderRow,
} from '@app/features/soup';

/** A date group, or a search section (Files, Emails), among the email rows. */
export function EmailListHeading(props: {
  row: SoupGroupHeaderRow | SoupSectionHeaderRow;
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
