import { useViewShell, ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import ArchiveIcon from '@icon/system/regular/archive.svg';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import RoutineIcon from '@icon/system/regular/clock-clockwise.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import AgentIcon from '@icon/system/regular/robot.svg';
import { For, Show } from 'solid-js';
import type { AgentsPage } from '../../core/pages';

export type PhoneRoutineItem = { id: string; name: string; schedule: string };

export function PhoneAgentsNavigation(props: {
  activePage: AgentsPage;
  activeRoutineId?: string;
  archivedCount?: number;
  routines: readonly PhoneRoutineItem[];
  onOpenPage: (page: AgentsPage) => void;
  onCreateAgent: () => void;
  onCreateRoutine: () => void;
  onOpenRoutine: (id: string) => void;
}) {
  const shell = useViewShell();
  const createAgent = () => {
    shell.aside.collapse();
    props.onCreateAgent();
  };
  const createRoutine = () => {
    shell.aside.collapse();
    props.onCreateRoutine();
  };
  return (
    <ViewSidebar.Root aria-label={t('agentWork.navigation')}>
      <ViewSidebar.Header>
        <ViewSidebar.Title caret={false}>
          {t('agentWork.agents')}
        </ViewSidebar.Title>
      </ViewSidebar.Header>
      <ViewSidebar.Content>
        <ViewSidebar.Section
          id="agents-pages"
          label={t('agentWork.navigation')}
          headerless
        >
          <ViewSidebar.Nav aria-label={t('agentWork.navigation')}>
            <ViewSidebar.Item
              active={props.activePage === 'new'}
              onClick={() => props.onOpenPage('new')}
            >
              <ViewSidebar.Icon>
                <ChatIcon />
              </ViewSidebar.Icon>
              <span class="min-w-0 flex-1 truncate">
                {t('agentWork.conversations')}
              </span>
            </ViewSidebar.Item>
            <ViewSidebar.Item
              active={props.activePage === 'archived'}
              onClick={() => props.onOpenPage('archived')}
            >
              <ViewSidebar.Icon>
                <ArchiveIcon />
              </ViewSidebar.Icon>
              <span class="min-w-0 flex-1 truncate">
                {t('viewMenus.archived')}
              </span>
              <Show when={props.archivedCount !== undefined}>
                <span class="ml-auto text-ink-extra-muted tabular-nums">
                  {props.archivedCount}
                </span>
              </Show>
            </ViewSidebar.Item>
            <div class="relative">
              <ViewSidebar.Item
                active={props.activePage === 'agents'}
                onClick={() => props.onOpenPage('agents')}
                class="pr-[calc(var(--sidebar-action-inset)+var(--sidebar-control-size))]"
              >
                <ViewSidebar.Icon>
                  <AgentIcon />
                </ViewSidebar.Icon>
                <span class="min-w-0 flex-1 truncate">
                  {t('agentWork.agents')}
                </span>
              </ViewSidebar.Item>
              <span class="absolute right-(--sidebar-action-inset) top-1/2 -translate-y-1/2">
                <ViewSidebar.Control
                  aria-label={t('agentWork.newAgent')}
                  onClick={createAgent}
                >
                  <PlusIcon class="size-5" />
                </ViewSidebar.Control>
              </span>
            </div>
          </ViewSidebar.Nav>
        </ViewSidebar.Section>
        <ViewSidebar.Section id="routines" label={t('agentWork.routines')}>
          <ViewSidebar.SectionHeader>
            <ViewSidebar.Toolbar>
              <button
                type="button"
                class="min-w-0 flex-1 text-left text-xs font-medium text-ink-muted"
                onClick={() => {
                  shell.aside.collapse();
                  props.onOpenPage('routines');
                }}
              >
                {t('agentWork.routines')}
              </button>
              <ViewSidebar.Control
                aria-label={t('agentWork.createRoutine')}
                onClick={createRoutine}
              >
                <PlusIcon class="size-4" />
              </ViewSidebar.Control>
            </ViewSidebar.Toolbar>
          </ViewSidebar.SectionHeader>
          <ViewSidebar.Nav aria-label={t('agentWork.routines')}>
            <For each={props.routines}>
              {(routine) => (
                <ViewSidebar.Item
                  active={
                    props.activePage === 'routines' &&
                    props.activeRoutineId === routine.id
                  }
                  onClick={() => props.onOpenRoutine(routine.id)}
                >
                  <ViewSidebar.Icon>
                    <RoutineIcon />
                  </ViewSidebar.Icon>
                  <span class="min-w-0 flex-1 truncate">{routine.name}</span>
                  <span class="max-w-[45%] truncate text-xs text-ink-extra-muted">
                    {routine.schedule}
                  </span>
                </ViewSidebar.Item>
              )}
            </For>
          </ViewSidebar.Nav>
        </ViewSidebar.Section>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
