import ArrowLeft from '@phosphor/arrow-left.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import { Button } from '@ui';
import {
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import type {
  WorkspaceComment,
  WorkspaceView,
} from '../../core/dummy-workspace';
import {
  createDummyWorkspace,
  type DummyWorkspace,
} from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoAgentChip } from '../DemoAgentChip';
import { DemoPrDocument } from '../DemoPrDocument';
import { ProductDemo } from '../product/ProductPage';
import { WorkspaceAgents } from '../workspace/WorkspaceAgents';
import { WorkspaceCalendar } from '../workspace/WorkspaceCalendar';
import { WorkspaceChannel } from '../workspace/WorkspaceChannel';
import { WorkspaceDocuments } from '../workspace/WorkspaceDocuments';
import { WorkspaceEmail } from '../workspace/WorkspaceEmail';
import { WorkspaceTasks } from '../workspace/WorkspaceTasks';
import { AgentSession } from './AgentSession';
import {
  AgentAnswer,
  AgentPrompt,
  type AgentToolCall,
  AgentToolGroup,
  AgentTurn,
} from './AgentTranscript';
import { FolderComposerMockup } from './FolderComposerMockup';
import {
  FEEDBACK_BRIEF,
  MEETING_BRIEF,
  seedAgentWorkflows,
} from './workflowData';
import './agent-workflows.css';
import './agent-stories.css';

/** Navigation stays in one pane. Native record viewers share the same editable store. */
function createWorkflowNavigation(w: DummyWorkspace) {
  const [record, setRecord] = createSignal<{
    view: WorkspaceView;
    id?: string;
  }>();
  let trigger: HTMLElement | undefined;
  let frame!: HTMLDivElement;
  const open = (view: WorkspaceView, id?: string) => {
    if (!record() && document.activeElement instanceof HTMLElement)
      trigger = document.activeElement;
    setRecord({ view, id });
    queueMicrotask(() =>
      frame.querySelector<HTMLButtonElement>('[data-workflow-back]')?.focus()
    );
  };
  const back = () => {
    setRecord(undefined);
    queueMicrotask(() => trigger?.isConnected && trigger.focus());
  };
  const linked = {
    ...w,
    selected: () => record()?.id,
    channel: () =>
      record()?.view === 'messages'
        ? (record()?.id ?? w.channel())
        : w.channel(),
    view: () => record()?.view ?? 'messages',
    contentView: () => record()?.view ?? 'messages',
    open,
    openItem: open,
    backToCollection: back,
  } as DummyWorkspace;
  const Frame = (props: { children: JSX.Element }) => (
    <div
      ref={frame}
      class="agent-workflow-frame"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && record()) {
          e.stopPropagation();
          back();
        }
      }}
    >
      <div class="agent-workflow-home" hidden={!!record()} inert={!!record()}>
        {props.children}
      </div>
      <Show when={record()}>
        <div class="agent-workflow-back">
          <Button data-workflow-back variant="plain" size="sm" onClick={back}>
            <ArrowLeft />
            Back to conversation
          </Button>
        </div>
        <Switch>
          <Match when={record()?.view === 'documents'}>
            <WorkspaceDocuments
              workspace={linked}
              relatedContent={
                <Show
                  when={
                    record()?.id === FEEDBACK_BRIEF ||
                    record()?.id === MEETING_BRIEF
                  }
                >
                  <WorkflowSources
                    open={open}
                    meeting={record()?.id === MEETING_BRIEF}
                  />
                </Show>
              }
            />
          </Match>
          <Match when={record()?.view === 'tasks'}>
            <WorkspaceTasks workspace={linked} filter="all" />
          </Match>
          <Match when={record()?.view === 'agents'}>
            <WorkspaceAgents workspace={linked} />
          </Match>
          <Match when={record()?.view === 'messages'}>
            <WorkspaceChannel workspace={linked} />
          </Match>
          <Match when={record()?.view === 'email'}>
            <WorkspaceEmail workspace={linked} tab="all" account="all" />
          </Match>
          <Match when={record()?.view === 'calendar'}>
            <WorkspaceCalendar workspace={linked} />
          </Match>
        </Switch>
      </Show>
    </div>
  );
  return { open, Frame, workspace: { ...w, open, openItem: open } };
}

