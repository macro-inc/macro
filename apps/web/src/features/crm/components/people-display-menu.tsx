import type { PeopleVisibility } from '../context/workspace-context';
import { RecordVisibilityFilter } from './record-visibility-filter';

export function PeopleDisplayMenu(props: {
  visibility: PeopleVisibility;
  /** Shows the visibility filter as its icon alone. */
  iconOnly?: boolean;
}) {
  return (
    <RecordVisibilityFilter
      size="md"
      archived={props.visibility.showRemoved()}
      onChange={props.visibility.setShowRemoved}
      disabled={!props.visibility.canShowRemoved()}
      iconOnly={props.iconOnly}
    />
  );
}
