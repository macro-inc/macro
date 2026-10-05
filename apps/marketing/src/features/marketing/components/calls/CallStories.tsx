import CaretRight from '@phosphor/caret-right.svg';
import ListIcon from '@phosphor/list.svg';
import ListChecks from '@phosphor/list-checks.svg';
import Newspaper from '@phosphor/newspaper.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import Sparkle from '@phosphor/sparkle.svg';
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
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoCursor } from '../DemoCursor';
import { DemoMention, DemoMentionText } from '../DemoMention';
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
import { CallOverlayView, type RemoteTile } from './CallOverlay';
import {
  CallRecordBody,
  CallRecordTopBar,
  createCallPlayback,
  type TranscriptControls,
} from './CallRecord';
import {
  announcementReview,
  type CallPerson,
  helpCenterReview,
  inviteDesignReview,
  inviteTriage,
  launchCheckIn,
  onboardingWalkthrough,
  pricingFeedback,
  type SampleCall,
  weeklyPlanning,
} from './call-fixtures';
import { createDemoPointer } from './demo-pointer';
import '../workspace/dummy-workspace.css';
import '../demo-markdown.css';
import './call-stories.css';

function FlowPointer(props: {
  pointer: Accessor<{ x: number; y: number } | undefined>;
  clicking: boolean;
}) {
  return (
    <Show when={props.pointer()}>
      {(p) => (
        <DemoCursor
          label="Jacob"
          class="call-flow-pointer"
          clicking={props.clicking}
          style={{ transform: `translate(${p().x}px, ${p().y}px)` }}
        />
      )}
    </Show>
  );
}

/** Hero: the full call record from CallBlockAdapter, local and interactive. */
export function CallHeroDemo() {
  const playback = createCallPlayback(launchCheckIn.duration);
  return (
    <ProductDemo label="Launch check-in call record">
      <CallRecordTopBar title={launchCheckIn.title} />
      <CallRecordBody
        call={launchCheckIn}
        playback={playback}
        transcriptHeight={420}
      />
    </ProductDemo>
  );
}

const callsByRow: Record<string, SampleCall> = {
  triage: inviteTriage,
  'check-in': launchCheckIn,
  announcement: announcementReview,
  pricing: pricingFeedback,
  weekly: weeklyPlanning,
  onboarding: onboardingWalkthrough,
  'help-center': helpCenterReview,
  design: inviteDesignReview,
};

const earlierCalls: CallListRow[] = [
  {
    id: 'check-in',
    title: 'Launch check-in',
    summary:
      'Launch stays on Thursday. Teo checks both invite paths by Wednesday night.',
    status: 'attended',
    duration: '18m 22s',
    people: ['jacob', 'teo', 'julia'],
    time: '9:48 AM',
  },
  {
    id: 'announcement',
    title: 'Announcement review',
    summary: 'Julia walked through the draft. The pricing paragraph comes out.',
    status: 'attended',
    duration: '9m 41s',
    people: ['julia', 'jacob'],
    time: 'Yesterday',
  },
  {
    id: 'pricing',
    title: 'Pricing page feedback',
    summary: 'Keep the free plan above the fold. Gabriel tests the table.',
    status: 'attended',
    duration: '24m 10s',
    people: ['jacob', 'gabriel', 'julia'],
    time: 'Monday',
  },
  {
    id: 'weekly',
    title: 'Weekly planning',
    summary: 'Launch week. Teo pauses onboarding until the invite fix ships.',
    status: 'attended',
    duration: '31m 5s',
    people: ['jacob', 'julia', 'teo', 'gabriel'],
    time: 'Monday',
  },
  {
    id: 'onboarding',
    title: 'Onboarding walkthrough',
    summary: 'Teo showed the new invite screen. Gabriel wants one fewer step.',
    status: 'missed',
    duration: '16m 48s',
    people: ['teo', 'gabriel'],
    time: '09/18/26',
  },
  {
    id: 'help-center',
    title: 'Help center review',
    summary:
      'Valentina drafted three articles. Julia links them from the post.',
    status: 'missed',
    duration: '14m 2s',
    people: ['valentina', 'julia'],
    time: '09/17/26',
  },
  {
    id: 'design',
    title: 'Invite screen design review',
    summary: 'Keep the team picker first. Teo removes the workspace name step.',
    status: 'attended',
    duration: '22m 40s',
    people: ['jacob', 'teo', 'julia'],
    time: '09/16/26',
  },
];

