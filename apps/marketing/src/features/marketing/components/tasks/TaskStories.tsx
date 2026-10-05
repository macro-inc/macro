import ChatTeardrop from '@phosphor/chat-teardrop.svg';
import CheckSquare from '@phosphor/check-square.svg';
import FileText from '@phosphor/file-text.svg';
import GridFour from '@phosphor/grid-four.svg';
import LinkIcon from '@phosphor/link.svg';
import TextB from '@phosphor/text-b.svg';
import TextItalic from '@phosphor/text-italic.svg';
import TextStrikethrough from '@phosphor/text-strikethrough.svg';
import { createSignal, For, Show } from 'solid-js';
import type { TaskStatus, WorkspaceTask } from '../../core/dummy-workspace';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoCursor } from '../DemoCursor';
import { PrStatusIcon } from '../DemoPrDocument';
import { ViewShell } from '../DemoWorkspaceChrome';
import { ProductDemo } from '../product/ProductPage';
import { ProductWorkspace } from '../product/ProductWorkspace';
import { TaskMention } from '../workspace/frozen/TaskMention';
import { TaskNotebook } from '../workspace/frozen/TaskNotebook';
import { WorkspaceTasks } from '../workspace/WorkspaceTasks';
import '../workspace/dummy-workspace.css';
import '../demo-markdown.css';
import './task-stories.css';

import { TaskCreationFlow } from './TaskCreationFlow';

export function TaskFromMessageDemo() {
  return <TaskCreationFlow />;
}

const launchAsks = [
  {
    title: 'Fix the team invite handoff',
    owner: 'teo',
    priority: 'Urgent',
  },
  {
    title: 'Final read of the launch announcement',
    owner: 'julia',
    priority: 'High',
  },
  {
    title: 'Own the launch checklist',
    owner: 'jacob',
    priority: 'Medium',
  },
] as const;

/** @Macro in a channel: one request becomes several assigned tasks. */
export function TaskAgentChannelDemo() {
  let root!: HTMLDivElement;
  const w = createDummyWorkspace('messages');
  const thread = [
    {
      id: 'launch-asks',
      person: 'julia' as const,
      body: 'Last pass before Thursday. The invite still drops people in their personal workspace, the announcement needs a final read, and nobody owns the checklist yet.',
      time: '9:20 AM',
    },
    {
      id: 'make-tasks',
      person: 'jacob' as const,
      body: '@[Macro](demo-mention:macro) make tasks for these. Teo takes the invite fix, Julia the announcement, I’ll take the checklist.',
      time: '9:22 AM',
    },
  ];
  w.setData('channels', (c) => c.id === 'launch', 'messages', thread);
  w.open('messages', 'launch');
  let created = false;
  const finish = () => {
    if (created) return;
    created = true;
    const ids = launchAsks.map((ask) => {
      const id = w.createTask(ask.title, '', 'launch');
      w.updateTask(id, { owner: ask.owner, priority: ask.priority });
      return id;
    });
    w.setData('channels', (c) => c.id === 'launch', 'messages', [
      ...thread,
      {
        id: 'macro-tasks',
        person: 'macro',
        body: 'Created 3 tasks for Thursday’s launch and assigned them.',
        time: '9:22 AM',
        taskIds: ids,
      },
    ]);
    w.open('messages', 'launch');
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 2,
    reset: () => {},
    reduced: finish,
    delay: (step) => (step === 1 ? 900 : 1600),
    advance: (step) => {
      if (step === 2) finish();
    },
  });
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="Ask the Macro agent to make tasks from a channel message"
      onInteract={playback.pause}
      height={540}
      mobileHeight={640}
    >
      <ProductWorkspace workspace={w} />
    </ProductDemo>
  );
}

const checklist = [
  'Verify both invite paths before Thursday',
  'Final read of the announcement',
  'Record the product demo',
];

/**
 * MarkdownPopup's selection toolbar offers "Tasks" when the selection holds
 * checkboxes. Each checkbox becomes a task mention in place.
 */
