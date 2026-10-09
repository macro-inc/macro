import { batch, createSignal, onCleanup, Show } from 'solid-js';
import type {
  TaskStatus,
  WorkspaceComment,
  WorkspaceTask,
} from '../../core/dummy-workspace';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { PrStatusIcon } from '../DemoPrDocument';
import type { ChannelComposerHandle } from '../email/frozen/ChannelComposer';
import { ProductDemo } from '../product/ProductPage';
import { ProductWorkspace } from '../product/ProductWorkspace';
import { TaskNotebook } from '../workspace/frozen/TaskNotebook';
import { WorkspaceChannel } from '../workspace/WorkspaceChannel';
import { createProposalWorkspace } from './proposalWorkspace';
import '../workspace/dummy-workspace.css';
import '../demo-markdown.css';
import './task-stories.css';

import { TaskCreationFlow } from './TaskCreationFlow';

export function TaskFromMessageDemo() {
  return <TaskCreationFlow />;
}

const proposalAsks = [
  { title: 'Draft the customer proposal', owner: 'teo', priority: 'High' },
  {
    title: 'Review the pricing',
    owner: 'jacob',
    priority: 'Medium',
  },
] as const;

/** Explicit requests create tasks and then change one assignment. */
export function TaskAgentChannelDemo() {
  let root!: HTMLDivElement;
  const w = createProposalWorkspace();
  w.open('messages', 'sales');
  w.setData('tasks', []);
  const [typing, setTyping] = createSignal(false);
  const firstRequest =
    '@Macro make tasks for this proposal. Teo drafts it; I’ll review the pricing.';
  const secondRequest =
    'Julia will draft the proposal instead. Can you update the task?';
  w.setData('channels', 0, 'messages', []);
  const [replyTarget, setReplyTarget] = createSignal<string>();
  const composers = new Map<string, ChannelComposerHandle>();
  let scrollFrame: number | undefined;
  let takenOver = false;
  let smooth = true;
  const follow = () => {
    if (takenOver) return;
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined;
      const log = root.querySelector<HTMLElement>('[role="log"]');
      if (log && !takenOver)
        log.scrollTo({
          top: log.scrollHeight,
          behavior: smooth ? 'smooth' : 'instant',
        });
    });
  };
  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
  });
  const hasMessage = (id: string) =>
    w.data.channels[0].messages.some((message) => message.id === id);
  const writeDraft = (text: string) => {
    composers.get(replyTarget() ?? 'main')?.setText(text);
    setTyping(!!text);
  };
  const sendRequest = () => {
    if (hasMessage('make-tasks')) return;
    writeDraft('');
    w.setData('channels', 0, 'messages', (items): WorkspaceComment[] => [
      ...items,
      {
        id: 'make-tasks',
        person: 'jacob',
        time: '9:20 AM',
        body: '@[Macro](demo-mention:macro) make tasks for this proposal. Teo drafts it; I’ll review the pricing.',
      },
    ]);
    w.setChannelThread('make-tasks');
  };
  let ids: string[] = [];
  const create = () =>
    batch(() => {
      if (ids.length) return;
      const tasks: WorkspaceTask[] = proposalAsks.map((ask) => ({
        id: crypto.randomUUID(),
        title: ask.title,
        description:
          ask.title === 'Draft the customer proposal'
            ? 'Draft the proposal using the customer brief and request. Include scope, pricing, and a delivery date.'
            : 'Check the price and scope before we send the proposal.',
        owner: ask.owner,
        priority: ask.priority,
        creator: 'jacob',
        status: 'Not Started',
        tags: ['Customers'],
        relatedDocumentIds: ['brief'],
        channel: 'sales',
        steps: [],
        comments: [],
      }));
      ids = tasks.map((task) => task.id);
      w.setData('tasks', tasks);
      w.setData('channels', 0, 'messages', (items): WorkspaceComment[] => [
        ...items,
        {
          id: 'created',
          replyTo: 'make-tasks',
          person: 'macro',
          body: 'Created and assigned both tasks.',
          time: '9:20 AM',
          taskIds: ids,
        },
      ]);
      follow();
    });
  const beginReply = () => {
    setReplyTarget('make-tasks');
    follow();
  };
  const requestUpdate = () => {
    if (hasMessage('reassign')) return;
    writeDraft('');
    w.setData('channels', 0, 'messages', (items): WorkspaceComment[] => [
      ...items,
      {
        id: 'reassign',
        replyTo: 'make-tasks',
        person: 'jacob',
        body: secondRequest,
        time: '9:24 AM',
      },
    ]);
    setReplyTarget(undefined);
    follow();
  };
  const update = () => {
    if (hasMessage('updated') || !ids.length) return;
    w.updateTask(ids[0], { owner: 'julia' });
    w.setData('channels', 0, 'messages', (items): WorkspaceComment[] => [
      ...items,
      {
        id: 'updated',
        replyTo: 'make-tasks',
        person: 'macro',
        body: 'The proposal is now assigned to Julia.',
        time: '9:24 AM',
        taskId: ids[0],
      },
    ]);
    follow();
  };
  const typeMessage = (text: string, delay: number) =>
    Array.from({ length: Math.ceil(text.length / 2) }, (_, index) => ({
      delay: index === 0 ? delay : 35,
      run: () => writeDraft(text.slice(0, (index + 1) * 2)),
    }));
  const steps = [
    ...typeMessage(firstRequest, 600),
    { delay: 450, run: sendRequest },
    { delay: 1400, run: create },
    { delay: 2200, run: beginReply },
    ...typeMessage(secondRequest, 300),
    { delay: 450, run: requestUpdate },
    { delay: 1400, run: update },
  ];
  const playback = createProductWalkthrough({
    root: () =>
      root.querySelector<HTMLElement>('.sample-chat-composer') ?? root,
    visibilityThreshold: 1,
    steps: steps.length,
    reset: () => {},
    reduced: () => {
      smooth = false;
      sendRequest();
      create();
      requestUpdate();
      update();
    },
    delay: (step) => steps[step - 1]?.delay ?? 35,
    advance: (step) => steps[step - 1]?.run(),
  });
  const pause = () => {
    takenOver = true;
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
    playback.pause();
    setTyping(false);
  };
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="Ask Macro to create tasks and change an owner"
      onInteract={pause}
      height={560}
      mobileHeight={620}
    >
      <div class="task-agent-scene" data-typing={typing()} onWheel={pause}>
        <Show
          when={w.contentView() === 'messages'}
          fallback={<ProductWorkspace workspace={w} />}
        >
          <WorkspaceChannel
            workspace={w}
            scriptedReply={replyTarget}
            stableComposer
            onComposerReady={(handle, thread) => {
              const key = thread ?? 'main';
              if (handle) composers.set(key, handle);
              else composers.delete(key);
            }}
          />
        </Show>
      </div>
    </ProductDemo>
  );
}

