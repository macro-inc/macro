import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import ArrowLeft from '@phosphor/arrow-left.svg';
import Buildings from '@phosphor/buildings.svg';
import Calendar from '@phosphor/calendar-blank.svg';
import Chats from '@phosphor/chats-circle.svg';
import Envelope from '@phosphor/envelope.svg';
import FileText from '@phosphor/file-text.svg';
import Folder from '@phosphor/folder-simple.svg';
import Hash from '@phosphor/hash.svg';
import House from '@phosphor/house.svg';
import ListChecks from '@phosphor/list-checks.svg';
import Search from '@phosphor/magnifying-glass.svg';
import Plus from '@phosphor/plus.svg';
import Sidebar from '@phosphor/sidebar-simple.svg';
import Sparkle from '@phosphor/sparkle.svg';
import BuildingsFill from '@phosphor-fill/buildings-fill.svg';
import CalendarFill from '@phosphor-fill/calendar-blank-fill.svg';
import ChatsFill from '@phosphor-fill/chats-circle-fill.svg';
import EnvelopeFill from '@phosphor-fill/envelope-fill.svg';
import FolderFill from '@phosphor-fill/folder-simple-fill.svg';
import HouseFill from '@phosphor-fill/house-fill.svg';
import ListChecksFill from '@phosphor-fill/list-checks-fill.svg';
import SparkleFill from '@phosphor-fill/sparkle-fill.svg';
import { Button } from '@ui';
import {
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import type { EmailTagId } from '../../core/demo-email';
import type { WorkspaceView } from '../../core/dummy-workspace';
import { homepagePeople } from '../../core/homepage-demo-people';
import { sampleAgentSessions } from '../../core/workspace-parity-fixtures';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { NavGlyph } from '../DemoNavGlyph';
import { EmailSidebar, type MailTab } from '../email/frozen/EmailShell';
import { CreatePalette } from './frozen/CreatePalette';
import { type SearchOption, SearchPalette } from './frozen/SearchPalette';
import { WorkspaceAgents } from './WorkspaceAgents';
import { WorkspaceCalendar } from './WorkspaceCalendar';
import { WorkspaceChannel } from './WorkspaceChannel';
import { WorkspaceCompanies } from './WorkspaceCompanies';
import { WorkspaceDocuments } from './WorkspaceDocuments';
import { WorkspaceEmail } from './WorkspaceEmail';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { WorkspaceSpreadsheet } from './WorkspaceSpreadsheet';
import { type TaskFilter, WorkspaceTasks } from './WorkspaceTasks';
import '../email/email-demos.css';
import '../demo-markdown.css';
import './dummy-workspace.css';

const NAV = [
  { id: 'home', label: 'Home', icon: House, active: HouseFill },
  { id: 'documents', label: 'Drive', icon: Folder, active: FolderFill },
  { id: 'email', label: 'Email', icon: Envelope, active: EnvelopeFill },
  { id: 'messages', label: 'Chat', icon: Chats, active: ChatsFill },
  { id: 'tasks', label: 'Tasks', icon: ListChecks, active: ListChecksFill },
  { id: 'calendar', label: 'Calendar', icon: Calendar, active: CalendarFill },
  { id: 'agents', label: 'Agents', icon: Sparkle, active: SparkleFill },
  { id: 'crm', label: 'Customers', icon: Buildings, active: BuildingsFill },
] as const;

export default function DummyWorkspace(props: {
  initialView?: WorkspaceView;
  initialTask?: string;
  initialCompany?: string;
  initialDocument?: string;
  initialAgent?: string;
  embedded?: boolean;
}) {
  let workspaceElement!: HTMLDivElement;
  const w = createDummyWorkspace(props.initialView ?? 'home');
  if (!props.embedded && typeof window !== 'undefined') {
    const companyId = window.location.hash.replace(/^#company-/, '');
    const emailId = window.location.hash.replace(/^#email-/, '');
    if (w.data.emails.some((email) => email.id === emailId))
      w.open('email', emailId);
    if (w.data.companies.some((company) => company.id === companyId))
      w.open('crm', companyId);
  }
  if (props.initialDocument) w.open('documents', props.initialDocument);
  if (props.initialAgent) w.open('agents', props.initialAgent);
  if (props.initialTask) w.open('tasks', props.initialTask);
  if (props.initialCompany) w.open('crm', props.initialCompany);
  const [filter, setFilter] = createSignal<TaskFilter>('all');
  const [mailTab, setMailTab] = createSignal<MailTab>('important');
  const [account, setAccount] = createSignal('all');
  const [mailTag, setMailTag] = createSignal<EmailTagId>();
  const [sidebar, setSidebar] = createSignal(true);
  const [mobileOpen, setMobileOpen] = createSignal(false);
  const [searching, setSearching] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  onMount(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (props.embedded && !workspaceElement.contains(target)) return;
      if (
        !event.defaultPrevented &&
        !event.isComposing &&
        !event.repeat &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault();
        setCreating(false);
        setSearching(!searching());
        return;
      }
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        creating() ||
        searching() ||
        target.closest(
          'input, textarea, select, [contenteditable], [role="dialog"]'
        )
      )
        return;
      if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        setCreating(true);
      }
    };
    document.addEventListener('keydown', shortcut);
    onCleanup(() => document.removeEventListener('keydown', shortcut));
  });
  const railView = () => (w.view() === 'spreadsheet' ? 'documents' : w.view());
  const title = () =>
    NAV.find((item) => item.id === railView())?.label ?? 'Workspace';
  const navigate = (view: WorkspaceView, id?: string) => {
    setSearching(false);
    setMobileOpen(false);
    w.openItem(view, id);
    if (view === 'messages' && id) w.setChannel(id);
  };
  function newDocument() {
    const id = crypto.randomUUID();
    w.setData('documents', (docs) => [
      ...docs,
      {
        id,
        title: 'Untitled document',
        body: 'Write something…',
        comments: [],
      },
    ]);
    navigate('documents', id);
  }
  const create = () => {
    if (w.view() === 'crm') w.createCompany();
    else if (w.view() === 'calendar') w.createEvent();
    else if (w.view() === 'email') navigate('email', 'new');
    else if (railView() === 'documents') newDocument();
    else if (w.view() === 'messages') {
      const id = `channel-${w.data.channels.length + 1}`;
      w.setData('channels', (channels) => [...channels, { id, messages: [] }]);
      w.setChannel(id);
    } else w.createTask();
  };
  const searchOptions = (): SearchOption[] => [
    {
      id: 'create',
      title: 'Create',
      category: 'Command',
      icon: Plus,
      shortcut: 'C',
      run: () => setCreating(true),
    },
    ...w.data.channels.map((item) => ({
      id: item.id,
      title: item.person ? homepagePeople[item.person].name : item.id,
      category: item.person ? ('People' as const) : ('Channels' as const),
      icon: item.person ? Chats : Hash,
      run: () => navigate('messages', item.id),
    })),
    ...sampleAgentSessions.map((item) => ({
      id: `agent-${item.id}`,
      title: item.title,
      category: 'Agents' as const,
      icon: Sparkle,
      run: () => navigate('agents', item.id),
    })),
    ...w.data.documents.map((item) => ({
      id: `file-${item.id}`,
      title: item.title,
      category: 'Files' as const,
      icon: FileText,
      run: () =>
        navigate(
          item.kind === 'spreadsheet' ? 'spreadsheet' : 'documents',
          item.id
        ),
    })),
    ...w.data.tasks.map((item) => ({
      id: `task-${item.id}`,
      title: item.title,
      category: 'Tasks' as const,
      icon: ListChecks,
      run: () => navigate('tasks', item.id),
    })),
    ...w.data.emails
      .filter((item) => !item.archived)
      .map((item) => ({
        id: `email-${item.id}`,
        title: item.subject,
        category: 'All' as const,
        icon: Envelope,
        run: () => navigate('email', item.id),
      })),
    ...NAV.map((item) => ({
      id: `go-${item.id}`,
      title: `Go to ${item.label}`,
      category: 'Command' as const,
      icon: item.icon,
      run: () => w.open(item.id),
    })),
  ];
  return (
    <div
      ref={workspaceElement}
      class="dummy-workspace workspace-demo portal-scope"
      data-theme="dark"
      data-embedded={!!props.embedded}
      data-sidebar-open={mobileOpen()}
    >
      <Show when={searching()}>
        <SearchPalette
          mount={workspaceElement}
          options={searchOptions()}
          onClose={() => setSearching(false)}
        />
      </Show>
      <Show when={creating()}>
        <CreatePalette
          mount={workspaceElement}
          onClose={() => setCreating(false)}
          options={[
            {
              label: 'Email',
              key: 'e',
              icon: Envelope,
              run: () => navigate('email', 'new'),
            },
            {
              label: 'Agent',
              key: 'a',
              hint: 'Dedicated Agent Session',
              icon: Sparkle,
              run: () => navigate('agents'),
            },
            { label: 'Document', key: 'd', icon: FileText, run: newDocument },
            {
              label: 'Task',
              key: 't',
              icon: ListChecks,
              run: () => w.createTask(),
            },
            {
              label: 'Message',
              key: 'm',
              hint: 'Quick send message',
              icon: Chats,
              run: () => navigate('messages', w.channel()),
            },
            {
              label: 'Channel',
              key: 'g',
              icon: Hash,
              run: () => {
                const id = `channel-${w.data.channels.length + 1}`;
                w.setData('channels', (channels) => [
                  ...channels,
                  { id, messages: [] },
                ]);
                w.setChannel(id);
                navigate('messages', id);
              },
            },
            {
              label: 'Company',
              key: 'o',
              icon: Buildings,
              run: () => w.createCompany(),
            },
            {
              label: 'Event',
              key: 'v',
              icon: Calendar,
              run: () => w.createEvent(),
            },
          ]}
        />
      </Show>
      <header class="dummy-banner">
        <span>
          <span class="dummy-status-dot" />
          Launch team{' '}
          <span class="text-ink-extra-muted">· Sample workspace</span>
        </span>
        <div class="flex items-center gap-2">
          <span class="dummy-local-note text-ink-extra-muted">
            Changes stay in this session
          </span>
          <Button
            variant="plain"
            size="sm"
            onClick={() => {
              w.reset();
              setSearching(false);
              setFilter('all');
              setMailTab('important');
              setAccount('all');
              setMobileOpen(false);
            }}
          >
            <ArrowCounterClockwise class="size-3" />
            Reset
          </Button>
          <Show when={props.embedded}>
            <a
              href="/demo"
              class="text-xs text-ink-muted underline underline-offset-4"
            >
              Open workspace
            </a>
          </Show>
        </div>
      </header>
      <div class="dummy-layout">
        <div
          data-ui="sidebar-rail"
          class="dummy-rail relative flex h-full w-14 shrink-0 flex-col items-center gap-1 overflow-hidden border-r border-edge-frame bg-panel px-2 pb-3 pt-2"
        >
          <Button
            size="icon-md"
            class="size-10 rounded-xl"
            label="Create in workspace"
            tooltipPlacement="right"
            tooltipMount={workspaceElement}
            shortcut="C"
            aria-haspopup="dialog"
            onClick={() => setCreating(true)}
          >
            <Plus class="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-md"
            class="size-10 rounded-xl"
            label="Search workspace"
            tooltipPlacement="right"
            tooltipMount={workspaceElement}
            shortcut="⌘ K"
            aria-haspopup="dialog"
            onClick={() => {
              setSearching(!searching());
            }}
          >
            <Search class="size-5" />
          </Button>
          <nav class="shrink-0 pt-4" aria-label="Workspace navigation">
            <ul class="flex flex-col items-center gap-1">
              <For each={NAV}>
                {(item) => (
                  <li class="flex">
                    <Button
                      variant="ghost"
                      size="icon-md"
                      class={`size-10 rounded-xl ${railView() === item.id ? 'bg-hover text-ink' : ''}`}
                      label={item.label}
                      tooltipPlacement="right"
                      tooltipMount={workspaceElement}
                      aria-current={railView() === item.id ? 'page' : undefined}
                      onClick={() => {
                        setSearching(false);
                        setMobileOpen(false);
                        w.open(item.id);
                      }}
                    >
                      <NavGlyph
                        icon={item.icon}
                        iconActive={item.active}
                        filled={railView() === item.id}
                        class="size-5"
                      />
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </nav>
          <div class="min-h-0 flex-1" />
          <img
            src={homepagePeople.jacob.photo}
            alt="Jacob Beckerman"
            class="size-8 rounded-full"
          />
        </div>
        <Show when={sidebar()}>
          <div class="dummy-sidebar">
            <Show
              when={w.view() === 'email'}
              fallback={
                <WorkspaceSidebar
                  workspace={w}
                  title={title()}
                  collapse={() => setSidebar(false)}
                  create={create}
                  navigate={navigate}
                  taskFilter={filter()}
                  setTaskFilter={setFilter}
                />
              }
            >
              <EmailSidebar
                onToggleNavigation={() => setSidebar(false)}
                tab={mailTab()}
                account={account()}
                tag={mailTag()}
                onTag={(tag) => {
                  setMailTag(tag);
                  setMailTab('all');
                  navigate('email');
                }}
                onTab={(tab) => {
                  setMailTag(undefined);
                  setMailTab(tab);
                  navigate(tab === 'calendar' ? 'calendar' : 'email');
                }}
                onAccount={setAccount}
                onCompose={() => navigate('email', 'new')}
              />
            </Show>
          </div>
        </Show>
        <div class="dummy-main">
          <Show when={props.initialCompany && w.view() !== 'crm'}>
            <div class="px-3 pt-2">
              <Button
                variant="plain"
                size="sm"
                onClick={() => navigate('crm', props.initialCompany)}
              >
                <ArrowLeft />
                Back to customer record
              </Button>
            </div>
          </Show>
          <div class="dummy-mobile-nav">
            <Button
              variant="plain"
              size="icon-sm"
              label="Toggle navigation"
              onClick={() => {
                setSidebar(true);
                setMobileOpen(!mobileOpen());
              }}
            >
              <Sidebar />
            </Button>
            <span class="text-sm">{title()}</span>
            <Button
              variant="plain"
              size="icon-sm"
              label="Create item"
              onClick={() => setCreating(true)}
            >
              <Plus />
            </Button>
          </div>
          <Show when={!sidebar()}>
            <div class="dummy-restore-sidebar">
              <Button
                variant="plain"
                size="icon-sm"
                label="Expand sidebar"
                onClick={() => setSidebar(true)}
              >
                <Sidebar />
              </Button>
            </div>
          </Show>
          <Switch>
            <Match when={w.contentView() === 'tasks'}>
              <WorkspaceTasks workspace={w} filter={filter()} />
            </Match>
            <Match when={w.contentView() === 'email'}>
              <WorkspaceEmail
                workspace={w}
                tag={mailTag()}
                onClearTag={() => setMailTag(undefined)}
                tab={mailTab()}
                account={account()}
                navigationOpen={sidebar()}
                onToggleNavigation={() => setSidebar(!sidebar())}
              />
            </Match>
            <Match when={w.contentView() === 'spreadsheet'}>
              <WorkspaceSpreadsheet workspace={w} />
            </Match>
            <Match when={w.contentView() === 'documents'}>
              <WorkspaceDocuments workspace={w} />
            </Match>
            <Match when={w.contentView() === 'messages'}>
              <WorkspaceChannel workspace={w} />
            </Match>
            <Match when={w.contentView() === 'agents'}>
              <WorkspaceAgents workspace={w} />
            </Match>
            <Match when={w.contentView() === 'home'}>
              <WorkspaceAgents workspace={w} home />
            </Match>
            <Match when={w.contentView() === 'calendar'}>
              <WorkspaceCalendar workspace={w} />
            </Match>
            <Match when={w.contentView() === 'crm'}>
              <WorkspaceCompanies workspace={w} />
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  );
}
