import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { unwrap } from 'solid-js/store';
import type { WorkspaceComment } from '../../core/dummy-workspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import {
  DocumentShareSheet,
  LAUNCH_MEMBERS,
} from '../documents/DocumentShareSheet';
import { WorkspaceDocuments } from '../workspace/WorkspaceDocuments';
import '../documents/document-stories.css';
import { DemoAgentChip } from '../DemoAgentChip';
import { DemoCursor } from '../DemoCursor';
import { ProductDemo } from '../product/ProductPage';
import { ProductWorkspace } from '../product/ProductWorkspace';
import { WorkspaceDesktopDemo } from '../WorkspaceDesktopDemo';
import { ChannelWorkSurface } from './ChannelWorkSurface';
import {
  channelHistory,
  createChannelChecklist,
  createChannelHeroProject,
  createChannelProject,
  FOLLOW_UP_TASK,
} from './channelProject';
import '../workspace/dummy-workspace.css';
import './channel-stories.css';

/** Measures `selector` inside `frame` and returns the cursor's tip position. */
function createCursorTarget(
  frame: () => HTMLElement | undefined,
  selector: () => string | undefined
) {
  const [point, setPoint] = createSignal<{ x: number; y: number }>();
  onMount(() => {
    const measure = () => {
      const root = frame();
      const query = selector();
      const target = query
        ? root?.querySelector<HTMLElement>(query)
        : undefined;
      if (!root || !target) return setPoint(undefined);
      const bounds = target.getBoundingClientRect();
      const parent = root.getBoundingClientRect();
      setPoint({
        x: bounds.left - parent.left + Math.min(bounds.width / 2, 48),
        y: bounds.top - parent.top + bounds.height / 2,
      });
    };
    createEffect(() => {
      selector();
      const id = requestAnimationFrame(measure);
      onCleanup(() => cancelAnimationFrame(id));
    });
    const observer = new ResizeObserver(measure);
    const root = frame();
    if (root) {
      observer.observe(root);
      const conversation = root.querySelector('.channel-work-conversation');
      if (conversation) observer.observe(conversation);
      root.addEventListener('scroll', measure, true);
    }
    onCleanup(() => {
      observer.disconnect();
      root?.removeEventListener('scroll', measure, true);
    });
  });
  return point;
}

/** Full chat navigation makes the hero recognizable as a channel. */
export function ChannelHero() {
  const w = createChannelHeroProject();
  return (
    <div class="channel-hero-demo">
      <WorkspaceDesktopDemo
        heroFrame
        view="messages"
        label="Explore Macro Chat"
        initialData={unwrap(w.data)}
        initialChannelThread="start"
        chatSplits
      />
    </div>
  );
}