function WorkflowSources(props: {
  open: (view: WorkspaceView, id?: string) => void;
  meeting?: boolean;
}) {
  return (
    <AgentAnswer
      text={
        'Sources: @[customer-support](agent:support), @[File upload testing notes](agent:notes), and @[Upload size guidance task](agent:task).' +
        (props.meeting
          ? '\n\n@[Dana’s latest email](agent:email) · @[Beacon discovery call](agent:call)'
          : '')
      }
      mentions={{
        support: {
          kind: 'channel',
          onOpen: () => props.open('messages', 'customer-support'),
        },
        notes: {
          kind: 'document',
          onOpen: () => props.open('documents', 'portal-testing'),
        },
        task: {
          kind: 'task',
          onOpen: () => props.open('tasks', 'upload-help'),
        },
        email: {
          kind: 'email',
          onOpen: () => props.open('email', 'beacon-email'),
        },
        call: {
          kind: 'document',
          onOpen: () => props.open('documents', 'beacon-call'),
        },
      }}
    />
  );
}

export function AgentFeedbackWorkflow(props: { workspace: DummyWorkspace }) {
  const w = props.workspace;
  seedAgentWorkflows(w);
  w.setChannel('product-feedback');
  const nav = createWorkflowNavigation(w);
  if (
    !w.data.channels.find((c) => c.id === 'product-feedback')?.messages.length
  )
    w.setData('channels', (c) => c.id === 'product-feedback', 'messages', [
      {
        id: 'feedback-before-1',
        person: 'julia',
        time: '9:34 AM',
        body: 'Beacon hit the upload issue again. added their notes in customer-support',
      },
      {
        id: 'feedback-before-2',
        person: 'teo',
        time: '9:36 AM',
        body: 'thanks. the size warning is already in progress, so we can skip that one',
      },
      {
        id: 'feedback-before-3',
        person: 'valentina',
        time: '9:38 AM',
        body: 'Westlake also asked who’s reviewing their files. same thing as last week',
      },
      {
        id: 'feedback-request',
        person: 'jacob',
        time: '9:41 AM',
        body: '@[Macro](demo-mention:macro), what’s left to fix with client file uploads?',
      },
      {
        id: 'feedback-result',
        replyTo: 'feedback-request',
        person: 'macro',
        time: '9:42 AM',
        body: 'Created Client file upload feedback. Combined the reports and kept the existing upload-help task. Guest access still needs a decision.',
      },
      {
        id: 'feedback-after-1',
        replyTo: 'feedback-request',
        person: 'teo',
        time: '9:44 AM',
        body: 'i’ll take upload recovery. can reproduce it on my phone too',
      },
      {
        id: 'feedback-after-2',
        replyTo: 'feedback-request',
        person: 'julia',
        time: '9:45 AM',
        body: 'i’ll check the reviewer labels with Beacon tomorrow',
      },
      {
        id: 'feedback-after-3',
        person: 'jacob',
        time: '9:47 AM',
        body: 'let’s leave guest access for now. fix those two first',
      },
    ]);
  return (
    <nav.Frame>
      <WorkspaceChannel
        workspace={nav.workspace}
        renderMessageBody={(message) => {
          if (message.id === 'feedback-result')
            return (
              <AgentAnswer
                text={
                  'Two fixes before the next release. I checked @[customer-support](agent:support), @[File upload testing notes](agent:notes), and existing tasks.\n\n- Upload recovery: failed uploads lose selected files. Confirmed in testing.\n- Reviewer visibility: requested by both Beacon and Westlake.\n\nSize guidance is already in progress. Guest access needs a decision.\n\nCreated @[Client file upload feedback](agent:brief) with the open work and sources.'
                }
                mentions={{
                  support: {
                    kind: 'channel',
                    onOpen: () => nav.open('messages', 'customer-support'),
                  },
                  notes: {
                    kind: 'document',
                    onOpen: () => nav.open('documents', 'portal-testing'),
                  },
                  brief: {
                    kind: 'document',
                    onOpen: () => nav.open('documents', FEEDBACK_BRIEF),
                  },
                }}
              />
            );
        }}
      />
    </nav.Frame>
  );
}

