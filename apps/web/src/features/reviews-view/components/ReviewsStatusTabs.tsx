import { Tabs } from '@ui';
import type { ReviewsStatusTabId } from '../reviews-types';

const STATUS_TABS: { value: ReviewsStatusTabId; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
];

export function ReviewsStatusTabs(props: {
  value: ReviewsStatusTabId | undefined;
  onChange: (value: ReviewsStatusTabId) => void;
}) {
  const onChange = (value: string) => {
    if (value === 'open' || value === 'closed') {
      props.onChange(value);
    }
  };

  return (
    <Tabs
      aria-label="Pull request status"
      list={STATUS_TABS}
      value={props.value ?? ''}
      onChange={onChange}
    />
  );
}
