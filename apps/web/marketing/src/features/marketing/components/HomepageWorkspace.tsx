import { AgentMessage } from './DemoAgentMessage';
import { AgentRosterRow, ViewShell } from './DemoWorkspaceChrome';
import './demo-agents-view.css';
import MacroLogo from '@icon/macro-logo.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import BuildingsIcon from '@phosphor/buildings.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import DotsIcon from '@phosphor/dots-three.svg';
import EmailIcon from '@phosphor/envelope.svg';
import DocumentIcon from '@phosphor/file-text.svg';
import HashIcon from '@phosphor/hash.svg';
import InfoIcon from '@phosphor/info.svg';
import TaskIcon from '@phosphor/list-checks.svg';
import MicrophoneIcon from '@phosphor/microphone.svg';
import PaperclipIcon from '@phosphor/paperclip.svg';
import PhoneIcon from '@phosphor/phone.svg';
import PlusIcon from '@phosphor/plus.svg';
import ShareIcon from '@phosphor/share.svg';
import AgentIcon from '@phosphor/sparkle.svg';
import SheetIcon from '@phosphor/table.svg';
import { Button, ComposerSurface, SendButton } from '@ui';
import {
  createEffect,
  createSignal,
  For,
  lazy,
  Match,
  on,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { DEPLOY_PROMPT, DEPLOY_TRACE } from '../core/deploy-agent-demo';
import { homepagePeople } from '../core/homepage-demo-people';
import type { DemoMessage, DemoPage } from '../core/workspace-demo';
import type { WorkspaceDemo } from '../primitives/createWorkspaceDemo';
import { DemoMarkdown } from './DemoMarkdown';
import { NavGlyph, type NavIcon } from './DemoNavGlyph';
import { HomepagePersonAvatar } from './HomepageConversation';
import './homepage-workspace.css';

const Spreadsheet = lazy(() => import('./HomepageSpreadsheet'));
const Email = lazy(() => import('./HomepageEmailCompose'));
const Crm = lazy(() => import('./HomepageWorkspaceCrm'));
const CalendarDemo = lazy(() => import('./HomepageWorkspaceCalendar'));
const TasksDemo = lazy(() => import('./HomepageWorkspaceTasks'));

const ICONS: Record<DemoPage, NavIcon> = {
  home: HashIcon,
  messages: HashIcon,
  documents: DocumentIcon,
  tasks: TaskIcon,
  agents: AgentIcon,
  email: EmailIcon,
  calendar: CalendarIcon,
  crm: BuildingsIcon,
  spreadsheet: SheetIcon,
};
const PAGES: DemoPage[] = [
  'messages',
  'documents',
  'tasks',
  'agents',
  'calendar',
  'email',
  'spreadsheet',
  'crm',
];

const TITLES: Record<DemoPage, string> = {
  home: 'launch',
  messages: 'launch',
  documents: 'Q3 launch plan',
  tasks: 'My tasks',
  agents: 'Agents',
  email: 'New email',
  calendar: 'Launch week',
  crm: 'Companies',
  spreadsheet: 'Customers to reach',
};

/** Website-local composer with fixture-only send handlers. */
function DemoComposer(props: {
  label: string;
  onSend: (text: string) => void;
  busy?: boolean;
}) {
  const [draft, setDraft] = createSignal('');
  const send = () => {
    if (!draft().trim() || props.busy) return;
    props.onSend(draft());
    setDraft('');
  };
  return (
    <div class="workspace-demo-composer">
      <ComposerSurface as="div" class="flex items-end gap-2 rounded-3xl p-2.5">
        <Button variant="ghost" size="icon-sm" label="Attach a file" disabled>
          <PaperclipIcon class="size-4" />
        </Button>
        <textarea
          aria-label={props.label}
          placeholder={props.label}
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          rows={1}
          class="min-w-0 flex-1 max-h-28 resize-none bg-transparent py-1 text-sm outline-none"
        />
        <Button variant="ghost" size="icon-sm" label="Voice input" disabled>
          <MicrophoneIcon class="size-4" />
        </Button>
        <SendButton
          appearance="composer"
          aria-label="Send demo message"
          disabled={!draft().trim() || props.busy}
          onClick={send}
        />
      </ComposerSurface>
    </div>
  );
}

function ChannelMessage(props: { message: DemoMessage }) {
  const person = () => homepagePeople[props.message.person];
  const [reacted, setReacted] = createSignal(false);
  return (
    <div class="py-3 px-5">
      <div class="grid grid-cols-[32px_1fr] gap-x-3 gap-y-1">
        <div data-message-slot="icon" class="row-span-3">
          <HomepagePersonAvatar person={props.message.person} />
        </div>
        <div>
          <span class="text-sm font-medium">{person().shortName}</span>
          <span class="ml-2 text-xs text-ink-extra-muted">10:24 AM</span>
        </div>
        <div class="min-w-0">
          <DemoMarkdown
            markdown={props.message.body}
            class="text-sm [&>.md-p]:my-0"
          />
        </div>
        <div>
          <button
            type="button"
            class="mt-1 rounded-full border border-edge-muted px-2 py-0.5 text-xs text-ink-muted"
            aria-label={`Like ${person().shortName}'s message`}
            aria-pressed={reacted()}
            onClick={() => setReacted(!reacted())}
          >
            👍 {reacted() ? 2 : 1}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChannelDemo(props: { demo: WorkspaceDemo }) {
  let scroll!: HTMLDivElement;
  createEffect(
    on(
      () => props.demo.messages().length,
      () => {
        // New local messages stay visible without scrolling the surrounding homepage.
        requestAnimationFrame(() =>
          scroll?.scrollTo({ top: scroll.scrollHeight })
        );
      },
      { defer: true }
    )
  );
  return (
    <>
      <div
        class="workspace-demo-scroll"
        ref={scroll}
        role="log"
        aria-label="Launch channel messages"
      >
        <div class="px-5 pt-5 pb-3 text-xs text-ink-extra-muted">
          Thursday, September 24 · Launch team
        </div>
        <For each={props.demo.messages()}>
          {(message) => <ChannelMessage message={message} />}
        </For>
      </div>
      <DemoComposer label="Message #launch" onSend={props.demo.post} />
    </>
  );
}

function DocumentDemo(props: { demo: WorkspaceDemo }) {
  const initialDocument = props.demo.document();
  return (
    <div class="workspace-demo-scroll workspace-demo-document">
      <h1 class="mb-6 text-2xl font-semibold">Q3 launch plan</h1>
      <div
        contentEditable
        role="textbox"
        aria-label="Q3 launch plan document"
        aria-multiline="true"
        class="h-auto text-sm outline-none"
        onInput={(event) =>
          props.demo.setDocument(event.currentTarget.innerText)
        }
      >
        <DemoMarkdown markdown={initialDocument} />
      </div>
    </div>
  );
}

function AgentDemo(props: { demo: WorkspaceDemo }) {
  return (
    <>
      <div
        class="workspace-demo-page"
        hidden={props.demo.session() !== 'roster'}
        inert={props.demo.session() !== 'roster'}
      >
        <div class="workspace-demo-scroll agents-view-portal">
          <section class="settings">
            <div class="wrap">
              <header class="ph-head">
                <div>
                  <h1 class="big">Agents</h1>
                  <p class="desc">
                    Give each agent its own identity, instructions, and skills.
                  </p>
                </div>
                <Button variant="ghost" size="sm" disabled>
                  <PlusIcon class="size-4" />
                  New agent
                </Button>
              </header>
              <div class="sections">
                <div class="section">
                  <div class="sh">
                    <h2>Team agents</h2>
                    <p>Shared with everyone in your workspace.</p>
                  </div>
                  <div class="scard">
                    <AgentRosterRow
                      id="demo-macro"
                      name="Macro"
                      handle="macro"
                      share="system"
                      detail="Default model · All channels"
                      actions={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          label="Open Macro conversation"
                          onClick={() => props.demo.openSession('macro')}
                        >
                          <CaretRightIcon class="size-4" />
                        </Button>
                      }
                    />
                  </div>
                </div>
                <div class="section">
                  <div class="sh">
                    <h2>Coding agents</h2>
                    <p>Work with your repositories from a conversation.</p>
                  </div>
                  <div class="scard">
                    <AgentRosterRow
                      id="demo-cursor"
                      name="Cursor"
                      handle="cursor"
                      coder
                      share="system"
                      detail="Cursor · All channels"
                      actions={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          label="Open Cursor session"
                          onClick={() => props.demo.openSession('cursor')}
                        >
                          <CaretRightIcon class="size-4" />
                        </Button>
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
      <For each={['macro', 'cursor'] as const}>
        {(session) => (
          <div
            class="workspace-demo-page"
            hidden={props.demo.session() !== session}
            inert={props.demo.session() !== session}
          >
            <AgentSessionDemo demo={props.demo} session={session} />
          </div>
        )}
      </For>
    </>
  );
}

function AgentSessionDemo(props: {
  demo: WorkspaceDemo;
  session: 'macro' | 'cursor';
}) {
  let scroll!: HTMLDivElement;
  const coding = () => props.session === 'cursor';
  const replies = () =>
    props.demo.replies().filter((reply) => reply.session === props.session);
  createEffect(
    on(
      () => [props.demo.replies(), props.demo.busy()],
      () => {
        requestAnimationFrame(() =>
          scroll?.scrollTo({ top: scroll.scrollHeight })
        );
      },
      { defer: true }
    )
  );
  return (
    <>
      <div
        class="workspace-demo-scroll px-6 py-5"
        ref={scroll}
        role="log"
        aria-label="Sample agent conversation"
      >
        <div class="mb-6">
          <AgentMessage
            message={{
              ...DEPLOY_TRACE,
              author: { kind: 'user', userId: 'demo-jacob' },
              parts: [
                {
                  kind: 'text',
                  text: coding()
                    ? DEPLOY_PROMPT
                    : 'What’s left before Thursday’s launch, and who owns it?',
                },
              ],
              stop: null,
            }}
            inFlight={false}
          />
        </div>
        <div class="mb-3 flex items-center gap-2 text-sm font-medium">
          <Show when={coding()} fallback={<MacroLogo class="size-5" />}>
            <CursorIcon class="size-5" />
          </Show>
          {coding() ? 'Cursor' : 'Macro'}
        </div>
        <AgentMessage
          message={
            coding()
              ? DEPLOY_TRACE
              : {
                  ...DEPLOY_TRACE,
                  parts: [
                    {
                      kind: 'thought',
                      text: 'The launch plan and team conversation have the owners and remaining work. I’ll bring those together into a short checklist.',
                    },
                    {
                      kind: 'tool_use',
                      id: 'read-plan',
                      name: { kind: 'native', name: 'Read' },
                      status: 'completed',
                      detail: { kind: 'read', paths: ['Q3 launch plan'] },
                    },
                    {
                      kind: 'text',
                      text: '**Julia** has the announcement ready. **Teo** is reviewing the deploy fix. **Jacob** owns the customer email.\n\nThe customer email and changelog are the last items before launch.',
                    },
                  ],
                }
          }
          inFlight={false}
        />
        <For each={replies()}>
          {(reply) => (
            <div class="my-5">
              <div class="mb-5">
                <AgentMessage
                  message={{
                    ...DEPLOY_TRACE,
                    turn: 1,
                    author: { kind: 'user', userId: 'demo-jacob' },
                    parts: [{ kind: 'text', text: reply.prompt }],
                    stop: null,
                  }}
                  inFlight={false}
                />
              </div>
              <AgentMessage
                message={{
                  ...DEPLOY_TRACE,
                  turn: 1,
                  parts: reply.answer
                    ? [{ kind: 'text', text: reply.answer }]
                    : [],
                  stop: reply.answer ? { kind: 'end_turn' } : null,
                }}
                inFlight={!reply.answer}
              />
            </div>
          )}
        </For>
      </div>
      <DemoComposer
        label={coding() ? 'Ask about the deploy fix' : 'Ask about the launch'}
        onSend={props.demo.ask}
        busy={props.demo.busy()}
      />
    </>
  );
}

export default function HomepageWorkspace(props: { demo: WorkspaceDemo }) {
  const title = () =>
    props.demo.page() === 'agents' && props.demo.session() !== 'roster'
      ? props.demo.session() === 'cursor'
        ? 'Fix the deploy pipeline'
        : 'Plan Thursday’s launch'
      : TITLES[props.demo.page()];
  return (
    <div class="workspace-demo-panel" data-workspace-page={props.demo.page()}>
      <Show when={props.demo.page() !== 'calendar'}>
        <ViewShell.TopBar class="gap-2">
          <Show when={props.demo.page() === 'documents'}>
            <span class="text-xs text-ink-muted">My Files</span>
            <CaretRightIcon class="size-3 text-ink-muted" />
          </Show>
          <Show
            when={
              props.demo.page() === 'messages' ||
              props.demo.page() === 'documents' ||
              props.demo.page() === 'spreadsheet'
            }
          >
            <NavGlyph
              icon={ICONS[props.demo.page()]}
              class="size-4 text-ink-muted"
            />
          </Show>
          <span class="min-w-0 truncate text-sm font-medium">{title()}</span>
          <Show
            when={
              props.demo.page() === 'documents' ||
              props.demo.page() === 'messages'
            }
          >
            <Button
              variant="ghost"
              size="icon-sm"
              label="More options"
              disabled
            >
              <DotsIcon class="size-4" />
            </Button>
          </Show>
          <span class="flex-1" />
          <Show
            when={
              props.demo.page() === 'documents' ||
              props.demo.page() === 'spreadsheet'
            }
          >
            <Button variant="ghost" size="sm" disabled>
              <ShareIcon class="size-3" />
              Share
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              label="Document details"
              disabled
            >
              <InfoIcon class="size-4" />
            </Button>
          </Show>
          <Show when={props.demo.page() === 'messages'}>
            <Button
              variant="ghost"
              size="icon-sm"
              label="Channel attachments"
              disabled
            >
              <PaperclipIcon class="size-4" />
            </Button>
            <Button variant="ghost" size="sm" disabled>
              <PhoneIcon class="size-4" />
              Call
            </Button>
          </Show>
        </ViewShell.TopBar>
      </Show>
      <Suspense
        fallback={
          <div class="grid flex-1 place-items-center text-sm text-ink-muted">
            Loading workspace…
          </div>
        }
      >
        <For each={PAGES}>
          {(page) => (
            <Show when={props.demo.visited().has(page)}>
              <div
                class="workspace-demo-page"
                hidden={props.demo.page() !== page}
                inert={props.demo.page() !== page}
              >
                <Switch>
                  <Match when={page === 'messages'}>
                    <ChannelDemo demo={props.demo} />
                  </Match>
                  <Match when={page === 'documents'}>
                    <DocumentDemo demo={props.demo} />
                  </Match>
                  <Match when={page === 'tasks'}>
                    <TasksDemo demo={props.demo} />
                  </Match>
                  <Match when={page === 'agents'}>
                    <AgentDemo demo={props.demo} />
                  </Match>
                  <Match when={page === 'calendar'}>
                    <CalendarDemo />
                  </Match>
                  <Match when={page === 'email'}>
                    <div class="workspace-demo-scroll workspace-demo-email p-4">
                      <Email />
                    </div>
                  </Match>
                  <Match when={page === 'spreadsheet'}>
                    <div class="workspace-demo-scroll workspace-demo-sheet">
                      <Spreadsheet />
                    </div>
                  </Match>
                  <Match when={page === 'crm'}>
                    <Crm />
                  </Match>
                </Switch>
              </div>
            </Show>
          )}
        </For>
      </Suspense>
    </div>
  );
}