/** Open the actual email and plan from the conversation, then keep exploring. */
export function ChannelSharedWorkDemo() {
  let root!: HTMLDivElement;
  let frame: HTMLDivElement | undefined;
  const w = createChannelChecklist();
  const [aim, setAim] = createSignal<string>();
  const [clicking, setClicking] = createSignal(false);
  const [cursorVisible, setCursorVisible] = createSignal(false);
  const [cursorOrigin, setCursorOrigin] = createSignal({ x: 0, y: 200 });
  const scrollToMessage = (id: string, smooth = true) => {
    const log = root?.querySelector<HTMLElement>(
      '.channel-work-conversation [role="log"]'
    );
    const target = log?.querySelector<HTMLElement>(`[data-thread-id="${id}"]`);
    if (!log || !target) return;
    const top =
      log.scrollTop +
      target.getBoundingClientRect().top -
      log.getBoundingClientRect().top -
      100;
    if (log.scrollTo)
      log.scrollTo({
        top: Math.max(0, top),
        behavior: smooth ? 'smooth' : 'instant',
      });
    else log.scrollTop = Math.max(0, top);
  };
  const clickMention = (id: string) => {
    root
      .querySelector<HTMLButtonElement>(
        `[data-thread-id="${id}"] .sample-inline-reference`
      )
      ?.click();
    setClicking(false);
    setCursorVisible(false);
    setAim(undefined);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    visibilityThreshold: 0.5,
    steps: 9,
    reset: () => {},
    reduced: () => {
      clickMention('shared-plan');
      clickMention('welcome');
      scrollToMessage('welcome', false);
    },
    delay: (step) =>
      [0, 1800, 800, 1000, 350, 3800, 800, 350, 1000, 350][step] ?? 1400,
    advance: (step) => {
      if (step === 1) {
        scrollToMessage('shared-plan');
        setCursorOrigin({ x: root.clientWidth * 0.68, y: 260 });
        setCursorVisible(true);
      }
      if (step === 2) setAim('shared-plan');
      if (step === 3 || step === 8) setClicking(true);
      if (step === 4) clickMention('shared-plan');
      if (step === 5) {
        const narrow =
          root
            .querySelector('.channel-work-split')
            ?.getAttribute('data-narrow') === 'true';
        if (narrow) setAim('close');
        else scrollToMessage('welcome');
        setCursorOrigin({ x: Math.min(root.clientWidth * 0.7, 360), y: 180 });
        setCursorVisible(true);
      }
      if (step === 6) {
        if (aim() === 'close') setClicking(true);
        else setAim('welcome');
      }
      if (step === 7 && aim() === 'close') {
        root.querySelector<HTMLButtonElement>('.channel-work-back')?.click();
        setClicking(false);
        scrollToMessage('welcome');
        setAim('welcome');
      }
      if (step === 9) clickMention('welcome');
    },
  });
  const pointer = createCursorTarget(
    () => frame,
    () =>
      aim() === 'close'
        ? '.channel-work-back'
        : aim()
          ? `[data-thread-id="${aim()}"] .sample-inline-reference`
          : undefined
  );
  return (
    <div ref={frame} class="channel-demo-frame">
      <ProductDemo
        ref={(el) => (root = el)}
        label="Open docs, tasks, and email alongside the channel"
        onInteract={() => {
          setAim(undefined);
          setClicking(false);
          setCursorVisible(false);
          playback.pause();
        }}
        height={620}
        mobileHeight={600}
      >
        <ChannelWorkSurface workspace={w} />
      </ProductDemo>
      <Show when={cursorVisible()}>
        <DemoCursor
          label="Jacob"
          clicking={clicking()}
          class="channel-demo-cursor"
          style={{
            transform: `translate(${(pointer() ?? cursorOrigin()).x}px, ${(pointer() ?? cursorOrigin()).y}px)`,
          }}
        />
      </Show>
    </div>
  );
}

/** Show the actual channel grant in Share, with the document behind it. */
export function ChannelPermissionsDemo() {
  let root!: HTMLDivElement;
  let shareTrigger: HTMLButtonElement | undefined;
  const w = createChannelChecklist();
  w.open('documents', 'plan');
  const [sharing, setSharing] = createSignal(false);
  const [manual, setManual] = createSignal(false);
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 1,
    reset: () => {},
    reduced: () => setSharing(true),
    delay: () => 1200,
    advance: () => setSharing(true),
  });
  return (
    <div class="channel-permissions-demo">
      <ProductDemo
        ref={(el) => (root = el)}
        label="The document is shared with the channel"
        height={610}
        mobileHeight={660}
        onInteract={() => {
          setManual(true);
          playback.pause();
        }}
      >
        <WorkspaceDocuments
          sharingDescription="Shared with #launch"
          workspace={w}
          onShare={() => {
            shareTrigger = [
              ...root.querySelectorAll<HTMLButtonElement>(
                '[data-view-shell-top-bar] button'
              ),
            ].find((button) => button.textContent?.trim() === 'Share');
            setSharing(true);
          }}
        />
        <DocumentShareSheet
          open={sharing()}
          autoFocus={manual()}
          title={w.data.documents.find((doc) => doc.id === 'plan')?.title ?? ''}
          channel={{ members: LAUNCH_MEMBERS, level: 'view' }}
          onClose={() => {
            setSharing(false);
            shareTrigger?.focus({ preventScroll: true });
          }}
        />
      </ProductDemo>
    </div>
  );
}

