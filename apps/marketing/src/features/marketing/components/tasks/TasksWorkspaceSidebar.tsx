import Caret from '@phosphor/caret-down.svg';
import CheckSquare from '@phosphor/check-square.svg';
import List from '@phosphor/list-checks.svg';
import Note from '@phosphor/note-pencil.svg';
import Plus from '@phosphor/plus.svg';
import Sidebar from '@phosphor/sidebar-simple.svg';
import Stack from '@phosphor/stack.svg';
import { createSignal, For, Show } from 'solid-js';
import { ViewSidebar } from '../DemoViewSidebar';
import type { TasksWorkspace } from './createTasksWorkspace';

/** TasksSidebar / ProjectsSidebar: real navigation and the native project section. */
export function TasksWorkspaceSidebar(props: {
  state: TasksWorkspace;
  collapse: () => void;
  onNavigate: () => void;
}) {
  const c = props.state;
  const [projectsOpen, setProjectsOpen] = createSignal(true);
  const [tagsOpen, setTagsOpen] = createSignal(true);
  const open = (action: () => void) => {
    action();
    props.onNavigate();
  };
  return (
    <ViewSidebar.Root aria-label="Tasks navigation">
      <ViewSidebar.Header>
        <div class="flex items-center gap-1">
          <ViewSidebar.Control
            label="Collapse sidebar"
            onClick={props.collapse}
          >
            <Sidebar />
          </ViewSidebar.Control>
          <ViewSidebar.Title>Tasks</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>
      <ViewSidebar.Primary>
        <ViewSidebar.Action
          onClick={() => c.setComposer(c.projectList() ? 'project' : 'task')}
        >
          <ViewSidebar.Icon>
            <Plus />
          </ViewSidebar.Icon>
          {c.projectList() ? 'New project' : 'New task'}
        </ViewSidebar.Action>
      </ViewSidebar.Primary>
      <ViewSidebar.Content>
        <ViewSidebar.Nav aria-label="Task views">
          <For
            each={[
              { id: 'mine' as const, label: 'My Tasks', icon: CheckSquare },
              { id: 'all' as const, label: 'All Tasks', icon: List },
              { id: 'created' as const, label: 'Created by me', icon: Note },
              { id: 'projects' as const, label: 'Projects', icon: Stack },
            ]}
          >
            {(item) => (
              <ViewSidebar.Item
                active={c.tab() === item.id && !c.projectId()}
                onClick={() => open(() => c.navigate(item.id))}
              >
                <ViewSidebar.Icon>
                  <item.icon />
                </ViewSidebar.Icon>
                {item.label}
              </ViewSidebar.Item>
            )}
          </For>
        </ViewSidebar.Nav>
        <section>
          <div class="tasks-native-sidebar-heading">
            <button
              type="button"
              aria-expanded={projectsOpen()}
              onClick={() => setProjectsOpen(!projectsOpen())}
            >
              My projects
              <Caret
                class="size-3"
                style={{ transform: projectsOpen() ? '' : 'rotate(-90deg)' }}
              />
            </button>
            <ViewSidebar.Control
              label="New project"
              onClick={() => c.setComposer('project')}
            >
              <Plus />
            </ViewSidebar.Control>
          </div>
          <Show when={projectsOpen()}>
            <ViewSidebar.Nav aria-label="My projects">
              <For each={c.projects}>
                {(project) => (
                  <ViewSidebar.Item
                    title={project.title}
                    active={c.projectId() === project.id}
                    onClick={() => open(() => c.openProject(project.id))}
                  >
                    <ViewSidebar.Icon>
                      <Stack />
                    </ViewSidebar.Icon>
                    <span class="truncate">{project.title}</span>
                  </ViewSidebar.Item>
                )}
              </For>
            </ViewSidebar.Nav>
          </Show>
        </section>
        <section>
          <div class="tasks-native-sidebar-heading">
            <button
              type="button"
              aria-expanded={tagsOpen()}
              onClick={() => setTagsOpen(!tagsOpen())}
            >
              Tags
              <Caret
                class="size-3"
                style={{ transform: tagsOpen() ? '' : 'rotate(-90deg)' }}
              />
            </button>
          </div>
          <Show when={tagsOpen()}>
            <ViewSidebar.Nav aria-label="Task tags">
              <For each={['Team', 'Customers', 'Website']}>
                {(tag) => (
                  <ViewSidebar.Item
                    active={c.filters.tag === tag}
                    onClick={() =>
                      open(() => {
                        if (c.projectList() || c.projectId()) c.navigate('all');
                        c.setFilters('tag', c.filters.tag === tag ? '' : tag);
                      })
                    }
                  >
                    <span
                      class="sample-tag-dot"
                      data-color={tag === 'Customers' ? 2 : 0}
                    />
                    {tag}
                  </ViewSidebar.Item>
                )}
              </For>
            </ViewSidebar.Nav>
          </Show>
        </section>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
