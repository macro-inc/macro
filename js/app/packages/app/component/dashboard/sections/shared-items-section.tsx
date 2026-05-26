import { useSplitLayout } from '@app/component/split-layout/layout';
import { formatRelativeDate } from '@core/util/time';
import UsersIcon from '@phosphor/users.svg';
import FolderIcon from '@phosphor/folder.svg';
import { useProjectsQuery } from '@queries/storage/projects';
import { useUserContext } from '@core/context/user';
import { createMemo, For, Show } from 'solid-js';

import {
  DashboardEmptyState,
  DashboardItemRow,
  DashboardSection,
} from '../dashboard-section';
import { DashboardSectionLoading } from '../dashboard-section-loading';

const SHARED_ITEMS_LIMIT = 5;

interface SharedItemsSectionProps {
  class?: string;
}

export function SharedItemsSection(props: SharedItemsSectionProps) {
  return (
    <DashboardSection
      title="Shared with Me"
      icon={<UsersIcon />}
      class={props.class}
      fallback={<DashboardSectionLoading rows={3} />}
    >
      <SharedItemsContent />
    </DashboardSection>
  );
}

function SharedItemsContent() {
  const user = useUserContext();
  const projectsQuery = useProjectsQuery();
  const { openWithSplit } = useSplitLayout();

  const sharedProjects = createMemo(() => {
    const projects = projectsQuery.data ?? [];
    const userId = user.userId();
    return projects
      .filter((project) => project.userId !== userId)
      .sort((a, b) => {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, SHARED_ITEMS_LIMIT);
  });

  const handleProjectClick = (projectId: string) => {
    openWithSplit({
      type: 'project',
      id: projectId,
    });
  };

  return (
    <Show
      when={sharedProjects().length > 0}
      fallback={
        <DashboardEmptyState
          icon={<UsersIcon />}
          title="No shared items"
          description="Items shared with you will appear here"
        />
      }
    >
      <div class="flex flex-col -my-1">
        <For each={sharedProjects()}>
          {(project) => (
            <DashboardItemRow
              icon={<FolderIcon />}
              iconBg="bg-project/10 text-project"
              title={project.name || 'Untitled Project'}
              subtitle={
                project.updatedAt
                  ? formatRelativeDate(project.updatedAt)
                  : undefined
              }
              onClick={() => handleProjectClick(project.id)}
            />
          )}
        </For>
      </div>
    </Show>
  );
}
