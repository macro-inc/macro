import EmptyStateNoFilterMatchGraphic from '@design/empty-state-no-filter-match.svg';
import EmptyStateNoSearchMatchGraphic from '@design/empty-state-no-search-match.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import type { GithubLinkStatus } from '@queries/auth/github-link';
import { EmptyStatePanel } from '@ui';
import { Match, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type ReviewsScope,
  scopeMatchesViewerGithubId,
} from '../reviews-types';

const IDENTITY_SUBJECTS: Record<ReviewsScope, string> = {
  all: 'pull requests',
  authored: 'pull requests you authored',
  assigned: 'pull requests assigned to you',
  involving: 'pull requests involving you',
  review_requests: 'pull requests awaiting your review',
};

export function ReviewsEmptyState(props: {
  scope: ReviewsScope;
  search: string;
  hasFilters: boolean;
  hasAuthorIdentity: boolean;
  githubAccountStatus?: GithubLinkStatus | 'error';
  onClearSearch: () => void;
  onClearFilters: () => void;
}) {
  const identityCopy = () => {
    const subject = IDENTITY_SUBJECTS[props.scope];
    return match(props.githubAccountStatus)
      .with('linked', () => ({
        title: 'GitHub account details unavailable',
        description: `We could not identify your linked account to find ${subject}. Try again later.`,
      }))
      .with('reauthentication_required', () => ({
        title: 'Reconnect your GitHub account',
        description: `Your GitHub link has expired. Reconnect to see ${subject}.`,
      }))
      .with('error', () => ({
        title: 'Could not check your GitHub account',
        description: `Try again later to see ${subject}.`,
      }))
      .otherwise(() => ({
        title: 'Connect your GitHub account',
        description: `Link GitHub to see ${subject}.`,
      }));
  };

  return (
    <Switch>
      <Match
        when={
          scopeMatchesViewerGithubId(props.scope) && !props.hasAuthorIdentity
        }
      >
        <EmptyStatePanel
          centered
          graphic={GitPullRequestIcon}
          title={identityCopy().title}
          description={identityCopy().description}
        />
      </Match>
      <Match
        when={
          props.scope === 'involving' &&
          props.githubAccountStatus &&
          props.githubAccountStatus !== 'linked'
        }
      >
        <EmptyStatePanel
          centered
          graphic={GitPullRequestIcon}
          title={identityCopy().title}
          description={identityCopy().description}
        />
      </Match>
      <Match when={props.search.trim()}>
        <EmptyStatePanel
          centered
          graphic={EmptyStateNoSearchMatchGraphic}
          title={`No results for "${props.search.trim()}"`}
          description="Try another pull request title, repository, number, or author."
          primaryAction={{
            label: 'Clear search',
            onClick: props.onClearSearch,
          }}
        />
      </Match>
      <Match when={props.hasFilters}>
        <EmptyStatePanel
          centered
          graphic={EmptyStateNoFilterMatchGraphic}
          title="No pull requests match these filters"
          description="Try other filters, or clear them."
          primaryAction={{
            label: 'Clear filters',
            onClick: props.onClearFilters,
          }}
        />
      </Match>
      <Match when={props.scope === 'involving'}>
        <EmptyStatePanel
          centered
          graphic={GitPullRequestIcon}
          title="No pull requests involving you"
          description="Pull requests you authored, were assigned or asked to review, or participated in will appear here."
        />
      </Match>
      <Match when={props.scope === 'authored'}>
        <EmptyStatePanel
          centered
          graphic={GitPullRequestIcon}
          title="No pull requests authored by you"
          description="Pull requests you authored and can access in Macro will appear here."
        />
      </Match>
      <Match when={props.scope === 'assigned'}>
        <EmptyStatePanel
          centered
          graphic={GitPullRequestIcon}
          title="No pull requests assigned to you"
          description="Pull requests assigned to you and accessible in Macro will appear here."
        />
      </Match>
      <Match when={props.scope === 'review_requests'}>
        <EmptyStatePanel
          centered
          graphic={GitPullRequestIcon}
          title="No review requests"
          description="Pull requests waiting on your review will appear here."
        />
      </Match>
      <Match when={true}>
        <EmptyStatePanel
          centered
          graphic={GitPullRequestIcon}
          title="No pull requests yet"
          description="GitHub pull requests accessible in your workspace will appear here."
        />
      </Match>
    </Switch>
  );
}