const threadReplies = [
  {
    id: 'reply-1',
    person: 'teo' as const,
    body: 'yep, 2pm',
    time: '9:32 AM',
  },
  {
    id: 'reply-2',
    person: 'jacob' as const,
    body: 'works for me',
    time: '9:34 AM',
  },
  {
    id: 'reply-3',
    person: 'gabriel' as const,
    body: 'same. i’ll bring the mockups',
    time: '9:36 AM',
  },
  {
    id: 'reply-4',
    person: 'teo' as const,
    body: 'meeting room or call?',
    time: '9:51 AM',
  },
  {
    id: 'reply-5',
    person: 'julia' as const,
    body: 'call, i’m working from home',
    time: '9:55 AM',
  },
];

/** Inline replies with the curved rail and the "N more replies" pill. */
export function ChannelThreadDemo() {
  let frame: HTMLDivElement | undefined;
  const w = createChannelProject();
  w.setData('channels', (c) => c.id === 'launch', 'messages', [
    {
      id: 'root',
      person: 'julia',
      body: 'still on for the design review today?',
      time: '9:30 AM',
    },
    ...threadReplies.map((reply) => ({ ...reply, replyTo: 'root' })),
    {
      id: 'next',
      person: 'valentina',
      body: 'new icons are in the folder btw',
      time: '10:02 AM',
    },
    {
      id: 'icons-reply',
      person: 'jacob',
      body: 'much sharper. let’s use these',
      time: '10:04 AM',
      replyTo: 'next',
    },
    {
      id: 'signup',
      person: 'teo',
      body: 'signup button is fixed on mobile now',
      time: '10:12 AM',
    },
    {
      id: 'signup-reply',
      person: 'julia',
      body: 'just tried it. looks good on my phone too',
      time: '10:14 AM',
      replyTo: 'signup',
    },
  ]);
  w.open('messages', 'launch');
  onMount(() => {
    const firstFrame = requestAnimationFrame(() => {
      const log = frame?.querySelector<HTMLElement>('.sample-chat-log');
      if (log) log.scrollTop = 0;
    });
    onCleanup(() => cancelAnimationFrame(firstFrame));
  });
  return (
    <div ref={frame} class="channel-demo-frame channel-thread-demo">
      <ProductDemo
        label="Read a thread inline and expand the rest"
        height={580}
        mobileHeight={620}
      >
        <ProductWorkspace workspace={w} />
      </ProductDemo>
    </div>
  );
}

