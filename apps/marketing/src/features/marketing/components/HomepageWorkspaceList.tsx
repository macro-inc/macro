import BuildingsIcon from '@phosphor/buildings.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import ChatIcon from '@phosphor/chat-circle.svg';
import ClockIcon from '@phosphor/clock.svg';
import CodeIcon from '@phosphor/code.svg';
import EmailIcon from '@phosphor/envelope.svg';
import DocumentIcon from '@phosphor/file-text.svg';
import FolderIcon from '@phosphor/folder-simple.svg';
import HashIcon from '@phosphor/hash.svg';
import TaskIcon from '@phosphor/list-checks.svg';
import PlugsIcon from '@phosphor/plugs.svg';
import PlusIcon from '@phosphor/plus.svg';
import SplitIcon from '@phosphor/sidebar-simple.svg';
import AgentIcon from '@phosphor/sparkle.svg';
import SheetIcon from '@phosphor/table.svg';
import UsersIcon from '@phosphor/users.svg';
import { For, Show } from 'solid-js';
import type { DemoPage } from '../core/workspace-demo';
import type { WorkspaceDemo } from '../primitives/createWorkspaceDemo';
import { NavGlyph, type NavIcon } from './DemoNavGlyph';
import { ViewSidebar } from './DemoViewSidebar';

type Item = {
  label: string;
  page: DemoPage;
  icon: NavIcon;
  session?: 'macro' | 'cursor';
};
const ITEMS: Item[] = [
  { label: 'launch', page: 'messages', icon: HashIcon },
  { label: 'Thursday’s launch', page: 'email', icon: EmailIcon },
  { label: 'Q3 launch plan', page: 'documents', icon: DocumentIcon },
  { label: 'Launch checklist', page: 'tasks', icon: TaskIcon },
  {
    label: 'Plan Thursday’s launch',
    page: 'agents',
    icon: ChatIcon,
    session: 'macro',
  },
  {
    label: 'Fix the deploy pipeline',
    page: 'agents',
    icon: CodeIcon,
    session: 'cursor',
  },
  { label: 'Customers to reach', page: 'spreadsheet', icon: SheetIcon },
  { label: 'Launch week', page: 'calendar', icon: CalendarIcon },
  { label: 'Customer pipeline', page: 'crm', icon: BuildingsIcon },
];
const NAMES: Record<DemoPage, string> = {
  home: 'Home',
  messages: 'Chat',
  documents: 'Drive',
  tasks: 'Tasks',
  agents: 'Agents',
  email: 'Email',
  calendar: 'Calendar',
  crm: 'Customers',
  spreadsheet: 'Drive',
};
const CREATE: Partial<Record<DemoPage, string>> = {
  messages: 'New message',
  documents: 'New',
  tasks: 'New task',
  agents: 'New conversation',
  email: 'New email',
  crm: 'New company',
  spreadsheet: 'New',
};
const NAV: Partial<
  Record<DemoPage, { label: string; icon: NavIcon; disabled?: boolean }[]>
