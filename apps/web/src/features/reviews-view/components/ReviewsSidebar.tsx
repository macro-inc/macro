import { useViewTabHotkeys, ViewSidebar } from '@app/components/view-shell';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import UserIcon from '@phosphor/user.svg';
import type { ReviewsScope } from '../reviews-types';

export function ReviewsSidebar(props: {
  scope: ReviewsScope;
  onScopeChange: (scope: ReviewsScope) => void;
}) {
  const panel = useSplitPanelOrThrow();
  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => ['all', 'authored'] as ReviewsScope[],
    activeId: () => props.scope,
    setActiveId: props.onScopeChange,
  });

  return (
    <ViewSidebar.Root aria-label="Reviews navigation">
      <ViewSidebar.Header>
        <ViewSidebar.Title>Reviews</ViewSidebar.Title>
      </ViewSidebar.Header>
      <ViewSidebar.Content>
        <ViewSidebar.Nav aria-label="Pull request views">
          <ViewSidebar.Item
            active={props.scope === 'all'}
            onClick={() => props.onScopeChange('all')}
          >
            <ViewSidebar.Icon>
              <GitPullRequestIcon class="size-4" />
            </ViewSidebar.Icon>
            <span class="truncate">All PRs</span>
          </ViewSidebar.Item>
          <ViewSidebar.Item
            active={props.scope === 'authored'}
            onClick={() => props.onScopeChange('authored')}
          >
            <ViewSidebar.Icon>
              <UserIcon class="size-4" />
            </ViewSidebar.Icon>
            <span class="truncate">Authored by me</span>
          </ViewSidebar.Item>
        </ViewSidebar.Nav>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
