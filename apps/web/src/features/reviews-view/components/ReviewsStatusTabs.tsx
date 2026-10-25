import { isTouchDevice } from '@core/mobile/isTouchDevice';
import GitMergeIcon from '@phosphor/git-merge.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import StackIcon from '@phosphor/stack.svg';
import { Tabs } from '@ui';
import type { ReviewsStatusTabId } from '../reviews-types';

/** Open, Closed (closed and merged), or All pull requests. */
export function ReviewsStatusTabs(props: {
  value: ReviewsStatusTabId | undefined;
  onChange: (value: ReviewsStatusTabId) => void;
  class?: string;
}) {
  return (
    <Tabs
      aria-label="Pull request status"
      touch="inset"
      fullWidth={isTouchDevice()}
      class={props.class}
      options={[
        { value: 'open', label: 'Open', icon: GitPullRequestIcon },
        { value: 'closed', label: 'Closed', icon: GitMergeIcon },
        { value: 'all', label: 'All', icon: StackIcon },
      ]}
      value={props.value}
      onChange={props.onChange}
    />
  );
}
