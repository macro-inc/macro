import CaretRight from '@phosphor/caret-right.svg';
import ListIcon from '@phosphor/list.svg';
import ListChecks from '@phosphor/list-checks.svg';
import Newspaper from '@phosphor/newspaper.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import Sparkle from '@phosphor/sparkle.svg';
import X from '@phosphor/x.svg';
import { UserMessageBubble } from '@ui/components/UserMessageBubble';
import {
  type Accessor,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import type { WorkspaceComment } from '../../core/dummy-workspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoCursor } from '../DemoCursor';
import { ViewShell } from '../DemoWorkspaceChrome';
import { ChannelComposer } from '../email/frozen/ChannelComposer';
import { ProductDemo } from '../product/ProductPage';
import { ProductWorkspace } from '../product/ProductWorkspace';
import { TaskNotebook } from '../workspace/frozen/TaskNotebook';
import {
  ActiveCallBanner,
  type CallListRow,
  ChannelCallsList,
  ChannelMessages,
  ChannelParticipants,
  type ChannelTab,
  ChannelTopBar,
  JoinCallEmptyState,
} from './CallChannel';
import { CallFollowupAnswer } from './CallFollowupAnswer';
import type { RemoteTile } from './CallOverlay';
import { createCallSession } from './CallSession';
import { createCallProject, TRAINING_TITLE } from './call-project';
import { createDemoPointer } from './demo-pointer';

export { CallHeroDemo } from './CallHero';

import {
  CallRecordBody,
  CallRecordTopBar,
  createCallPlayback,
  type TranscriptControls,
} from './CallRecord';
import {
  type CallPerson,
  rolloutCheckIn,
  rolloutPlanning,
  type SampleCall,
  trainingReview,
} from './call-fixtures';
import '../workspace/dummy-workspace.css';
import '../demo-markdown.css';
import './call-stories.css';

const callsByRow: Record<string, SampleCall> = {
  training: trainingReview,
  'check-in': rolloutCheckIn,
  planning: rolloutPlanning,
};

const earlierCalls: CallListRow[] = [
  {
    id: 'check-in',
    title: rolloutCheckIn.title,
    transcript: rolloutCheckIn.segments
      .map((segment) => segment.text)
      .join(' '),
    summary: 'Julia leads Thursday’s training at 10.',
    status: 'attended',
    duration: '18m 22s',
    people: ['jacob', 'teo', 'julia'],
    time: '9:48 AM',
  },
  {
    id: 'planning',
    title: rolloutPlanning.title,
    transcript: rolloutPlanning.segments
      .map((segment) => segment.text)
      .join(' '),
    summary: 'Training is Thursday at 10. Teo prepares the session.',
    status: 'attended',
    duration: '14m 10s',
    people: ['jacob', 'teo', 'julia'],
    time: 'Yesterday',
  },
];
const trainingRow: CallListRow = {
  id: 'training',
  title: trainingReview.title,
  transcript: trainingReview.segments.map((segment) => segment.text).join(' '),
  summary: 'Keep it to 30 minutes. Julia finishes the slides.',
  status: 'missed',
  duration: '12m 4s',
  people: ['teo', 'julia'],
  time: '11:02 AM',
};

const channelPeople: CallPerson[] = [
  'jacob',
  'julia',
  'teo',
  'gabriel',
  'valentina',
];

/**
 * ChannelDetail for #launch: the tab strip, the live call, its Calls tab,
 * and the call records it opens. Walkthroughs drive it through `state`.
 */
function LaunchChannel(props: {
  tab: Accessor<ChannelTab>;
  setTab: (tab: ChannelTab) => void;
  live: Accessor<boolean>;
  session: ReturnType<typeof createCallSession>;
  messages: Accessor<WorkspaceComment[]>;
  onSend: (body: string) => void;
  activeFor: Accessor<string>;
  rows: Accessor<CallListRow[]>;
  fresh?: Accessor<string | undefined>;
  opened: Accessor<string | undefined>;
  setOpened: (id: string | undefined) => void;
  time: string;
  interact: () => void;
}) {
  const [search, setSearch] = createSignal('');
  const s = props.session;
  const join = () => {
    props.interact();
    s.setConnecting(false);
    s.setJoined(true);
    props.setTab('call');
  };
  const record = () => {
    const id = props.opened();
    return id ? callsByRow[id] : undefined;
  };
  return (
    <Show
      when={record()}
      keyed
      fallback={
        <>
          <ChannelTopBar
            tab={props.tab()}
            onTab={(next) => {
              props.interact();
              props.setTab(next);
            }}
            live={props.live()}
            callButton={s.joined() ? undefined : props.live() ? 'join' : 'call'}
            onCall={join}
          />
          <div class="call-channel-body">
            <Switch
              fallback={
                <ChannelMessages
                  messages={props.messages()}
                  banner={
                    <Show when={props.live() && !s.joined()}>
                      <ActiveCallBanner
                        duration={props.activeFor()}
                        onJoin={join}
                      />
                    </Show>
                  }
                  onSend={props.onSend}
                />
              }
            >
              <Match when={props.tab() === 'call' && s.joined()}>
                {s.view({
                  time: props.time,
                  onLeave: () => props.setTab('messages'),
                })}
              </Match>
              <Match when={props.tab() === 'call'}>
                <JoinCallEmptyState
                  people={s.remote().map((tile) => tile.person)}
                  onJoin={join}
                />
              </Match>
              <Match when={props.tab() === 'calls'}>
                <ChannelCallsList
                  rows={props.rows()}
                  fresh={props.fresh?.()}
                  search={search()}
                  onSearch={setSearch}
                  onOpen={(id) => {
                    props.interact();
                    props.setOpened(id);
                  }}
                />
              </Match>
              <Match when={props.tab() === 'participants'}>
                <ChannelParticipants people={channelPeople} />
              </Match>
              <Match when={props.tab() === 'attachments'}>
                <p class="call-empty">No attachments yet.</p>
              </Match>
            </Switch>
          </div>
        </>
      }
    >
      {(call) => (
        <RecordPane
          call={call}
          onBack={() => {
            props.interact();
            props.setOpened(undefined);
          }}
        />
      )}
    </Show>
  );
}

function RecordPane(props: { call: SampleCall; onBack: () => void }) {
  const playback = createCallPlayback(props.call.duration);
  return (
    <>
      <CallRecordTopBar title={props.call.title} onBack={props.onBack} />
      <CallRecordBody
        call={props.call}
        playback={playback}
        transcriptHeight={360}
        class="call-record-compact"
      />
    </>
  );
}

const duringCall: WorkspaceComment[] = [
  {
    id: 'notes',
    person: 'teo',
    body: 'I’ve got the notes open.',
    time: '10:12 AM',
  },
  {
    id: 'slides',
    person: 'julia',
    body: 'Can we go through the slides?',
    time: '10:20 AM',
  },
  { id: 'hop-on', person: 'teo', body: 'Sure, quick call?', time: '10:31 AM' },
  { id: 'ready', person: 'julia', body: 'Yep.', time: '10:49 AM' },
];

const appendMessage =
  (
    set: (update: (list: WorkspaceComment[]) => WorkspaceComment[]) => void,
    time: string
  ) =>
  (body: string) =>
    set((list) => [
      ...list,
      { id: `sent-${list.length}`, person: 'jacob', body, time },
    ]);

/** Section 1: a live call ends and its record appears in the channel's Calls tab. */
export function CallDefaultDemo() {
  let root!: HTMLDivElement;
  const [phase, setPhase] = createSignal(0);
  const [live, setLive] = createSignal(true);
  const [activeFor, setActiveFor] = createSignal('12:03');
  const [tab, setTab] = createSignal<ChannelTab>('calls');
  const [opened, setOpened] = createSignal<string>();
  const [messages, setMessages] = createSignal(duringCall);
  const session = createCallSession([{ person: 'julia' }, { person: 'teo' }]);
  const end = () => {
    setLive(false);
    if (tab() === 'call') setTab('messages');
  };
  const finish = () => {
    end();
    setTab('calls');
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 4,
    reset: () => {},
    reduced: finish,
    delay: (step) => [0, 1000, 1000, 500, 500][step] ?? 1000,
    advance: (step) => {
      setPhase(step);
      if (step === 1) setActiveFor('12:04');
      if (step === 2) end();
      if (step === 4) finish();
    },
  });
  const interact = () => {
    playback.pause();
  };
  return (
    <div ref={root} class="call-flow">
      <div class="call-flow-frame" onFocusIn={interact}>
        <ProductDemo
          label="A call ends and its recording appears in the channel"
          onInteract={interact}
          height={300}
          mobileHeight={390}
        >
          <LaunchChannel
            tab={tab}
            setTab={setTab}
            live={live}
            session={session}
            messages={messages}
            onSend={appendMessage(setMessages, '11:03 AM')}
            activeFor={activeFor}
            rows={() =>
              live() ? earlierCalls : [trainingRow, ...earlierCalls]
            }
            fresh={() => (phase() >= 4 ? 'training' : undefined)}
            opened={opened}
            setOpened={setOpened}
            time="10:58 AM"
            interact={interact}
          />
        </ProductDemo>
      </div>
    </div>
  );
}

