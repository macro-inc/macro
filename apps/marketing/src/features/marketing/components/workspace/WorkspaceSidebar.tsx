import Calendar from '@phosphor/calendar-blank.svg';
import Caret from '@phosphor/caret-right.svg';
import CheckSquare from '@phosphor/check-square.svg';
import Clock from '@phosphor/clock.svg';
import Repeat from '@phosphor/clock-clockwise.svg';
import File from '@phosphor/file.svg';
import Folder from '@phosphor/folder-simple.svg';
import GitPull from '@phosphor/git-pull-request.svg';
import ListChecks from '@phosphor/list-checks.svg';
import Search from '@phosphor/magnifying-glass.svg';
import Note from '@phosphor/note-pencil.svg';
import Plugs from '@phosphor/plugs-connected.svg';
import Plus from '@phosphor/plus.svg';
import Sidebar from '@phosphor/sidebar-simple.svg';
import Sparkle from '@phosphor/sparkle.svg';
import Stack from '@phosphor/stack.svg';
import Users from '@phosphor/users-three.svg';
import { Button, Tabs } from '@ui';
import { TabsInset } from '@ui/components/TabsInset';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import type { WorkspaceView } from '../../core/dummy-workspace';
import { sampleAgentSessions } from '../../core/workspace-parity-fixtures';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { ViewSidebar } from '../DemoViewSidebar';
import { SearchBar } from '../email/frozen/SearchBar';
import { ChatSidebar } from './ChatSidebar';
import { MiniCalendar } from './WorkspaceCalendar';
import { WorkspaceHomeFeed } from './WorkspaceHomeFeed';
import type { TaskFilter } from './WorkspaceTasks';

