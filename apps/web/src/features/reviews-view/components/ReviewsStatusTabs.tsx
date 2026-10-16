import { TabsInset } from '@core/component/TabsInset';
import GitMergeIcon from '@phosphor/git-merge.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import StackIcon from '@phosphor/stack.svg';
import type { Component } from 'solid-js';
import { match } from 'ts-pattern';
import type { ReviewsStatusTabId } from '../reviews-types';

const STATUS_TABS: {
  value: ReviewsStatusTabId;
  label: string;
  icon: Component<{ class?: string }>;
}[] = [
  { value: 'open', label: 'Open', icon: GitPullRequestIcon },
  { value: 'closed', label: 'Closed', icon: GitMergeIcon },
  { value: 'all', label: 'All', icon: StackIcon },
];

/** Open, Closed (closed and merged), or All pull requests, as a toggle. */
export function ReviewsStatusTabs(props: {
  value: ReviewsStatusTabId | undefined;
  onChange: (value: ReviewsStatusTabId) => void;
  class?: string;
}) {
  return (
    <TabsInset
      aria-label="Pull request status"
      fullWidth
      class={props.class ?? 'h-auto'}
      labelClass="gap-1.5 py-1.5"
      list={STATUS_TABS.map((tab) => ({
        value: tab.value,
        label: (
          <>
            <tab.icon class="size-3.5 shrink-0" aria-hidden="true" />
            {tab.label}
          </>
        ),
      }))}
      value={props.value ?? ''}
      onChange={(value) =>
        match(value)
          .with('open', 'closed', 'all', (status) => props.onChange(status))
          .otherwise(() => undefined)
      }
    />
  );
}
