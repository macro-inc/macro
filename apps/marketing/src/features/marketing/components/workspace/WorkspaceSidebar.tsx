import Calendar from '@phosphor/calendar-blank.svg';
import CheckSquare from '@phosphor/check-square.svg';
import Clock from '@phosphor/clock.svg';
import File from '@phosphor/file.svg';
import Folder from '@phosphor/folder-simple.svg';
import GitPull from '@phosphor/git-pull-request.svg';
import Hash from '@phosphor/hash.svg';
import ListChecks from '@phosphor/list-checks.svg';
import Note from '@phosphor/note-pencil.svg';
import Plugs from '@phosphor/plugs-connected.svg';
import Plus from '@phosphor/plus.svg';
import Sidebar from '@phosphor/sidebar-simple.svg';
import Sparkle from '@phosphor/sparkle.svg';
import Stack from '@phosphor/stack.svg';
import Users from '@phosphor/users-three.svg';
import { TabsInset } from '@ui/components/TabsInset';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import type { WorkspaceView } from '../../core/dummy-workspace';
import { homepagePeople } from '../../core/homepage-demo-people';
import { sampleAgentSessions } from '../../core/workspace-parity-fixtures';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { ViewSidebar } from '../DemoViewSidebar';
import { Segments } from './frozen/DetailPanel';
import { ModelIcon } from './frozen/model-picker/ProviderIcon';
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
export function WorkspaceSidebar(props: {
  workspace: DummyWorkspace;
  title: string;
  collapse: () => void;
  create: () => void;
  navigate: (view: WorkspaceView, id?: string) => void;
  taskFilter: TaskFilter;
  setTaskFilter: (value: TaskFilter) => void;
}) {
  const w = props.workspace;
  const [chatList, setChatList] = createSignal<'All' | 'Recent'>('All');
  const channel = (id: string) => {
    w.setChannel(id);
    props.navigate('messages', id);
  };
  const taskFilter = (id: TaskFilter) => {
    props.setTaskFilter(id);
    props.navigate('tasks');
  };
  return (
    <ViewSidebar.Root aria-label={`${props.title} navigation`}>
      <ViewSidebar.Header>
        <ViewSidebar.Title>{props.title}</ViewSidebar.Title>
        <ViewSidebar.Control label="Collapse sidebar" onClick={props.collapse}>
          <Sidebar />
        </ViewSidebar.Control>
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
        <Match when={w.view() === 'messages'}>
          <div class="px-4 pb-4">
            <Segments
              sidebar
              label="Chat lists"
              items={['All', 'Recent']}
              value={chatList()}
              onChange={setChatList}
            />
          </div>
        </Match>
        <Match when={w.view() === 'home' || w.view() === 'agents'}>
          <ViewSidebar.Primary>
            <ViewSidebar.Action onClick={() => props.navigate('agents', 'new')}>
              <ViewSidebar.Icon>
                <Plus />
              </ViewSidebar.Icon>
              {w.view() === 'home' ? 'New chat' : 'New conversation'}
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
          <Match when={w.view() === 'messages'}>
            <Show when={chatList() === 'All'}>
              <Group title="Favorites">
                <For
                  each={w.data.channels.filter((c) => !c.person).slice(0, 2)}
                >
                  {(c) => (
                    <ViewSidebar.Item onClick={() => channel(c.id)}>
                      <ViewSidebar.Icon>
                        <Hash />
                      </ViewSidebar.Icon>
                      {c.id}
                    </ViewSidebar.Item>
                  )}
                </For>
              </Group>
            </Show>
            <Group
              title={chatList() === 'All' ? 'Channels' : 'Recent conversations'}
            >
              <For
                each={w.data.channels.filter(
                  (c) =>
                    !c.person &&
                    (chatList() === 'All' ||
                      c.id === w.channel() ||
                      c.id === 'launch')
                )}
              >
                {(c) => (
                  <ViewSidebar.Item
                    active={w.channel() === c.id}
                    onClick={() => channel(c.id)}
                  >
                    <ViewSidebar.Icon>
                      <Hash />
                    </ViewSidebar.Icon>
                    {c.id}
                  </ViewSidebar.Item>
                )}
              </For>
            </Group>
            <Group title="DMs">
              <For each={w.data.channels.filter((c) => c.person)}>
                {(c) => (
                  <ViewSidebar.Item
                    active={w.channel() === c.id}
                    onClick={() => channel(c.id)}
                  >
                    <img
                      class="size-5 rounded-full"
                      src={homepagePeople[c.person!].photo}
                      alt=""
                    />
                    {homepagePeople[c.person!].name}
                  </ViewSidebar.Item>
                )}
              </For>
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
                active={w.selected() === 'connections'}
                onClick={() => props.navigate('agents', 'connections')}
              >
                <ViewSidebar.Icon>
                  <Plugs />
                </ViewSidebar.Icon>
                Connections
              </ViewSidebar.Item>
            </ViewSidebar.Nav>
            <Group title="Conversations">
              <For each={sampleAgentSessions}>
                {(session) => (
                  <ViewSidebar.Item
                    class="sample-agent-session"
                    active={w.selected() === session.id}
                    onClick={() => props.navigate('agents', session.id)}
                  >
                    <ViewSidebar.Icon>
                      <ModelIcon
                        provider={session.provider}
                        class="size-5 text-ink-muted"
                      />
                    </ViewSidebar.Icon>
                    <span class="min-w-0 flex-1">
                      <span class="flex items-center gap-2">
                        <span class="truncate flex-1">{session.title}</span>
                        <span class="text-[10px] text-ink-extra-muted">
                          {session.time}
                        </span>
                      </span>
                      <Show when={'branch' in session}>
                        <span class="mt-1 flex items-center gap-1 text-[10px] text-ink-extra-muted min-w-0">
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
                      <span class="sr-only">{session.runtime}</span>
                    </span>
                  </ViewSidebar.Item>
                )}
              </For>
            </Group>
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