/** Section 2: click a transcript line, the recording seeks, follow mode returns. */
export function CallTranscriptDemo() {
  let root!: HTMLDivElement;
  let scroller!: HTMLDivElement;
  const call = rolloutCheckIn;
  const player = createCallPlayback(call.duration);
  let transcript: TranscriptControls | undefined;
  let visitorScrolled = false;
  const decision = call.segments.find((segment) => segment.id === 'owner')!;
  const finish = () => {
    if (player.seconds() !== decision.at) player.seek(decision.at);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 7,
    reset: () => {},
    reduced: finish,
    delay: (step) => [0, 1000, 700, 350, 1300, 1100, 600, 350][step] ?? 1000,
    advance: (step) => {
      if (step === 3) player.seek(decision.at);
      if (step === 4) transcript?.wheelAway();
      if (step === 7) {
        transcript?.resync();
      }
    },
  });
  const interact = () => {
    playback.pause();
  };
  // Opens scrolled to the recording's controls and the transcript.
  onMount(() => {
    const align = () => {
      if (visitorScrolled) return;
      const section = scroller.querySelector<HTMLElement>(
        '[data-call-section="recording"]'
      );
      if (!section) return;
      const box = scroller.getBoundingClientRect();
      const bounds = section.getBoundingClientRect();
      scroller.scrollTop = Math.max(
        0,
        scroller.scrollTop + bounds.top - box.top - 16
      );
    };
    const frameId = requestAnimationFrame(align);
    const resize = new ResizeObserver(align);
    resize.observe(scroller);
    const stop = () => {
      visitorScrolled = true;
    };
    scroller.addEventListener('wheel', stop);
    scroller.addEventListener('touchmove', stop);
    onCleanup(() => {
      cancelAnimationFrame(frameId);
      resize.disconnect();
      scroller.removeEventListener('wheel', stop);
      scroller.removeEventListener('touchmove', stop);
    });
  });
  return (
    <div ref={root} class="call-flow">
      <div class="call-flow-frame" onFocusIn={interact}>
        <ProductDemo
          label="Jump to a moment from its transcript line"
          onInteract={interact}
          height={600}
          mobileHeight={660}
        >
          <CallRecordTopBar title={call.title} />
          <CallRecordBody
            call={call}
            playback={player}
            transcriptHeight={300}
            class="call-record-compact"
            scrollRef={(element) => {
              scroller = element;
            }}
            transcriptControls={(controls) => {
              transcript = controls;
            }}
          />
        </ProductDemo>
      </div>
    </div>
  );
}