const triageRow: CallListRow = {
  id: 'triage',
  title: 'Invite bug triage',
  summary:
    'Gabriel reproduced the invite bug on staging. Teo ships the fix today.',
  status: 'missed',
  duration: '12m 4s',
  people: ['teo', 'gabriel'],
  time: '11:02 AM',
};

const channelPeople: CallPerson[] = [
  'jacob',
  'julia',
  'teo',
  'gabriel',
  'valentina',
];

/** The local side of one live call: devices, chat, and who has joined. */
function createCallSession(initial: RemoteTile[]) {
  const [joined, setJoined] = createSignal(false);
  const [connecting, setConnecting] = createSignal(false);
  const [remote, setRemote] = createSignal(initial);
  const [muted, setMuted] = createSignal(false);
  const [cameraOff, setCameraOff] = createSignal(false);
  const [background, setBackground] = createSignal(false);
  const [sharing, setSharing] = createSignal(false);
  const [teamShare, setTeamShare] = createSignal(true);
  const [chatOpen, setChatOpen] = createSignal(false);
  const [chat, setChat] = createSignal<WorkspaceComment[]>([]);
  return {
    joined,
    setJoined: (value: boolean) => {
      setJoined(value);
    },
    connecting,
    setConnecting: (value: boolean) => {
      setConnecting(value);
    },
    remote,
    setRemote: (value: RemoteTile[]) => {
      setRemote(value);
    },
    view: (props: { onLeave: () => void; time: string }) => (
      <div class="call-tab-body">
        <CallOverlayView
          remote={remote()}
          you="jacob"
          connecting={connecting()}
          muted={muted()}
          cameraOff={cameraOff()}
          background={background()}
          sharing={sharing()}
          sharedWithTeam={teamShare()}
          chatOpen={chatOpen()}
          chat={chat()}
          onMute={() => setMuted(!muted())}
          onCamera={() => setCameraOff(!cameraOff())}
          onBackground={() => setBackground(!background())}
          onShareScreen={() => setSharing(!sharing())}
          onShareWithTeam={() => setTeamShare(!teamShare())}
          onChat={() => setChatOpen(!chatOpen())}
          onSendChat={(body) =>
            setChat((list) => [
              ...list,
              {
                id: `chat-${list.length}`,
                person: 'jacob',
                body,
                time: props.time,
              },
            ])
          }
          onLeave={() => {
            setJoined(false);
            setChatOpen(false);
            setSharing(false);
            props.onLeave();
          }}
        />
      </div>
    ),
  };
}

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
    id: 'thursday',
    person: 'jacob',
    body: 'Launch is still Thursday at 9. If anything blocks it, say so in here.',
    time: '10:12 AM',
  },
  {
    id: 'help',
    person: 'valentina',
    body: 'Help center articles are drafted and linked in the launch plan.',
    time: '10:20 AM',
  },
  {
    id: 'draft',
    person: 'julia',
    body: 'Announcement draft is in the launch plan. Comments welcome.',
    time: '10:31 AM',
  },
  {
    id: 'repro',
    person: 'gabriel',
    body: 'I can reproduce the invite bug on staging. New accounts only.',
    time: '10:46 AM',
  },
  {
    id: 'hop-on',
    person: 'teo',
    body: '@[Gabriel Birman](demo-mention:gabriel) hop on a call? I want to see it before I touch sign-up.',
    time: '10:49 AM',
  },
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
  let frame!: HTMLDivElement;
  const [automatic, setAutomatic] = createSignal(true);
  const [phase, setPhase] = createSignal(0);
  const [live, setLive] = createSignal(true);
  const [activeFor, setActiveFor] = createSignal('12:03');
  const [tab, setTab] = createSignal<ChannelTab>('messages');
  const [opened, setOpened] = createSignal<string>();
  const [messages, setMessages] = createSignal(duringCall);
  const session = createCallSession([
    { person: 'gabriel', video: true, speaking: true },
    { person: 'teo', video: false },
  ]);
  const end = () => {
    setLive(false);
    if (tab() === 'call') setTab('messages');
  };
  const finish = () => {
    setAutomatic(false);
    end();
    setTab('calls');
    setOpened('triage');
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 6,
    reset: () => {},
    reduced: finish,
    delay: (step) => [0, 1000, 1000, 1000, 400, 1100, 400][step] ?? 1000,
    advance: (step) => {
      setPhase(step);
      if (step === 1) setActiveFor('12:04');
      if (step === 2) end();
      if (step === 4) setTab('calls');
      if (step === 6) finish();
    },
  });
  const interact = () => {
    setAutomatic(false);
    playback.pause();
  };
  const pointer = createDemoPointer({
    frame: () => frame,
    active: automatic,
    target: () =>
      [
        undefined,
        undefined,
        '[data-channel-tab="calls"]',
        '[data-channel-tab="calls"]',
        '[data-call-row="triage"]',
        '[data-call-row="triage"]',
      ][phase()],
  });
  return (
    <div ref={root} class="call-flow">
      <div ref={frame} class="call-flow-frame" onFocusIn={interact}>
        <ProductDemo
          label="A call ends and its recording appears in the channel"
          onInteract={interact}
          height={480}
          mobileHeight={620}
        >
          <LaunchChannel
            tab={tab}
            setTab={setTab}
            live={live}
            session={session}
            messages={messages}
            onSend={appendMessage(setMessages, '11:03 AM')}
            activeFor={activeFor}
            rows={() => (live() ? earlierCalls : [triageRow, ...earlierCalls])}
            fresh={() => (phase() >= 4 ? 'triage' : undefined)}
            opened={opened}
            setOpened={setOpened}
            time="10:58 AM"
            interact={interact}
          />
        </ProductDemo>
        <FlowPointer
          pointer={pointer}
          clicking={phase() === 3 || phase() === 5}
        />
      </div>
    </div>
  );
}