const PR = {
  title: 'Fix mobile sign-in',
  repo: 'company/website',
  number: 491,
};

/** InlineTaskGithubPullRequests plus the GitHub sync's status changes. */
export function TaskGithubDemo() {
  let root!: HTMLDivElement;
  const w = createDummyWorkspace('tasks');
  w.open('tasks', 'invite');
  w.setChannel('website');
  w.setData('channels', [
    {
      id: 'website',
      messages: [
        {
          id: 'sign-in-request',
          person: 'julia',
          body: 'The sign-in button does nothing on mobile. Can you fix it?',
          time: '9:10 AM',
          taskId: 'invite',
        },
      ],
    },
  ]);
  w.updateTask('invite', {
    title: 'Fix the sign-in button',
    description: 'The sign-in button does nothing on mobile.',
    channel: 'website',
    tags: ['Website'],
    status: 'In Progress',
    steps: [
      { id: 'mobile', text: 'Sign-in works on mobile', done: true },
      { id: 'desktop', text: 'Desktop sign-in still works', done: true },
    ],
    comments: [],
  });
  const [pr, setPr] = createSignal<'none' | 'open' | 'merged'>('none');
  const move = (next: 'open' | 'merged', status: TaskStatus) => {
    setPr(next);
    w.updateTask('invite', { status });
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 3,
    reset: () => {},
    reduced: () => {
      move('merged', 'Completed');
    },
    delay: (step) => [0, 1000, 2200, 2200][step] ?? 1400,
    advance: (step) => {
      if (step === 1) move('open', 'In Review');
      if (step === 3) {
        move('merged', 'Completed');
      }
    },
  });
  const task = () => w.data.tasks.find((t) => t.id === 'invite')!;
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="A linked pull request moves the task to review, then done"
      onInteract={playback.pause}
      height={500}
      mobileHeight={600}
    >
      <Show
        when={w.contentView() === 'tasks' && w.selected() === 'invite'}
        fallback={<ProductWorkspace workspace={w} />}
      >
        <TaskNotebook
          workspace={w}
          task={task()}
          pills={
            <Show when={pr() !== 'none'}>
              <span class="task-pr-pill" data-status={pr()}>
                <PrStatusIcon status={pr()} class="size-3 shrink-0" />
                <span class="truncate">{PR.title}</span>
                <span class="text-ink-muted">
                  {PR.repo}#{PR.number}
                </span>
                <span class="text-success">+38</span>
                <span class="text-failure">−6</span>
              </span>
            </Show>
          }
        />
      </Show>
    </ProductDemo>
  );
}