/** ItemPreview inline in a tool row. */
function TaskChip(props: { onOpen: (button: HTMLButtonElement) => void }) {
  return (
    <button
      type="button"
      class="call-item-preview"
      onClick={(event) => props.onOpen(event.currentTarget)}
    >
      <ListChecks class="size-3.5 shrink-0 text-task" />
      <span class="min-w-0 truncate">{TRAINING_TITLE}</span>
    </button>
  );
}

/** BaseTool in a tool group: icon, description, optional result toggle. */
function ToolRow(props: {
  icon: (props: JSX.SvgSVGAttributes<SVGSVGElement>) => JSX.Element;
  children: JSX.Element;
  status?: string;
}) {
  return (
    <div class="call-tool-row" data-tool-row>
      <props.icon class="size-4 shrink-0 text-ink-extra-muted" />
      <div class="call-tool-text">{props.children}</div>
      <Show when={props.status}>
        <span class="flex shrink-0 items-center gap-1 text-xs text-ink-extra-muted">
          {props.status}
          <CaretRight class="size-3" />
        </span>
      </Show>
    </div>
  );
}

const toolRows = (openTask: (button: HTMLButtonElement) => void) => [
  () => (
    <ToolRow icon={ListIcon} status="3 items">
      <span class="min-w-0 truncate">
        Filter for <span class="text-ink">call</span> ordered by{' '}
        <span class="text-ink">recently updated</span>
      </span>
    </ToolRow>
  ),
  () => (
    <ToolRow icon={Newspaper}>
      Read <span class="text-ink">call transcript</span>
    </ToolRow>
  ),
  () => (
    <ToolRow icon={Newspaper}>
      <span class="shrink-0">
        Read <span class="text-ink">document</span>
      </span>
      <span class="shrink-0 text-ink-placeholder">·</span>
      <TaskChip onOpen={openTask} />
    </ToolRow>
  ),
  () => (
    <ToolRow icon={PencilSimple}>
      <span class="shrink-0">Edit</span>
      <TaskChip onOpen={openTask} />
    </ToolRow>
  ),
];

