import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { unwrap } from 'solid-js/store';
import type { WorkspaceComment } from '../../core/dummy-workspace';
import { createDemoPointer } from '../../primitives/createDemoPointer';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { demoTypingActions } from '../../primitives/demoTypingActions';
import {
  type DocumentShareHandle,
  DocumentShareSheet,
  LAUNCH_MEMBERS,
  type ShareLevel,
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
  let resetSurface = () => {};
  const w = createChannelChecklist();
  const [aim, setAim] = createSignal<string>();
  const [clicking, setClicking] = createSignal(false);
  const [cursorVisible, setCursorVisible] = createSignal(false);
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
    setAim(undefined);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    visibilityThreshold: 0.5,
    steps: 9,
    loop: { hold: 8000 },
    reset: () => {
      resetSurface();
      setAim(undefined);
      setClicking(false);
      setCursorVisible(false);
      scrollToMessage('shared-plan', false);
    },
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
        setAim('shared-plan');
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
  const pointer = createDemoPointer({
    frame: () => frame,
    active: cursorVisible,
    target: () =>
      aim() === 'close'
        ? '.channel-work-back'
        : aim()
          ? `[data-thread-id="${aim()}"] .sample-inline-reference`
          : undefined,
  });
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
        <ChannelWorkSurface
          workspace={w}
          onReady={(reset) => {
            resetSurface = reset;
          }}
        />
      </ProductDemo>
      <Show when={cursorVisible() && pointer()}>
        <DemoCursor
          clicking={clicking()}
          class="channel-demo-cursor"
          style={{
            transform: `translate(${pointer()!.x}px, ${pointer()!.y}px)`,
          }}
        />
      </Show>
    </div>
  );
}

