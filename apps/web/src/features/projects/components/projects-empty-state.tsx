import { PROJECTS_DOCS_URL } from '@app/constants/docs-links';
import EmptyStateNoFilterMatchGraphic from '@design/empty-state-no-filter-match.svg';
import EmptyStateTasksGraphic from '@design/empty-state-tasks.svg';
import BookOpenIcon from '@icon/system/regular/book-open.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { EmptyStatePanel, FilteredHiddenBanner } from '@ui';
import { Show } from 'solid-js';

export function ProjectsEmptyState(props: {
  filtered: boolean;
  onCreate(): void;
  onClearFilters?: () => void;
}) {
  return (
    <Show
      when={props.filtered}
      fallback={
        <EmptyStatePanel
          centered
          graphic={EmptyStateTasksGraphic}
          title="No projects yet"
          description="Group related tasks into a project to track them together."
          primaryAction={{
            label: 'New project',
            icon: PlusIcon,
            onClick: props.onCreate,
          }}
          documentationUrl={PROJECTS_DOCS_URL}
          documentationIcon={BookOpenIcon}
        />
      }
    >
      <EmptyStatePanel
        centered
        graphic={EmptyStateNoFilterMatchGraphic}
        title="No projects in this view"
        description="Try adjusting or clearing your filters to see more results."
      >
        <Show when={props.onClearFilters}>
          {(clear) => (
            <FilteredHiddenBanner
              hasHiddenItems={false}
              onClearFilters={clear()}
            />
          )}
        </Show>
      </EmptyStatePanel>
    </Show>
  );
}