const callNote =
  'From the training check-in: Julia leads Thursday’s training at 10. Teo sends his notes today.';

/** Section 3: @Macro reads the call and updates the task it was about. */
export function CallFollowupDemo() {
  let root!: HTMLDivElement;
  const w = createCallProject();
  w.open('tasks', 'invite');
  w.updateTask('invite', { steps: [], comments: [] });
  const [tools, setTools] = createSignal(1);
  const [done, setDone] = createSignal(false);
  const [updated, setUpdated] = createSignal(false);
  const [open, setOpen] = createSignal(true);
  const [followups, setFollowups] = createSignal<string[]>([]);
  const [openedItem, setOpenedItem] = createSignal<'call' | 'task'>();
  let sourceTrigger: HTMLButtonElement | undefined;
  let closeItemButton: HTMLButtonElement | undefined;
  const sourcePlayer = createCallPlayback(rolloutCheckIn.duration);
  const openItem = (item: 'call' | 'task', button: HTMLButtonElement) => {
    playback.pause();
    sourcePlayer.pause();
    sourceTrigger = button;
    if (item === 'task') w.open('tasks', 'invite');
    setOpenedItem(item);
    closeItemButton?.focus({ preventScroll: true });
  };
  const closeItem = () => {
    sourcePlayer.pause();
    setOpenedItem(undefined);
    sourceTrigger?.focus({ preventScroll: true });
  };
  const openSource = (button: HTMLButtonElement) => openItem('call', button);
  const openTask = (button: HTMLButtonElement) => openItem('task', button);
  const update = () => {
    if (updated()) return;
    setUpdated(true);
    w.updateTask('invite', {
      owner: 'julia',
      description: callNote,
      steps: [
        {
          id: 'new',
          text: 'Get Teo’s notes today',
          done: false,
        },
        {
          id: 'existing',
          text: 'Update the slides',
          done: false,
        },
        {
          id: 'post',
          text: 'Send the invite',
          done: false,
        },
      ],
    });
  };
  const finish = () => {
    setTools(4);
    update();
    setDone(true);
    setOpen(false);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 4,
    reset: () => {},
    reduced: finish,
    delay: (step) => [0, 800, 800, 800, 1000][step] ?? 800,
    advance: (step) => {
      if (step <= 3) setTools(step + 1);
      if (step === 3) update();
      if (step === 4) finish();
    },
  });
  const task = () => w.data.tasks.find((item) => item.id === 'invite');
  return (
    <div ref={root}>
      <ProductDemo
        label="Ask @Macro to update a task from a call"
        onInteract={playback.pause}
        height={560}
        mobileHeight={600}
      >
        <div
          class="call-split"
          data-opened={openedItem()}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && openedItem()) {
              event.stopPropagation();
              closeItem();
            }
          }}
        >
          <section class="call-pane call-agent-pane" aria-label="Agent session">
            <ViewShell.TopBar class="call-bar">
              <Sparkle class="size-4 shrink-0 text-ink-muted" />
              <span class="truncate text-sm font-medium">
                Update the training task
              </span>
            </ViewShell.TopBar>
            <div class="dummy-scroll call-agent-log">
              <div class="flex w-full flex-col items-end gap-0.5">
                <UserMessageBubble>
                  <span class="text-base">
                    Update the training task from my last call.
                  </span>
                </UserMessageBubble>
              </div>
              <div class="call-agent-reply">
                <Show when={tools() > 0}>
                  <div class="min-w-0 text-sm leading-6 text-ink-extra-muted">
                    <button
                      type="button"
                      aria-expanded={open()}
                      class="call-tool-group group"
                      onClick={() => {
                        playback.pause();
                        setOpen(!open());
                      }}
                    >
                      <span
                        classList={{ 'call-shimmer': !done() }}
                        data-tool-title
                      >
                        {done() ? 'Called' : 'Calling'} {tools()}{' '}
                        {tools() === 1 ? 'tool' : 'tools'}
                      </span>
                      <CaretRight
                        aria-hidden="true"
                        class="size-4 shrink-0 opacity-0 transition-transform group-hover:opacity-100"
                        classList={{ 'rotate-90': open() }}
                      />
                    </button>
                    <Show when={open()}>
                      <div class="flex min-w-0 flex-col pl-6">
                        <For each={toolRows(openTask).slice(0, tools())}>
                          {(row) => row()}
                        </For>
                      </div>
                    </Show>
                  </div>
                </Show>
                <Show when={done() && task()}>
                  {(updatedTask) => (
                    <CallFollowupAnswer
                      task={updatedTask()}
                      onOpenTask={openTask}
                      onOpenCall={openSource}
                    />
                  )}
                </Show>
              </div>
              <For each={followups()}>
                {(text) => (
                  <div class="mt-6 flex w-full flex-col items-end">
                    <UserMessageBubble>{text}</UserMessageBubble>
                  </div>
                )}
              </For>
              <Show when={followups().length > 0}>
                <p class="text-sm text-ink-muted">
                  This sample keeps your message here. Open Macro to work with
                  an agent.
                </p>
              </Show>
            </div>
            <div class="dummy-composer call-agent-composer">
              <ChannelComposer
                agent
                richMentions
                label="Message the agent"
                placeholder="Message the agent, @mention anything"
                onSend={(text) => {
                  playback.pause();
                  setFollowups((items) => [...items, text]);
                }}
              />
            </div>
          </section>
          <Show when={openedItem()}>
            <section
              class="call-pane call-task-pane"
              aria-label="Linked item"
              data-updated={updated() ? 'true' : undefined}
            >
              <ViewShell.TopBar class="call-linked-header">
                <span class="truncate text-sm font-medium">
                  {openedItem() === 'call'
                    ? rolloutCheckIn.title
                    : TRAINING_TITLE}
                </span>
                <button
                  ref={closeItemButton}
                  type="button"
                  aria-label="Close linked item"
                  class="call-close-item"
                  onClick={closeItem}
                >
                  <X class="size-4" />
                </button>
              </ViewShell.TopBar>
              <div class="call-linked-content">
                <Show
                  when={openedItem() === 'call'}
                  fallback={
                    <Show
                      when={
                        w.contentView() === 'tasks' && w.selected() === 'invite'
                          ? task()
                          : undefined
                      }
                      fallback={<ProductWorkspace workspace={w} />}
                    >
                      {(item) => (
                        <TaskNotebook
                          workspace={w}
                          task={item()}
                          hideCollectionNavigation
                        />
                      )}
                    </Show>
                  }
                >
                  <CallRecordBody
                    call={rolloutCheckIn}
                    playback={sourcePlayer}
                    transcriptHeight={250}
                    class="call-record-compact"
                  />
                </Show>
              </div>
            </section>
          </Show>
        </div>
      </ProductDemo>
    </div>
  );
}