/** Macro creates the task; Julia brings Cursor into the same thread to investigate. */
export function ChannelAgentDemo() {
  const [sessionOpen, setSessionOpen] = createSignal(false);
  let root!: HTMLDivElement;
  const w = createChannelProject();
  const initial = [
    ...structuredClone(channelHistory.slice(10)),
    {
      id: 'bug',
      person: 'teo' as const,
      time: '9:26 AM',
      body: 'signup button is tiny on my phone. can someone fix it?',
    },
    {
      id: 'offer',
      person: 'julia' as const,
      time: '9:27 AM',
      body: 'i can take it',
    },
    {
      id: 'follow-up-request',
      person: 'jacob' as const,
      time: '9:28 AM',
      body: '@[Macro](demo-mention:macro) make that a task for Julia',
    },
  ];
  w.setData('channels', (c) => c.id === 'launch', 'messages', initial);
  const createFollowUp = () => {
    w.setData('tasks', (tasks) => [
      ...tasks.filter((task) => task.id !== 'training-invitations'),
      {
        id: 'training-invitations',
        title: FOLLOW_UP_TASK,
        description: 'Make the signup button easier to tap on a phone.',
        owner: 'julia',
        creator: 'jacob',
        channel: 'launch',
        status: 'Not Started',
        priority: 'Medium',
        tags: ['Launch'],
        relatedDocumentIds: [],
        steps: [],
        comments: [],
      },
    ]);
    w.setData('channels', (c) => c.id === 'launch', 'messages', [
      ...initial,
      {
        id: 'agent-task',
        person: 'macro',
        time: '9:28 AM',
        replyTo: 'follow-up-request',
        body: 'Made @[Fix the signup button](demo-mention:training-invitations) and assigned it to @[Julia](demo-mention:julia).',
        taskId: 'training-invitations',
      },
    ]);
    requestAnimationFrame(() => {
      const log = root?.querySelector<HTMLElement>('[role="log"]');
      if (log) log.scrollTop = log.scrollHeight;
    });
  };
  const appendReply = (message: WorkspaceComment) => {
    w.setData(
      'channels',
      (channel) => channel.id === 'launch',
      'messages',
      (messages) => [
        ...messages.filter((item) => item.id !== message.id),
        message,
      ]
    );
    w.setChannelThread('follow-up-request');
    requestAnimationFrame(() => {
      const log = root?.querySelector<HTMLElement>(
        '.channel-work-conversation [role="log"]'
      );
      if (log) log.scrollTop = log.scrollHeight;
    });
  };
  const bringCursor = () =>
    appendReply({
      id: 'julia-cursor',
      person: 'julia',
      time: '9:29 AM',
      replyTo: 'follow-up-request',
      body: 'thanks. @[Cursor](demo-mention:cursor) can you look into this? check the mobile styles first',
    });
  const cursorResponds = () => {
    w.updateTask('training-invitations', { status: 'In Progress' });
    appendReply({
      id: 'cursor-finding',
      person: 'cursor',
      time: '9:30 AM',
      replyTo: 'follow-up-request',
      body: '',
    });
  };
  const playback = createProductWalkthrough({
    root: () => root,
    visibilityThreshold: 0.5,
    steps: 3,
    reset: () => {},
    reduced: () => {
      createFollowUp();
      bringCursor();
      cursorResponds();
    },
    delay: (step) => [0, 1600, 4000, 3200][step] ?? 1600,
    advance: (step) => {
      if (step === 1) createFollowUp();
      if (step === 2) bringCursor();
      if (step === 3) cursorResponds();
    },
  });
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="Turn a message into an assigned task"
      onInteract={playback.pause}
      height={560}
      mobileHeight={620}
    >
      <Show
        when={sessionOpen()}
        fallback={
          <ChannelWorkSurface
            workspace={w}
            renderMessageDetails={(message) =>
              message.id === 'cursor-finding' ? (
                <DemoAgentChip
                  agentSessionId="signup-investigation"
                  requester="Julia"
                  request="@Cursor can you look into this? check the mobile styles first"
                  markdown="Found a mobile style shrinking the tap target."
                  pullRequest={null}
                  headerActions={null}
                  onOpen={() => {
                    playback.pause();
                    setSessionOpen(true);
                  }}
                />
              ) : undefined
            }
          />
        }
      >
        <div class="flex h-full flex-col p-4 text-left">
          <button
            class="self-start text-sm text-ink-muted mb-6"
            onClick={() => setSessionOpen(false)}
          >
            Back to conversation
          </button>
          <h3 class="text-sm font-semibold mb-6">
            Cursor · Check the signup button
          </h3>
          <p class="text-sm text-ink-muted mb-4">
            Julia: can you look into this? check the mobile styles first
          </p>
          <p class="text-base">
            Found a mobile style shrinking the tap target. The mobile button
            needs the same minimum height as the other signup buttons.
          </p>
        </div>
      </Show>
    </ProductDemo>
  );
}