export function TaskFromChecklistDemo() {
  let root!: HTMLDivElement;
  const w = createDummyWorkspace('documents');
  const [phase, setPhase] = createSignal(0);
  const [tasks, setTasks] = createSignal<WorkspaceTask[]>([]);
  const convert = () => {
    if (tasks().length) return;
    const owners = ['teo', 'julia', 'jacob'] as const;
    const ids = checklist.map((title, index) => {
      const id = w.createTask(title, '', 'launch');
      w.updateTask(id, { owner: owners[index] });
      return id;
    });
    w.open('documents', 'plan');
    setTasks(ids.map((id) => w.data.tasks.find((task) => task.id === id)!));
    setPhase(3);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 3,
    reset: () => {},
    reduced: convert,
    delay: (step) => [0, 1200, 1500, 1400][step] ?? 1400,
    advance: (step) => {
      if (step === 3) convert();
      else setPhase(step);
    },
  });
  const opened = () =>
    w.contentView() === 'tasks'
      ? w.data.tasks.find((t) => t.id === w.selected())
      : undefined;
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="Turn checklist items in a document into tasks"
      onInteract={playback.pause}
      height={460}
      mobileHeight={560}
    >
      <Show when={!opened()} fallback={<ProductWorkspace workspace={w} />}>
        <ViewShell.TopBar>
          <FileText class="size-4 text-note" />
          <span class="text-sm font-medium">Q3 launch plan</span>
        </ViewShell.TopBar>
        <div class="dummy-scroll task-checklist-doc">
          <h1>Q3 launch plan</h1>
          <h2>Before Thursday</h2>
          <div
            class="task-checklist-block"
            data-selected={phase() >= 1 && phase() < 3}
          >
            <Show when={phase() >= 1 && phase() < 3}>
              <div
                class="task-checklist-toolbar"
                role="toolbar"
                aria-label="Selection"
              >
                <button type="button">AI edit</button>
                <button
                  type="button"
                  data-convert-tasks
                  onClick={() => {
                    playback.pause();
                    convert();
                  }}
                >
                  <CheckSquare class="size-4" />
                  Tasks
                  <Show when={phase() === 2}>
                    <DemoCursor
                      label="Jacob"
                      class="task-checklist-cursor"
                      clicking
                    />
                  </Show>
                </button>
                <span class="task-checklist-divider" />
                <button type="button" aria-label="Bold">
                  <TextB class="size-4" />
                </button>
                <button type="button" aria-label="Italic">
                  <TextItalic class="size-4" />
                </button>
                <button type="button" aria-label="Strikethrough">
                  <TextStrikethrough class="size-4" />
                </button>
                <button type="button" aria-label="Insert link">
                  <LinkIcon class="size-4" />
                </button>
                <span class="task-checklist-divider" />
                <button type="button">
                  <GridFour class="size-4" />
                  Table
                </button>
                <span class="task-checklist-divider" />
                <button type="button" aria-label="Comment">
                  <ChatTeardrop class="size-4" />
                </button>
              </div>
            </Show>
            <Show
              when={tasks().length}
              fallback={
                <ul class="task-checklist-list">
                  <For each={checklist}>
                    {(item) => (
                      <li>
                        <span class="task-checklist-box" aria-hidden="true" />
                        <span class="task-checklist-text">{item}</span>
                      </li>
                    )}
                  </For>
                </ul>
              }
            >
              <ul class="task-checklist-list" data-converted="true">
                <For each={tasks()}>
                  {(task) => (
                    <li>
                      <TaskMention
                        task={
                          w.data.tasks.find((t) => t.id === task.id) ?? task
                        }
                        onOpen={() => {
                          playback.pause();
                          w.open('tasks', task.id);
                        }}
                      />
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
          <p class="task-checklist-after">
            Launch is Thursday at 9. Julia sends the announcement once the
            invite fix ships.
          </p>
          <h2>Owners</h2>
          <p class="task-checklist-after">
            Teo owns sign-up, Julia owns the announcement, and Jacob runs the
            final checklist.
          </p>
        </div>
      </Show>
    </ProductDemo>
  );
}

const PR = {
  title: 'Keep the invited team through sign-up',
  repo: 'launch-team/web',
  number: 491,
};

/** InlineTaskGithubPullRequests plus the GitHub sync's status changes. */
export function TaskGithubDemo() {
  let root!: HTMLDivElement;
  const w = createDummyWorkspace('tasks');
  w.open('tasks', 'invite');
  w.updateTask('invite', {
    status: 'In Progress',
    steps: [
      { id: 'new', text: 'New accounts land in the invited team', done: true },
      { id: 'existing', text: 'Existing accounts switch teams', done: true },
      { id: 'tests', text: 'Regression tests for both paths', done: false },
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
      w.updateTask('invite', {
        steps: task().steps.map((item) => ({ ...item, done: true })),
      });
    },
    delay: (step) => [0, 1000, 2200, 2200][step] ?? 1400,
    advance: (step) => {
      if (step === 1) move('open', 'In Review');
      if (step === 3) {
        move('merged', 'Completed');
        w.updateTask('invite', {
          steps: task().steps.map((item) => ({ ...item, done: true })),
        });
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
        fallback={<WorkspaceTasks workspace={w} filter="all" />}
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