const joiners: RemoteTile[] = [
  { person: 'julia' },
  { person: 'teo', muted: true },
  { person: 'gabriel' },
];

const beforeCall: WorkspaceComment[] = [
  {
    id: 'free',
    person: 'teo',
    body: 'Anyone free for a quick call?',
    time: '9:20 AM',
  },
  { id: 'here', person: 'julia', body: 'Yep, I’m here.', time: '9:21 AM' },
  { id: 'same', person: 'gabriel', body: 'Same.', time: '9:21 AM' },
  {
    id: 'calling',
    person: 'jacob',
    body: 'Cool, calling now.',
    time: '9:22 AM',
  },
];

/** Section 4: Call in the channel header opens the call in the channel's Call tab. */
export function CallStartDemo() {
  let root!: HTMLDivElement;
  let frame!: HTMLDivElement;
  const [phase, setPhase] = createSignal(0);
  const [tab, setTab] = createSignal<ChannelTab>('messages');
  const [live, setLive] = createSignal(false);
  const [opened, setOpened] = createSignal<string>();
  const [messages, setMessages] = createSignal(beforeCall);
  const session = createCallSession([]);
  const start = () => {
    setLive(true);
    session.setJoined(true);
    setTab('call');
  };
  const finish = () => {
    start();
    session.setConnecting(false);
    session.setRemote(joiners);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 5,
    reset: () => {
      setPhase(0);
      setLive(false);
      setTab('messages');
      setOpened(undefined);
      session.setJoined(false);
      session.setConnecting(false);
      session.setRemote([]);
    },
    reduced: finish,
    delay: (step) => [0, 2000, 1400, 500, 1800, 1300][step] ?? 1300,
    advance: (step) => {
      setPhase(step);
      if (step === 3) {
        session.setConnecting(true);
        start();
      }
      if (step === 4) {
        session.setConnecting(false);
        session.setRemote(joiners.slice(0, 2));
      }
      if (step === 5) finish();
    },
  });
  // Revisit the walkthrough without repeatedly resetting a visible call.
  onMount(() => {
    let entered = false;
    let replayOnReturn = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) {
          if (entered) replayOnReturn = true;
          return;
        }
        if (
          replayOnReturn &&
          !matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
          playback.replayIfUntouched();
        }
        entered = true;
        replayOnReturn = false;
      },
      { threshold: 0.25 }
    );
    observer.observe(root);
    onCleanup(() => observer.disconnect());
  });
  const interact = () => {
    setPhase(0);
    playback.pause();
  };
  const pointer = createDemoPointer({
    frame: () => frame,
    active: () => phase() === 1 || phase() === 2,
    target: () => '[data-channel-call]',
  });
  return (
    <div ref={root} class="call-flow call-start-story" data-phase={phase()}>
      <div ref={frame} class="call-flow-frame" onFocusIn={interact}>
        <ProductDemo
          label="Start a call from the channel header"
          onInteract={interact}
          height={530}
          mobileHeight={600}
        >
          <LaunchChannel
            tab={tab}
            setTab={setTab}
            live={live}
            session={{
              ...session,
              // Starting the call from the header: everyone else joins after.
              setJoined: (value: boolean) => {
                if (value) {
                  setLive(true);
                  if (!session.remote().length) session.setRemote(joiners);
                }
                session.setJoined(value);
              },
            }}
            messages={messages}
            onSend={appendMessage(setMessages, '9:31 AM')}
            activeFor={() => '0:42'}
            rows={() => earlierCalls.filter((row) => row.id === 'planning')}
            opened={opened}
            setOpened={setOpened}
            time="9:31 AM"
            interact={interact}
          />
        </ProductDemo>
        <Show when={(phase() === 1 || phase() === 2) && pointer()}>
          {(position) => (
            <div
              class="call-start-pointer-anchor"
              aria-hidden="true"
              style={{
                transform: `translate(${position().x}px, ${position().y}px)`,
              }}
            >
              <DemoCursor
                label=""
                class="call-start-pointer"
                clicking={phase() === 2}
              />
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