function Group(props: { title: string; children: JSX.Element }) {
  return (
    <section>
      <p class="px-2 text-xs text-ink-muted mb-3">{props.title}</p>
      <ViewSidebar.Nav>{props.children}</ViewSidebar.Nav>
    </section>
  );
}
function WorkspaceSidebarOther(props: {
  workspace: DummyWorkspace;
  title: string;
  collapse: () => void;
  create: () => void;
  navigate: (view: WorkspaceView, id?: string) => void;
  taskFilter: TaskFilter;
  setTaskFilter: (value: TaskFilter) => void;
}) {
  const w = props.workspace;
  const [conversationsOpen, setConversationsOpen] = createSignal(true);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [agentSearch, setAgentSearch] = createSignal('');
  let conversationSearch: HTMLInputElement | undefined;
  const taskFilter = (id: TaskFilter) => {
    props.setTaskFilter(id);
    props.navigate('tasks');
  };
  return (
    <ViewSidebar.Root aria-label={`${props.title} navigation`}>
      <ViewSidebar.Header>
        <Show
          when={w.view() === 'agents'}
          fallback={
            <>
              <ViewSidebar.Title>{props.title}</ViewSidebar.Title>
              <ViewSidebar.Control
                label="Collapse sidebar"
                onClick={props.collapse}
              >
                <Sidebar />
              </ViewSidebar.Control>
            </>
          }
        >
          <div class="flex min-w-0 items-center gap-1">
            <ViewSidebar.Control
              label="Collapse sidebar"
              onClick={props.collapse}
            >
              <Sidebar />
            </ViewSidebar.Control>
            <ViewSidebar.Title>{props.title}</ViewSidebar.Title>
          </div>
        </Show>
      </ViewSidebar.Header>
      <Switch
        fallback={
          <ViewSidebar.Primary>
            <ViewSidebar.Action onClick={props.create}>
              <ViewSidebar.Icon>
                <Plus />
              </ViewSidebar.Icon>
              {w.view() === 'tasks'
                ? 'New task'
                : w.view() === 'crm'
                  ? 'New company'
                  : 'New'}
            </ViewSidebar.Action>
          </ViewSidebar.Primary>
        }
      >
        <Match when={w.view() === 'agents'}>
          <div class="shrink-0 px-(--sidebar-gutter) pt-1" data-agent-mode-row>
            <Tabs
              aria-label="Agents mode"
              fullWidth
              list={[
                { value: 'work', label: 'Work' },
                { value: 'code', label: 'Code' },
              ]}
              value={w.agentMode()}
              onChange={(value) => {
                w.setAgentMode(value === 'code' ? 'code' : 'work');
                props.navigate('agents', 'new');
              }}
            />
          </div>
          <div
            class="shrink-0 px-(--sidebar-gutter) pt-2"
            data-agent-create-row
          >
            <ViewSidebar.Action onClick={() => props.navigate('agents', 'new')}>
              <ViewSidebar.Icon>
                <Plus />
              </ViewSidebar.Icon>
              <span class="truncate">New conversation</span>
            </ViewSidebar.Action>
          </div>
        </Match>
        <Match when={w.view() === 'home'}>
          <ViewSidebar.Primary>
            <ViewSidebar.Action onClick={() => props.navigate('agents', 'new')}>
              <ViewSidebar.Icon>
                <Plus />
              </ViewSidebar.Icon>
              New chat
            </ViewSidebar.Action>
          </ViewSidebar.Primary>
        </Match>
      </Switch>
      <ViewSidebar.Content>
        <Switch>
          <Match when={w.view() === 'tasks'}>
            <ViewSidebar.Nav>
              <ViewSidebar.Item
                onClick={() => taskFilter('reviews')}
                active={props.taskFilter === 'reviews'}
              >
                <ViewSidebar.Icon>
                  <GitPull />
                </ViewSidebar.Icon>
                Reviews
              </ViewSidebar.Item>
            </ViewSidebar.Nav>
            <ViewSidebar.Nav>
              <For
                each={
                  [
                    { id: 'mine', label: 'My Tasks', icon: CheckSquare },
                    { id: 'all', label: 'All Tasks', icon: ListChecks },
                    { id: 'created', label: 'Created by me', icon: Note },
                    { id: 'Launch', label: 'Projects', icon: Stack },
                  ] as const
                }
              >
                {(item) => (
                  <ViewSidebar.Item
                    active={props.taskFilter === item.id}
                    onClick={() => taskFilter(item.id)}
                  >
                    <ViewSidebar.Icon>
                      <item.icon />
                    </ViewSidebar.Icon>
                    {item.label}
                  </ViewSidebar.Item>
                )}
              </For>
            </ViewSidebar.Nav>
            <Group title="Tags">
              <For each={['Launch', 'Product', 'Customers'] as const}>
                {(tag, i) => (
                  <ViewSidebar.Item
                    active={props.taskFilter === tag}
                    onClick={() => taskFilter(tag)}
                  >
                    <span class="sample-tag-dot" data-color={i()} />
                    {tag}
                  </ViewSidebar.Item>
                )}
              </For>
            </Group>
          </Match>
          <Match when={w.view() === 'documents' || w.view() === 'spreadsheet'}>
            <ViewSidebar.Nav>
              <For
                each={[
                  { label: 'My Files', icon: File },
                  { label: 'Recent', icon: Clock },
                  { label: 'Shared with me', icon: Users },
                ]}
              >
                {(item) => (
                  <ViewSidebar.Item
                    active={!w.selected() && w.fileView() === item.label}
                    onClick={() => {
                      w.setFileView(item.label);
                      props.navigate('documents');
                    }}
                  >
                    <ViewSidebar.Icon>
                      <item.icon />
                    </ViewSidebar.Icon>
                    {item.label}
                  </ViewSidebar.Item>
                )}
              </For>
            </ViewSidebar.Nav>
            <Group title="Favorites">
              <For each={w.data.documents.slice(0, 3)}>
                {(doc) => (
                  <ViewSidebar.Item
                    active={w.selected() === doc.id}
                    onClick={() => props.navigate('documents', doc.id)}
                  >
                    <ViewSidebar.Icon>
                      <File class="text-document" />
                    </ViewSidebar.Icon>
                    <span class="truncate">{doc.title}</span>
                  </ViewSidebar.Item>
                )}
              </For>
            </Group>
            <Group title="Folders">
              <ViewSidebar.Item
                onClick={() => {
                  w.setFileView('My Files');
                  props.navigate('documents');
                }}
              >
                <ViewSidebar.Icon>
                  <Folder />
                </ViewSidebar.Icon>
                Drive
              </ViewSidebar.Item>
              <ViewSidebar.Item
                onClick={() => {
                  w.setFileView('Shared with me');
                  props.navigate('documents');
                }}
              >
                <ViewSidebar.Icon>
                  <Folder />
                </ViewSidebar.Icon>
                Launch team
              </ViewSidebar.Item>
            </Group>
          </Match>

          <Match when={w.view() === 'home'}>
            <WorkspaceHomeFeed workspace={w} navigate={props.navigate} />
          </Match>
          <Match when={w.view() === 'agents'}>
            <ViewSidebar.Nav>
              <ViewSidebar.Item
                active={w.selected() === 'catalog'}
                onClick={() => props.navigate('agents', 'catalog')}
              >
                <ViewSidebar.Icon>
                  <Sparkle />
                </ViewSidebar.Icon>
                Agents
              </ViewSidebar.Item>
              <ViewSidebar.Item
                active={w.selected() === 'routines'}
                onClick={() => props.navigate('agents', 'routines')}
              >
                <ViewSidebar.Icon>
                  <Repeat />
                </ViewSidebar.Icon>
                Routines
              </ViewSidebar.Item>
              <ViewSidebar.Item
                active={w.selected() === 'connections'}
                onClick={() => props.navigate('agents', 'connections')}
              >
                <ViewSidebar.Icon>
                  <Plugs />
                </ViewSidebar.Icon>
                Connections
              </ViewSidebar.Item>
            </ViewSidebar.Nav>
            <section class="flex min-h-0 flex-col">
              <div class="flex h-8 items-center gap-1 px-2 text-xs text-ink-muted">
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-1 text-left"
                  aria-expanded={conversationsOpen()}
                  onClick={() => setConversationsOpen(!conversationsOpen())}
                >
                  Conversations{' '}
                  <Caret
                    class={`size-3 ${conversationsOpen() ? 'rotate-90' : ''}`}
                  />
                </button>
                <Button
                  variant="plain"
                  size="icon-sm"
                  label="Search conversations"
                  aria-pressed={searchOpen()}
                  onClick={() => {
                    setConversationsOpen(true);
                    setSearchOpen(!searchOpen());
                    if (!searchOpen()) setAgentSearch('');
                    else queueMicrotask(() => conversationSearch?.focus());
                  }}
                >
                  <Search class="size-3.5" />
                </Button>
              </div>
              <Show when={conversationsOpen()}>
                <Show when={searchOpen()}>
                  <SearchBar
                    ref={conversationSearch}
                    label="Search conversations"
                    placeholder="Search conversations"
                    value={agentSearch()}
                    onValueChange={setAgentSearch}
                    onEscape={() => {
                      setAgentSearch('');
                      setSearchOpen(false);
                    }}
                  />
                </Show>
                <ViewSidebar.Nav aria-label="Recent conversations">
                  <For
                    each={sampleAgentSessions.filter((session) =>
                      session.title
                        .toLowerCase()
                        .includes(agentSearch().toLowerCase())
                    )}
                  >
                    {(session) => (
                      <ViewSidebar.Item
                        class="sample-agent-session"
                        aria-label={session.title}
                        data-agent-session-row={session.id}
                        data-has-code={'branch' in session}
                        active={w.selected() === session.id}
                        onClick={() => {
                          w.setAgentMode(
                            session.runtime === 'Macro' ? 'work' : 'code'
                          );
                          props.navigate('agents', session.id);
                        }}
                      >
                        <ViewSidebar.Icon />
                        <span class="min-w-0 flex-1">
                          <span class="flex items-center gap-2">
                            <span class="min-w-0 truncate flex-1">
                              {session.title}
                            </span>
                            <span class="shrink-0 text-xs text-ink-extra-muted tabular-nums">
                              {session.time}
                            </span>
                          </span>
                          <Show when={'branch' in session}>
                            <span class="flex items-center gap-1.5 text-xs leading-4 text-ink-extra-muted min-w-0">
                              <GitPull class="size-3 shrink-0 text-success" />
                              <span class="text-success">
                                {'pr' in session ? session.pr : ''}
                              </span>
                              <span class="truncate">
                                · launch-team/workspace ·{' '}
                                {'branch' in session ? session.branch : ''}
                              </span>
                            </span>
                          </Show>
                        </span>
                      </ViewSidebar.Item>
                    )}
                  </For>
                </ViewSidebar.Nav>
              </Show>
            </section>
          </Match>
          <Match when={w.view() === 'crm'}>
            <div class="shrink-0 px-1.5">
              <TabsInset
                aria-label="Company layout"
                fullWidth
                class="h-auto"
                labelClass="py-1.5"
                list={[
                  { value: 'Board', label: 'Board' },
                  { value: 'List', label: 'List' },
                ]}
                value={w.companyLayout()}
                onChange={(mode) =>
                  w.setCompanyLayout(mode === 'List' ? 'List' : 'Board')
                }
              />
            </div>
            <Group title="Views">
              <For
                each={[
                  'All companies',
                  'My companies',
                  'Needs follow-up',
                  'Recently active',
                  'Unassigned',
                ]}
              >
                {(view) => (
                  <ViewSidebar.Item
                    active={w.companyFilter() === view}
                    onClick={() => {
                      w.setCompanyFilter(view);
                      props.navigate('crm');
                    }}
                  >
                    {view}
                  </ViewSidebar.Item>
                )}
              </For>
            </Group>
          </Match>
          <Match when={w.view() === 'calendar'}>
            <MiniCalendar workspace={w} />
            <Group title="Upcoming events">
              <For
                each={w.data.events
                  .filter((e) => e.date >= w.calendarDate())
                  .slice(0, 4)}
              >
                {(event) => (
                  <ViewSidebar.Item
                    onClick={() => {
                      w.setCalendarDate(event.date);
                      props.navigate('calendar', event.id);
                    }}
                  >
                    <span class="sample-tag-dot" />
                    <span class="truncate">{event.title}</span>
                  </ViewSidebar.Item>
                )}
              </For>
            </Group>
            <Group title="Calendars">
              <div class="flex items-center gap-2 px-2 py-2 text-sm">
                <Calendar class="size-4" />
                jacob@macro.com
              </div>
              <label class="flex items-center gap-2 px-2 text-sm">
                <input
                  type="checkbox"
                  checked={w.showPersonal()}
                  onChange={(e) => w.setShowPersonal(e.currentTarget.checked)}
                />
                Personal calendar
              </label>
            </Group>
          </Match>
        </Switch>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}

export function WorkspaceSidebar(
  props: Parameters<typeof WorkspaceSidebarOther>[0]
) {
  return (
    <Show
      when={props.workspace.view() === 'messages'}
      fallback={<WorkspaceSidebarOther {...props} />}
    >
      <ChatSidebar
        workspace={props.workspace}
        collapse={props.collapse}
        navigate={(id) => {
          props.workspace.setChannel(id);
          props.navigate('messages', id);
        }}
      />
    </Show>
  );
}