/** Share the file to #launch, show the grant, and open the delivered file. */
export function ChannelPermissionsDemo() {
  let root!: HTMLDivElement;
  let frame!: HTMLDivElement;
  let form: DocumentShareHandle | undefined;
  const w = createChannelChecklist();
  const initialMessages = structuredClone(
    unwrap(w.data.channels.find((channel) => channel.id === 'launch')!.messages)
  ).filter((message) => message.documentId !== 'plan');
  w.setData(
    'channels',
    (channel) => channel.id === 'launch',
    'messages',
    initialMessages
  );
  w.open('documents', 'plan');
  const [sharing, setSharing] = createSignal(false);
  const [manual, setManual] = createSignal(false);
  const [channelMode, setChannelMode] = createSignal(false);
  const [access, setAccess] = createSignal<ShareLevel>();
  const [sharedMessageId, setSharedMessageId] = createSignal('');
  const [target, setTarget] = createSignal<string>();
  const [clicking, setClicking] = createSignal(false);
  let shareCount = 0;
  const message = 'Please check your items before tomorrow.';
  const share = () => setSharing(true);
  const deliver = (body: string, permission: ShareLevel) => {
    setAccess(permission);
    const id = `channel-file-share-${++shareCount}`;
    setSharedMessageId(id);
    w.setData(
      'channels',
      (channel) => channel.id === 'launch',
      'messages',
      (all) => [
        ...all,
        {
          id,
          person: 'jacob' as const,
          time: '10:10 AM',
          body,
          documentId: 'plan',
        },
      ]
    );
  };
  const openChannel = () => {
    setSharing(false);
    w.open('messages', 'launch');
    w.setChannelThread(sharedMessageId());
    setChannelMode(true);
    if (manual())
      queueMicrotask(() =>
        root
          .querySelector<HTMLButtonElement>(
            `[data-thread-id="${sharedMessageId()}"] .sample-inline-reference`
          )
          ?.focus({ preventScroll: true })
      );
  };
  const approach = (selector: string) => {
    setClicking(false);
    setTarget(selector);
  };
  const click = (action: () => void) => {
    setClicking(true);
    action();
  };
  const actions = [
    { delay: 1200, run: () => approach('[data-document-share]') },
    { delay: 650, run: () => click(share) },
    { delay: 350, run: () => approach('[aria-label="Email or group"]') },
    { delay: 650, run: () => click(() => {}) },
    ...demoTypingActions(
      'launch',
      (text) => {
        setClicking(false);
        form?.typeRecipient(text);
      },
      250
    ),
    { delay: 500, run: () => approach('[data-share-channel-option]') },
    { delay: 650, run: () => click(() => form?.selectChannel()) },
    { delay: 350, run: () => approach('[aria-label="Optional message"]') },
    { delay: 650, run: () => click(() => {}) },
    ...demoTypingActions(
      message,
      (text) => {
        setClicking(false);
        form?.typeMessage(text);
      },
      250
    ),
    { delay: 700, run: () => approach('[data-share-submit]') },
    { delay: 650, run: () => click(() => form?.share()) },
    { delay: 1800, run: () => approach('[data-open-shared-channel]') },
    { delay: 650, run: () => click(openChannel) },
    {
      delay: 1800,
      run: () =>
        approach(
          `[data-thread-id="${sharedMessageId()}"] .sample-inline-reference`
        ),
    },
    {
      delay: 650,
      run: () =>
        click(() =>
          root
            .querySelector<HTMLButtonElement>(
              `[data-thread-id="${sharedMessageId()}"] .sample-inline-reference`
            )
            ?.click()
        ),
    },
    { delay: 400, run: () => setClicking(false) },
  ];
  const playback = createProductWalkthrough({
    root: () => root,
    steps: actions.length,
    loop: { hold: 9000 },
    reset: () => {
      setSharing(false);
      setChannelMode(false);
      setAccess(undefined);
      setTarget(undefined);
      setClicking(false);
      setManual(false);
      setSharedMessageId('');
      shareCount = 0;
      form?.reset();
      w.setData(
        'channels',
        (channel) => channel.id === 'launch',
        'messages',
        structuredClone(initialMessages)
      );
      w.setChannelThread(undefined);
      w.open('documents', 'plan');
    },
    reduced: () => {
      deliver(message, 'view');
      openChannel();
    },
    delay: (step) => actions[step - 1].delay,
    advance: (step) => actions[step - 1].run(),
  });
  const pointer = createDemoPointer({
    frame: () => frame,
    target,
    active: () => !manual(),
  });
  return (
    <div ref={frame} class="channel-permissions-demo channel-demo-frame">
      <ProductDemo
        ref={(el) => (root = el)}
        label="Share a document with everyone in a channel"
        height={610}
        mobileHeight={660}
        onInteract={() => {
          setManual(true);
          playback.pause();
        }}
      >
        <Show
          when={channelMode()}
          fallback={
            <WorkspaceDocuments
              sharingDescription={
                access() ? 'Shared with #launch' : 'Only you have access'
              }
              workspace={w}
              onShare={share}
            />
          }
        >
          <ChannelWorkSurface workspace={w} />
        </Show>
        <DocumentShareSheet
          open={sharing()}
          autoFocus={manual()}
          title={w.data.documents.find((doc) => doc.id === 'plan')?.title ?? ''}
          channel={
            access()
              ? {
                  name: 'launch',
                  members: LAUNCH_MEMBERS,
                  level: access()!,
                  fresh: !manual(),
                }
              : undefined
          }
          channelDestination="launch"
          initialPermission="view"
          onShareChannel={deliver}
          onOpenChannel={openChannel}
          onReady={(handle) => {
            form = handle;
          }}
          onClose={() => {
            setSharing(false);
            if (manual())
              root
                .querySelector<HTMLButtonElement>('[data-document-share]')
                ?.focus({ preventScroll: true });
          }}
        />
      </ProductDemo>
      <Show when={pointer()}>
        {(point) => (
          <DemoCursor
            class="channel-demo-cursor"
            clicking={clicking()}
            style={{ transform: `translate(${point().x}px, ${point().y}px)` }}
          />
        )}
      </Show>
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
  const initialTasks = structuredClone(unwrap(w.data.tasks));
  let resetSurface = () => {};
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
    loop: { hold: 8500 },
    reset: () => {
      resetSurface();
      w.setData('tasks', structuredClone(initialTasks));
      w.setData('channels', (channel) => channel.id === 'launch', 'messages', [
        ...initial,
      ]);
      w.setChannelThread(undefined);
      const log = root.querySelector('[role="log"]');
      if (log) log.scrollTop = log.scrollHeight;
    },
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
            onReady={(reset) => {
              resetSurface = reset;
            }}
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