/** Keep new output above both the window edge and the site's viewport fade. */
function followAgentOutput(
  scroller: HTMLElement,
  target: HTMLElement,
  host: HTMLElement,
  smooth = false
) {
  const vignette = document.querySelector('.site-page-vignette');
  const fade = vignette
    ? Number.parseFloat(getComputedStyle(vignette, '::after').height) || 0
    : 0;
  const viewport = scroller.getBoundingClientRect();
  const bottom = Math.min(viewport.bottom, window.innerHeight - fade) - 24;
  // Reserve space when the demo extends below the visible part of the page.
  // Otherwise scrollTop clamps before the reply can clear the page fade.
  host.style.setProperty(
    '--agent-scroll-reserve',
    `${Math.max(0, viewport.bottom - bottom)}px`
  );
  const delta = target.getBoundingClientRect().bottom - bottom;
  if (delta > 0) {
    if (smooth)
      scroller.scrollTo({
        top: scroller.scrollTop + delta,
        behavior: 'smooth',
      });
    else scroller.scrollTop += delta;
  }
}

/** A visible request, direct reply, and typed edit in the same shared document. */
export function AgentDeliverableStory() {
  const w = createDummyWorkspace('documents');
  seedAgentWorkflows(w);
  w.open('documents', FEEDBACK_BRIEF);
  const original = w.data.documents.find(
    (doc) => doc.id === FEEDBACK_BRIEF
  )!.body;
  const heading = '\n\n## Before sharing with clients\n\n';
  const checks = [
    'Send a file and confirm the reviewer can open it.',
    'Disconnect halfway through, then retry without choosing the file again.',
    'Check that the client can see who is reviewing the file.',
  ];
  const frames = [heading.trimEnd()];
  let complete = heading;
  for (const check of checks) {
    for (let end = 3; end < check.length + 3; end += 3)
      frames.push(complete + '- [ ] ' + check.slice(0, end));
    complete += '- [ ] ' + check + '\n';
    frames.push(complete.trimEnd());
  }
  let root!: HTMLDivElement;
  let editorFrame!: HTMLDivElement;
  let pendingFrame: number | undefined;
  const [typing, setTyping] = createSignal(false);
  const [responseState, setResponseState] = createSignal('ready');
  const [caret, setCaret] = createSignal<{
    left: number;
    top: number;
    height: number;
  }>();
  w.setData('documents', (doc) => doc.id === FEEDBACK_BRIEF, 'comments', [
    {
      id: 'brief-update-request',
      person: 'julia',
      time: '',
      body: '@[Macro](demo-mention:macro), add a simple test checklist before we share this with clients.',
    },
  ]);
  const reply = (body: string) => {
    const doc = w.data.documents.find((doc) => doc.id === FEEDBACK_BRIEF)!;
    if (doc.comments.some((comment) => comment.id === 'brief-update-result')) {
      w.setData(
        'documents',
        (doc) => doc.id === FEEDBACK_BRIEF,
        'comments',
        (comment) => comment.id === 'brief-update-result',
        'body',
        body
      );
    } else {
      w.setData(
        'documents',
        (doc) => doc.id === FEEDBACK_BRIEF,
        'comments',
        (comments) => [
          ...comments,
          {
            id: 'brief-update-result',
            replyTo: 'brief-update-request',
            person: 'macro' as const,
            time: '',
            body,
          },
        ]
      );
    }
  };
  const reveal = (writing: boolean) => {
    if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = undefined;
      if (writing && !typing()) return;
      const body = root.querySelector<HTMLElement>(
        '[aria-label="Document body"]'
      );
      const log = root.querySelector<HTMLElement>(
        '[aria-label="Document discussion"]'
      );
      const scroller = body?.closest<HTMLElement>('.dummy-scroll');
      if (!body || !scroller) return;
      const last = body.querySelector(
        '.website-demo-markdown'
      )?.lastElementChild;
      const leaf = last?.tagName === 'UL' ? last.lastElementChild : last;
      // Follow the edited line while writing. The final reply only scrolls
      // inside the document pane, independent of the page’s decorative fade.
      const target = writing ? leaf : log;
      if (!target) return;
      const delta =
        target.getBoundingClientRect().bottom -
        scroller.getBoundingClientRect().bottom +
        24;
      if (delta > 0) {
        if (writing) scroller.scrollTop += delta;
        else
          scroller.scrollTo({
            top: scroller.scrollTop + delta,
            behavior: 'smooth',
          });
      }
      if (writing && leaf) {
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        let lastText: Node | undefined;
        while (walker.nextNode()) {
          if (walker.currentNode.textContent?.trim())
            lastText = walker.currentNode;
        }
        const range = document.createRange();
        if (lastText) {
          const length = lastText.textContent?.trimEnd().length ?? 0;
          range.setStart(lastText, Math.max(0, length - 1));
          range.setEnd(lastText, length);
        } else range.selectNodeContents(leaf);
        const end = range.getBoundingClientRect?.();
        if (!end) return;
        const frame = editorFrame.getBoundingClientRect();
        setCaret({
          left: end.right - frame.left,
          top: end.top - frame.top,
          height: end.height || 20,
        });
      }
    });
  };
  const finish = () => {
    w.setData(
      'documents',
      (doc) => doc.id === FEEDBACK_BRIEF,
      'body',
      original + complete.trimEnd()
    );
    setTyping(false);
    setCaret(undefined);
    setResponseState('done');
    reply(
      'Done, Julia. I added three checks to the document: sending a file, retrying after a lost connection, and seeing who reviews it.'
    );
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: frames.length + 3,
    visibilityThreshold: 0.5,
    reset: () => {},
    delay: (step) => {
      if (step <= 2) return 1600;
      if (step === frames.length + 3) return 260;
      return frames[step - 2] === frames[step - 3] ? 150 : 35;
    },
    reduced: finish,
    advance: (step) => {
      if (step === 1) {
        reply('Sure, Julia. I’ll add a short checklist to the document.');
        reveal(false);
      } else if (step <= frames.length + 1) {
        setTyping(true);
        w.setData(
          'documents',
          (doc) => doc.id === FEEDBACK_BRIEF,
          'body',
          original + frames[step - 2]
        );
        reveal(true);
      } else if (step === frames.length + 2) {
        setTyping(false);
        setCaret(undefined);
        setResponseState('settling');
      } else {
        finish();
        reveal(false);
      }
    },
  });
  const pause = () => {
    playback.pause();
    setTyping(false);
    setCaret(undefined);
    if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
    pendingFrame = undefined;
  };
  onCleanup(() => {
    if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
  });
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="Macro adds Julia’s test checklist to the document"
      height={600}
      mobileHeight={700}
      onInteract={pause}
    >
      <div
        ref={editorFrame}
        class="agent-workflow-frame agent-editing-frame"
        data-response-state={responseState()}
        onWheel={pause}
      >
        <WorkspaceDocuments workspace={w} />
        <Show when={typing() && caret()}>
          {(position) => (
            <div
              class="agent-writing-caret"
              aria-label="Macro is typing in the document"
              style={{
                left: `${position().left}px`,
                top: `${position().top}px`,
                height: `${position().height}px`,
              }}
            >
              <span>Macro</span>
            </div>
          )}
        </Show>
      </div>
    </ProductDemo>
  );
}

