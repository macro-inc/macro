import {
  CollapsibleSection,
  useViewTabHotkeys,
  ViewSidebar,
} from '@app/components/view-shell';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { EntityIcon } from '@core/component/EntityIcon';
import NoteIcon from '@phosphor/note-pencil.svg';
import PlusIcon from '@phosphor/plus.svg';
import UsersIcon from '@phosphor/users-three.svg';
import { SidebarTagsSection } from '@property/tags/SidebarTagsSection';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { Button } from '@ui';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  PERSONAL_TASK_TABS,
  type TaskTabItem,
  TEAM_TASK_TABS,
} from '../constants';
import { useTasksView } from '../tasks-view-context';

function TaskIcon(props: { class?: string }) {
  return (
    <EntityIcon
      targetType="task"
      size="fill"
      theme="monochrome"
      class={props.class}
    />
  );
}

const TAB_ICONS = {
  'my-tasks': TaskIcon,
  'created-by-me': NoteIcon,
  'team-tasks': TaskIcon,
} as const;

function Tab(props: {
  item: TaskTabItem;
  onNavigate?: () => void;
  class?: string;
}) {
  const { state, setTab } = useTasksView();

  return (
    <ViewSidebar.Item
      active={state.tab === props.item.id}
      class={props.class}
      onClick={() => {
        setTab(props.item.id);
        props.onNavigate?.();
      }}
    >
      <Dynamic
        component={TAB_ICONS[props.item.id]}
        aria-hidden="true"
        class="size-4 shrink-0"
      />
      <span class="truncate">{props.item.label}</span>
    </ViewSidebar.Item>
  );
}

export function TasksNavigation(props: { onNavigate?: () => void }) {
  const { state, setFacets, isSidebarSectionOpen, setSidebarSectionOpen } =
    useTasksView();
  const team = useCurrentTeamQuery();
  const teamName = () => team.data?.team.name ?? 'Team';

  return (
    <div class="flex flex-col gap-3">
      <ViewSidebar.Nav aria-label="Personal task tabs">
        <For each={PERSONAL_TASK_TABS}>
          {(item) => <Tab item={item} onNavigate={props.onNavigate} />}
        </For>
      </ViewSidebar.Nav>

      <CollapsibleSection.Root
        open={isSidebarSectionOpen('team')}
        onOpenChange={(open) => setSidebarSectionOpen('team', open)}
      >
        <CollapsibleSection.Trigger>
          <UsersIcon aria-hidden="true" class="size-4 shrink-0" />
          <span class="truncate">{teamName()}</span>
          <CollapsibleSection.Indicator />
        </CollapsibleSection.Trigger>
        <CollapsibleSection.Content>
          <ViewSidebar.Nav aria-label={`${teamName()} task tabs`}>
            <For each={TEAM_TASK_TABS}>
              {(item) => (
                <Tab
                  item={item}
                  onNavigate={props.onNavigate}
                  class="pl-8 pr-3"
                />
              )}
            </For>
          </ViewSidebar.Nav>
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>

      {/* Tags narrow the current tab; switching tabs clears them like any facet. */}
      <SidebarTagsSection
        activeIds={state.facets.tags ?? []}
        onActiveIdsChange={(ids) => setFacets({ ...state.facets, tags: ids })}
        open={isSidebarSectionOpen('tags')}
        onOpenChange={(open) => setSidebarSectionOpen('tags', open)}
        onNavigate={props.onNavigate}
      />
    </div>
  );
}

export function TasksSidebar() {
  const layout = useSplitLayout();
  const panel = useSplitPanelOrThrow();
  const { state, setTab } = useTasksView();

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => [...PERSONAL_TASK_TABS, ...TEAM_TASK_TABS].map((tab) => tab.id),
    activeId: () => state.tab,
    setActiveId: setTab,
  });

  const createTask = () => {
    layout.popoverSplit({ type: 'component', id: 'task-compose' });
  };

  return (
    <ViewSidebar.Root
      aria-label="Tasks navigation"
      class="gap-3 border-r-0 pt-2"
    >
      <div class="flex items-center">
        <SplitPanel.ControlGroup>
          <SplitPanel.CloseButton />
          <SplitPanel.BackButton />
          <SplitPanel.ForwardButton />
        </SplitPanel.ControlGroup>
      </div>

      <ViewSidebar.Header class="h-8">
        <ViewSidebar.Title>Tasks</ViewSidebar.Title>
        <Button
          type="button"
          variant="cta"
          size="md"
          class="rounded-lg px-3"
          onClick={createTask}
        >
          <PlusIcon class="size-4 shrink-0" />
          New
        </Button>
      </ViewSidebar.Header>

      <ViewSidebar.Content>
        <TasksNavigation />
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