/** Section 2: click a transcript line, the recording seeks, follow mode returns. */
export function CallTranscriptDemo() {
  let root!: HTMLDivElement;
  let frame!: HTMLDivElement;
  let scroller!: HTMLDivElement;
  const [automatic, setAutomatic] = createSignal(true);
  const [phase, setPhase] = createSignal(0);
  const call = launchCheckIn;
  const player = createCallPlayback(call.duration);
  let transcript: TranscriptControls | undefined;
  let visitorScrolled = false;
  const decision = call.segments.find((segment) => segment.id === 'verify')!;
  const finish = () => {
    setAutomatic(false);
    if (player.seconds() !== decision.at) player.seek(decision.at);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 7,
    reset: () => {},
    reduced: finish,
    delay: (step) => [0, 1000, 700, 350, 1300, 1100, 600, 350][step] ?? 1000,
    advance: (step) => {
      setPhase(step);
      if (step === 3) player.seek(decision.at);
      if (step === 4) transcript?.wheelAway();
      if (step === 7) {
        transcript?.resync();
        setAutomatic(false);
      }
    },
  });
  const interact = () => {
    setAutomatic(false);
    playback.pause();
  };
  const pointer = createDemoPointer({
    frame: () => frame,
    active: automatic,
    target: () =>
      [
        undefined,
        '[data-segment="verify"]',
        '[data-segment="verify"]',
        '[data-segment="verify"]',
        '.call-transcript-scroll',
        '[data-sync-video]',
        '[data-sync-video]',
      ][phase()],
  });
  // Opens scrolled to the recording's controls and the transcript.
  onMount(() => {
    const align = () => {
      if (visitorScrolled) return;
      const section = scroller.querySelector<HTMLElement>(
        '[data-call-section="transcript"]'
      );
      if (!section) return;
      const box = scroller.getBoundingClientRect();
      const bounds = section.getBoundingClientRect();
      scroller.scrollTop = Math.max(
        0,
        scroller.scrollTop + bounds.bottom - box.bottom + 28
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
      <div ref={frame} class="call-flow-frame" onFocusIn={interact}>
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
        <FlowPointer
          pointer={pointer}
          clicking={phase() === 2 || phase() === 6}
        />
      </div>
    </div>
  );
}

const inviteMention = {
  id: 'invite',
  label: 'Fix the team invite handoff',
  kind: 'task' as const,
  status: 'In Progress' as const,
};

/** ItemPreview inline in a tool row. */
function TaskChip() {
  return (
    <span class="call-item-chip">
      <ListChecks class="size-4 shrink-0 text-task" />
      <span class="truncate">Fix the team invite handoff</span>
    </span>
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

const toolRows = [
  () => (
    <ToolRow icon={ListIcon} status="4 items">
      <span class="min-w-0 truncate">
        Filter for <span class="text-ink">call</span> ordered by{' '}
        <span class="text-ink">recently updated</span>
      </span>
    </ToolRow>
  ),
  () => (
    <ToolRow icon={Newspaper}>
      <span class="min-w-0 truncate">
        Read <span class="text-ink">call transcript</span>
      </span>
    </ToolRow>
  ),
  () => (
    <ToolRow icon={Newspaper}>
      <span class="shrink-0">
        Read <span class="text-ink">document</span>
      </span>
      <span class="shrink-0 text-ink-placeholder">·</span>
      <TaskChip />
    </ToolRow>
  ),
  () => (
    <ToolRow icon={PencilSimple}>
      <span class="shrink-0">Edit</span>
      <TaskChip />
    </ToolRow>
  ),
];

const callNote =
  'From this morning’s launch check-in: Teo checks both invite paths on staging by Wednesday night. Julia holds the announcement until he confirms, then sends it Thursday morning.';

/** Section 3: @Macro reads the call and updates the task it was about. */
export function CallFollowupDemo() {
  let root!: HTMLDivElement;
  const w = createDummyWorkspace('tasks');
  w.open('tasks', 'invite');
  const original = w.data.tasks.find((task) => task.id === 'invite')!;
  const description = original.description;
  w.updateTask('invite', { steps: [], comments: [] });
  const [tools, setTools] = createSignal(1);
  const [done, setDone] = createSignal(false);
  const [updated, setUpdated] = createSignal(false);
  const [open, setOpen] = createSignal(true);
  const [followups, setFollowups] = createSignal<string[]>([]);
  const update = () => {
    if (updated()) return;
    setUpdated(true);
    w.updateTask('invite', {
      description: `${description}\n\n${callNote}`,
      steps: [
        {
          id: 'new',
          text: 'New accounts land in the invited team',
          done: false,
        },
        { id: 'existing', text: 'Existing accounts switch teams', done: false },
        { id: 'post', text: 'Post in #launch when both pass', done: false },
      ],
    });
  };
  const finish = () => {
    setTools(4);
    update();
    setDone(true);
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
        mobileHeight={880}
      >
        <div class="call-split">
          <section class="call-pane call-agent-pane" aria-label="Agent session">
            <ViewShell.TopBar class="call-bar">
              <Sparkle class="size-4 shrink-0 text-ink-muted" />
              <span class="truncate text-sm font-medium">
                Update Teo’s invite task
              </span>
            </ViewShell.TopBar>
            <div class="dummy-scroll call-agent-log">
              <div class="flex w-full flex-col items-end gap-0.5">
                <UserMessageBubble>
                  <span class="text-base">
                    <DemoMentionText text="@[Macro](demo-mention:macro), use this morning’s launch check-in to update Teo’s invite task." />
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
                        <For each={toolRows.slice(0, tools())}>
                          {(row) => row()}
                        </For>
                      </div>
                    </Show>
                  </div>
                </Show>
                <Show when={done()}>
                  <div class="call-agent-text">
                    Updated <DemoMention item={inviteMention} /> from the launch
                    check-in. Teo checks both invite paths on staging by
                    Wednesday night, and Julia holds the announcement until he
                    confirms. I added both paths to the checklist.
                  </div>
                </Show>
              </div>
              <For each={followups()}>
                {(text) => (
                  <div class="mt-6 flex w-full flex-col items-end">
                    <UserMessageBubble>{text}</UserMessageBubble>
                  </div>
                )}
              </For>
            </div>
            <div class="dummy-composer call-agent-composer">
              <ChannelComposer
                agent
                richMentions
                label="Message the agent"
                placeholder="Message the agent, @mention anything"
                onSend={(text) => {
                  playback.pause();
                  finish();
                  setFollowups((items) => [...items, text]);
                }}
              />
            </div>
          </section>
          <section
            class="call-pane call-task-pane"
            aria-label="Task"
            data-updated={updated() ? 'true' : undefined}
          >
            <Show
              when={
                w.contentView() === 'tasks' && w.selected() === 'invite'
                  ? task()
                  : undefined
              }
              fallback={<ProductWorkspace workspace={w} />}
            >
              {(item) => <TaskNotebook workspace={w} task={item()} />}
            </Show>
          </section>
        </div>
      </ProductDemo>
    </div>
  );
}

const joiners: RemoteTile[] = [
  { person: 'julia', video: true, speaking: true },
  { person: 'teo', video: false, muted: true },
  { person: 'gabriel', video: true },
];

const beforeCall: WorkspaceComment[] = [
  {
    id: 'help',
    person: 'valentina',
    body: 'Help center articles for the new invite flow are drafted.',
    time: '8:52 AM',
  },
  {
    id: 'thursday',
    person: 'jacob',
    body: 'Two days to launch. Anything still open?',
    time: '9:05 AM',
  },
  {
    id: 'staging',
    person: 'gabriel',
    body: 'Staging is green again. The invite flow still needs a second look.',
    time: '9:12 AM',
  },
  {
    id: 'draft',
    person: 'julia',
    body: 'Announcement draft is ready. Can we talk through the invite timing before I schedule it?',
    time: '9:20 AM',
    documentId: 'plan',
  },
  {
    id: 'around',
    person: 'teo',
    body: 'Yes, I’m around for the next half hour.',
    time: '9:24 AM',
  },
];

/** Section 4: Call in the channel header opens the call in the channel's Call tab. */
export function CallStartDemo() {
  let root!: HTMLDivElement;
  let frame!: HTMLDivElement;
  const [automatic, setAutomatic] = createSignal(true);
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
    setAutomatic(false);
    start();
    session.setConnecting(false);
    session.setRemote(joiners);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 5,
    reset: () => {},
    reduced: finish,
    delay: (step) => [0, 900, 700, 350, 1100, 1100][step] ?? 1000,
    advance: (step) => {
      setPhase(step);
      if (step === 3) {
        setAutomatic(false);
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
  const interact = () => {
    setAutomatic(false);
    playback.pause();
  };
  const pointer = createDemoPointer({
    frame: () => frame,
    active: automatic,
    target: () =>
      [undefined, '[data-channel-call]', '[data-channel-call]'][phase()],
  });
  return (
    <div ref={root} class="call-flow">
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
            rows={() => earlierCalls}
            opened={opened}
            setOpened={setOpened}
            time="9:31 AM"
            interact={interact}
          />
        </ProductDemo>
        <FlowPointer pointer={pointer} clicking={phase() === 2} />
      </div>
    </div>
  );
}