export function AgentMeetingStory() {
  const w = createDummyWorkspace('agents');
  seedAgentWorkflows(w);
  w.setCalendarDate('2026-10-09');
  const nav = createWorkflowNavigation(w);
  const [turns, setTurns] = createSignal<string[]>([]);
  const [phase, setPhase] = createSignal(0);
  const [toolsOpen, setToolsOpen] = createSignal(true);
  const research: AgentToolCall[] = [
    { kind: 'action', label: 'Check Friday’s calendar' },
    { kind: 'read-thread' },
    { kind: 'read-document', title: 'Beacon discovery call' },
    { kind: 'read-channel', channel: 'customer-support', count: 6 },
  ];
  let root!: HTMLDivElement;
  let frame!: HTMLDivElement;
  let pendingFrame: number | undefined;
  const brief = w.data.documents.find((doc) => doc.id === MEETING_BRIEF)!;
  w.setData('documents', (docs) =>
    docs.filter((doc) => doc.id !== MEETING_BRIEF)
  );
  const follow = () => {
    if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = undefined;
      const log = frame.querySelector<HTMLElement>('.agent-transcript');
      const latest = log?.lastElementChild;
      if (log && latest)
        followAgentOutput(log, latest as HTMLElement, frame, true);
    });
  };
  const finish = () => {
    if (!w.data.documents.some((doc) => doc.id === MEETING_BRIEF))
      w.setData('documents', (docs) => [...docs, brief]);
    setPhase(6);
    setToolsOpen(false);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 6,
    visibilityThreshold: 0.5,
    reset: () => {},
    delay: (step) => (step === 5 ? 700 : step === 6 ? 450 : 1300),
    reduced: finish,
    advance: (step) => {
      if (step === 6) finish();
      else {
        setPhase(step);
        if (step === 5) setToolsOpen(false);
      }
      if (step !== 5) follow();
    },
  });
  const pause = () => {
    playback.pause();
    if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
    pendingFrame = undefined;
  };
  onCleanup(() => {
    if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
  });
  const mentions = {
    meeting: {
      kind: 'calendar' as const,
      time: 'Fri 9:30 AM',
      onOpen: () => nav.open('calendar', 'beacon-meeting'),
    },
    brief: {
      kind: 'document' as const,
      onOpen: () => nav.open('documents', MEETING_BRIEF),
    },
    email: {
      kind: 'email' as const,
      onOpen: () => nav.open('email', 'beacon-email'),
    },
    call: {
      kind: 'document' as const,
      onOpen: () => nav.open('documents', 'beacon-call'),
    },
  };
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      onInteract={pause}
      label="Prepare for tomorrow’s meetings"
      height={660}
      mobileHeight={720}
    >
      <div
        ref={frame}
        class="agent-workflow-frame agent-meeting-frame"
        onWheel={pause}
      >
        <nav.Frame>
          <AgentSession
            title="Tomorrow’s meetings"
            onSend={(text) => setTurns((all) => [...all, text])}
          >
            <AgentTurn>
              <AgentPrompt text="What should I know before tomorrow’s customer calls? Make me a brief." />
            </AgentTurn>
            <AgentTurn>
              <AgentToolGroup
                active={phase() < 4}
                animateCollapse
                open={toolsOpen()}
                onOpenChange={setToolsOpen}
                calls={research.slice(0, Math.min(4, phase() + 1))}
              />
              <Show when={phase() < 5}>
                <span class="magic-chip-shimmer text-sm">
                  {
                    [
                      'Checking tomorrow’s meetings…',
                      'Reading the latest customer messages…',
                      'Reading the earlier call…',
                      'Reading the team’s conversation…',
                      'Preparing your meeting brief…',
                    ][phase()]
                  }
                </span>
              </Show>
              <Show when={phase() === 6}>
                <div class="agent-meeting-answer">
                  <AgentAnswer
                    text="Beacon’s scope changed. The @[latest email](agent:email) adds 12 external clients; the @[discovery call](agent:call) only covered 8 internal reviewers."
                    mentions={mentions}
                  />
                  <AgentAnswer
                    text={
                      'I put the background and open questions in @[Friday meeting brief](agent:brief).\n\n- 9:30 AM · Beacon: resolve guest access before agreeing to a trial date.\n- 11:00 AM · Westlake: choose a feedback owner; their request is already in the file upload brief.'
                    }
                    mentions={mentions}
                  />
                  <AgentAnswer
                    text="Calendar: @[Beacon Studio](agent:meeting)."
                    mentions={mentions}
                  />
                </div>
              </Show>
            </AgentTurn>
            <For each={turns()}>
              {(text) => (
                <AgentTurn>
                  <AgentPrompt text={text} />
                </AgentTurn>
              )}
            </For>
          </AgentSession>
        </nav.Frame>
      </div>
    </ProductDemo>
  );
}