> = {
  documents: [
    { label: 'My Files', icon: DocumentIcon },
    { label: 'Recent', icon: ClockIcon, disabled: true },
    { label: 'Shared with me', icon: UsersIcon, disabled: true },
  ],
  tasks: [
    { label: 'My Tasks', icon: TaskIcon },
    { label: 'All Tasks', icon: TaskIcon, disabled: true },
    { label: 'Created by me', icon: DocumentIcon, disabled: true },
  ],
  agents: [
    { label: 'Agents', icon: AgentIcon },
    { label: 'Connections', icon: PlugsIcon, disabled: true },
  ],
  email: [
    { label: 'All inboxes', icon: EmailIcon, disabled: true },
    { label: 'Signal', icon: EmailIcon, disabled: true },
    { label: 'Noise', icon: EmailIcon, disabled: true },
    { label: 'Sent', icon: EmailIcon, disabled: true },
    { label: 'Calendar', icon: CalendarIcon, disabled: true },
    { label: 'Drafts', icon: DocumentIcon },
  ],
  crm: [
    { label: 'Companies', icon: BuildingsIcon },
    { label: 'Contacts', icon: UsersIcon, disabled: true },
  ],
};
export function HomepageWorkspaceList(props: {
  demo: WorkspaceDemo;
  query: string;
  searching: boolean;
  onSearch: (value: string) => void;
  onCloseSearch: () => void;
}) {
  const navigation = () => props.demo.navigation();
  const items = () =>
    ITEMS.filter(
      (item) =>
        (props.searching ||
          navigation() === 'home' ||
          item.page === navigation() ||
          (navigation() === 'documents' && item.page === 'spreadsheet')) &&
        item.label.toLowerCase().includes(props.query.toLowerCase())
    );
  const section = () =>
    navigation() === 'agents'
      ? 'Conversations'
      : navigation() === 'messages'
        ? 'Channels'
        : navigation() === 'documents'
          ? 'Favorites'
          : navigation() === 'home'
            ? 'Last few minutes'
            : 'Recent';
  return (
    <ViewSidebar.Root aria-label={`${NAMES[navigation()]} demo navigation`}>
      <ViewSidebar.Header>
        <ViewSidebar.Title>{NAMES[navigation()]}</ViewSidebar.Title>
        <SplitIcon class="size-4 text-ink-muted" aria-hidden="true" />
      </ViewSidebar.Header>
      <Show when={CREATE[navigation()]}>
        {(label) => (
          <ViewSidebar.Primary>
            <ViewSidebar.Action
              disabled={navigation() !== 'email' && navigation() !== 'agents'}
              onClick={() =>
                navigation() === 'agents'
                  ? props.demo.openSession('macro')
                  : props.demo.open('email')
              }
            >
              <ViewSidebar.Icon>
                <PlusIcon />
              </ViewSidebar.Icon>
              {label()}
            </ViewSidebar.Action>
          </ViewSidebar.Primary>
        )}
      </Show>
      <ViewSidebar.Content>
        <Show when={props.searching}>
          <input
            type="search"
            aria-label="Search demo workspace"
            class="w-full rounded-lg bg-input px-3 py-2 text-sm outline-none"
            placeholder="Search your work…"
            value={props.query}
            onInput={(event) => props.onSearch(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') props.onCloseSearch();
            }}
          />
        </Show>
        <Show when={!props.searching && NAV[navigation()]}>
          <ViewSidebar.Nav>
            <For each={NAV[navigation()]}>
              {(item) => (
                <ViewSidebar.Item
                  active={
                    !item.disabled &&
                    (navigation() !== 'agents' ||
                      props.demo.session() === 'roster')
                  }
                  disabled={item.disabled}
                  onClick={() => props.demo.open(navigation())}
                >
                  <ViewSidebar.Icon>
                    <NavGlyph icon={item.icon} class="size-4" />
                  </ViewSidebar.Icon>
                  {item.label}
                </ViewSidebar.Item>
              )}
            </For>
          </ViewSidebar.Nav>
        </Show>
        <ViewSidebar.Nav aria-label={section()}>
          <ViewSidebar.Toolbar>
            <span class="text-xs text-ink-muted">
              {props.searching ? 'Search results' : section()}
            </span>
          </ViewSidebar.Toolbar>
          <For each={items()}>
            {(item) => (
              <ViewSidebar.Item
                active={
                  props.demo.page() === item.page &&
                  (!item.session || props.demo.session() === item.session)
                }
                onClick={() =>
                  item.session
                    ? props.demo.openSession(item.session)
                    : props.demo.open(item.page)
                }
              >
                <ViewSidebar.Icon>
                  <NavGlyph icon={item.icon} class="size-4" />
                </ViewSidebar.Icon>
                <span class="min-w-0 flex-1 truncate">{item.label}</span>
              </ViewSidebar.Item>
            )}
          </For>
          <Show when={items().length === 0}>
            <p class="px-2 py-4 text-xs text-ink-extra-muted">No matches.</p>
          </Show>
        </ViewSidebar.Nav>
        <Show when={navigation() === 'documents' && !props.searching}>
          <ViewSidebar.Nav>
            <ViewSidebar.Toolbar>
              <span class="text-xs text-ink-muted">Folders</span>
            </ViewSidebar.Toolbar>
            <ViewSidebar.Item disabled>
              <ViewSidebar.Icon>
                <FolderIcon />
              </ViewSidebar.Icon>
              Launch team
            </ViewSidebar.Item>
          </ViewSidebar.Nav>
        </Show>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