export function AgentTeamworkStory() {
  const w = createDummyWorkspace('messages');
  seedAgentWorkflows(w);
  w.setChannel('client-files');
  w.setChannelThread('design-request');
  const sceneMessages: WorkspaceComment[] = [
    {
      id: 'design-request',
      person: 'jacob',
      time: '10:04 AM',
      body: '@Macro, mock this up from the client brief.',
    },
    {
      id: 'design-result',
      replyTo: 'design-request',
      person: 'macro',
      time: '10:05 AM',
      body: 'Here’s the mockup.',
    },
    {
      id: 'design-approval',
      replyTo: 'design-request',
      person: 'jacob',
      time: '10:06 AM',
      body: '@Cursor, build this.',
    },
    {
      id: 'code-result',
      replyTo: 'design-request',
      person: 'cursor',
      time: '10:09 AM',
      body: '',
    },
  ];
  const teamHistory: WorkspaceComment[] = [
    {
      id: 'design-context',
      person: 'julia',
      time: '9:54 AM',
      body: 'client brief is updated. they want to see who’s reviewing each upload',
    },
    {
      id: 'design-question',
      person: 'teo',
      time: '9:56 AM',
      body: 'same screen or a separate page?',
    },
    {
      id: 'design-answer',
      person: 'julia',
      time: '9:57 AM',
      body: 'same screen. keep it simple',
    },
  ];
  w.setData('channels', (all) => [
    ...all,
    {
      id: 'client-files',
      messages: [...teamHistory, ...sceneMessages.slice(0, 2)],
    },
  ]);
  const nav = createWorkflowNavigation(w);
  let root!: HTMLDivElement;
  const [detail, setDetail] = createSignal<'design' | 'session' | 'pr'>();
  const [sessionTurns, setSessionTurns] = createSignal<string[]>([]);
  const advance = (step: number) => {
    w.setData('channels', (c) => c.id === 'client-files', 'messages', [
      ...teamHistory,
      ...sceneMessages.slice(0, step + 2),
      ...(step === 2
        ? [
            {
              id: 'design-followup',
              person: 'julia' as const,
              time: '10:10 AM',
              body: 'i’ll try the preview before we send it over',
            },
          ]
        : []),
    ]);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 2,
    reset: () => {},
    delay: () => 2000,
    reduced: () => advance(2),
    advance,
  });
  let trigger: HTMLElement | undefined;
  const show = (next: 'design' | 'session' | 'pr') => {
    playback.pause();
    trigger = document.activeElement as HTMLElement;
    setDetail(next);
    queueMicrotask(() =>
      root.querySelector<HTMLButtonElement>('[data-detail-back]')?.focus()
    );
  };
  const back = () => {
    setDetail(undefined);
    queueMicrotask(() => trigger?.isConnected && trigger.focus());
  };
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="People, Macro, and Cursor working together"
      height={820}
      mobileHeight={780}
      onInteract={playback.pause}
    >
      <div
        class="agent-workflow-frame"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && detail()) {
            e.stopPropagation();
            back();
          }
        }}
      >
        <div class="agent-workflow-home" hidden={!!detail()} inert={!!detail()}>
          <nav.Frame>
            <WorkspaceChannel
              workspace={nav.workspace}
              renderMessageBody={(message) =>
                message.id === 'design-request' ? (
                  <AgentAnswer
                    text="@[Macro](agent:macro), mock this up from the @[client brief](agent:brief)."
                    mentions={{
                      macro: { kind: 'person', person: 'macro' },
                      brief: {
                        kind: 'document',
                        onOpen: () => nav.open('documents', FEEDBACK_BRIEF),
                      },
                    }}
                  />
                ) : message.id === 'design-approval' ? (
                  <AgentAnswer
                    text="@[Cursor](agent:cursor), build this."
                    mentions={{ cursor: { kind: 'person', person: 'cursor' } }}
                  />
                ) : undefined
              }
              renderMessageDetails={(message) => (
                <>
                  <Show when={message.id === 'design-result'}>
                    <button
                      type="button"
                      class="agent-design-attachment"
                      aria-label="Open upload screen mockup"
                      onClick={() => show('design')}
                    >
                      <FolderComposerMockup />
                    </button>
                  </Show>
                  <Show when={message.id === 'code-result'}>
                    <DemoAgentChip
                      agentSessionId="portal-implementation"
                      requester="Jacob"
                      request="@Cursor, build this."
                      markdown="Ready for review."
                      onOpen={() => show('session')}
                      headerActions={null}
                      pullRequest={
                        <button
                          type="button"
                          class="agent-workflow-pr"
                          onClick={() => show('pr')}
                        >
                          <GitPullRequest class="size-3 text-success" />
                          <span class="demo-cursor-pr-title">
                            #248 · Improve the client upload flow
                          </span>
                        </button>
                      }
                    />
                  </Show>
                </>
              )}
            />
          </nav.Frame>
        </div>
        <Show when={detail()}>
          <div class="agent-workflow-back">
            <Button data-detail-back variant="plain" size="sm" onClick={back}>
              <ArrowLeft />
              Back to conversation
            </Button>
          </div>
          <Switch>
            <Match when={detail() === 'design'}>
              <div class="dummy-scroll p-6">
                <h3 class="mb-4 text-sm">Upload screen mockup</h3>
                <FolderComposerMockup />
              </div>
            </Match>
            <Match when={detail() === 'session'}>
              <AgentSession
                title="Build the client upload screen"
                onSend={(text) => setSessionTurns((all) => [...all, text])}
              >
                <AgentTurn>
                  <AgentPrompt text="Build this from the mockup in the thread." />
                </AgentTurn>
                <AgentTurn>
                  <AgentToolGroup
                    calls={[
                      {
                        kind: 'read-document',
                        title: 'Client file upload feedback',
                      },
                      {
                        kind: 'action',
                        label: 'Read approved mockup and thread',
                      },
                      {
                        kind: 'action',
                        label: 'Implemented the file upload composer',
                      },
                      { kind: 'action', label: 'Opened pull request #248' },
                    ]}
                  />
                  <AgentAnswer
                    text="Built the upload screen from the mockup. The PR is ready for review."
                    mentions={{}}
                  />
                  <button
                    type="button"
                    class="dummy-entity-link"
                    onClick={() => setDetail('pr')}
                  >
                    <GitPullRequest class="size-4 text-success" />
                    Review pull request #248
                  </button>
                </AgentTurn>
                <For each={sessionTurns()}>
                  {(text) => (
                    <AgentTurn>
                      <AgentPrompt text={text} />
                    </AgentTurn>
                  )}
                </For>
              </AgentSession>
            </Match>
            <Match when={detail() === 'pr'}>
              <div class="dummy-scroll agent-pr-page">
                <DemoPrDocument
                  record={{
                    name: 'Improve the client upload flow',
                    repository: 'beacon/client-files',
                    number: 248,
                    description:
                      '## Changes\n\n- Match the approved upload layout.\n- Support files and folders in the dropzone.\n- Keep the destination visible.\n\n## Review\n\nReady for a teammate to review. Guest access is outside this change.',
                  }}
                />
              </div>
            </Match>
          </Switch>
        </Show>
      </div>
    </ProductDemo>
  );
}
