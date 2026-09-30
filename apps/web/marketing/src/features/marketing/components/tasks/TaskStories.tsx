import FileText from '@phosphor/file-text.svg';
import Hash from '@phosphor/hash.svg';
import { createSignal, For, Show } from 'solid-js';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { ViewShell } from '../DemoWorkspaceChrome';
import { HomepageConversation } from '../HomepageConversation';
import { ProductDemo } from '../product/ProductPage';
import { MessageRow } from '../workspace/frozen/MessageRow';
import { TaskNotebook } from '../workspace/frozen/TaskNotebook';
import { WorkspaceChannel } from '../workspace/WorkspaceChannel';
import { WorkspaceDocuments } from '../workspace/WorkspaceDocuments';
import { type TaskFilter, WorkspaceTasks } from '../workspace/WorkspaceTasks';
import '../workspace/dummy-workspace.css';
import '../demo-markdown.css';

const request =
  'Keep the invited team selected through sign-up. New and existing accounts should land in the right workspace.';

/** A channel request becomes an editable notebook with its source retained. */
export function TaskFromMessageDemo() {
  let root!: HTMLDivElement;
  const w = createDummyWorkspace('messages');
  const [highlight, setHighlight] = createSignal(false);
  let created = false;
  const create = () => {
    if (created) return;
    created = true;
    const id = w.createTask('Fix the team invite handoff', request, 'launch');
    w.updateTask(id, { owner: 'teo', priority: 'High' });
    setHighlight(false);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 3,
    reset: () => {},
    reduced: create,
    advance: (step) => {
      if (step === 1) setHighlight(true);
      if (step === 2) create();
    },
  });
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="Create a task from a channel message"
      onInteract={playback.pause}
      action={highlight() ? 'create' : undefined}
    >
      <Show
        when={w.contentView() === 'tasks'}
        fallback={
          <>
            <ViewShell.TopBar>
              <Hash class="size-4" />
              <span class="text-sm font-medium">launch</span>
            </ViewShell.TopBar>
            <div class="sample-chat-log dummy-scroll">
              <MessageRow
                message={{
                  id: 'invite-request',
                  person: 'julia',
                  body: request,
                  time: '9:18 AM',
                }}
                onTask={create}
              />
            </div>
          </>
        }
      >
        <WorkspaceTasks workspace={w} filter="all" />
      </Show>
    </ProductDemo>
  );
}

export function TaskOwnershipDemo() {
  let root!: HTMLDivElement;
  const w = createDummyWorkspace('tasks');
  w.open('tasks', 'checklist');
  w.updateTask('checklist', {
    owner: 'jacob',
    priority: 'Low',
    status: 'Not Started',
  });
  const [action, setAction] = createSignal<string>();
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 4,
    reset: () => {},
    reduced: () =>
      w.updateTask('checklist', {
        owner: 'teo',
        priority: 'High',
        status: 'In Progress',
      }),
    advance: (step) => {
      setAction(['assignee', 'priority', 'status', undefined][step - 1]);
      if (step === 1) w.updateTask('checklist', { owner: 'teo' });
      if (step === 2) w.updateTask('checklist', { priority: 'High' });
      if (step === 3) w.updateTask('checklist', { status: 'In Progress' });
    },
  });
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="Assign a task and set its next step"
      action={action()}
      onInteract={playback.pause}
    >
      <WorkspaceTasks workspace={w} filter="all" />
    </ProductDemo>
  );
}

export function TaskContextDemo() {
  const w = createDummyWorkspace('tasks');
  w.open('tasks', 'announcement');
  return (
    <ProductDemo label="Task checklist, linked plan, and discussion">
      <Show
        when={w.contentView() === 'documents'}
        fallback={
          <Show
            when={w.contentView() === 'messages'}
            fallback={
              <TaskNotebook
                workspace={w}
                task={w.data.tasks.find((t) => t.id === 'announcement')!}
                relatedContent={
                  <button
                    type="button"
                    class="dummy-entity-link"
                    onClick={() => w.open('documents', 'plan')}
                  >
                    <FileText class="size-4 text-document" />
                    Q3 launch plan
                  </button>
                }
              />
            }
          >
            <WorkspaceChannel workspace={w} />
          </Show>
        }
      >
        <WorkspaceDocuments workspace={w} />
      </Show>
    </ProductDemo>
  );
}

export function TaskAttentionDemo() {
  let root!: HTMLDivElement;
  const w = createDummyWorkspace('tasks');
  const [filter, setFilter] = createSignal<TaskFilter>('all');
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 3,
    reset: () => {},
    reduced: () => {
      setFilter('mine');
      w.setQuery('launch');
    },
    advance: (step) => {
      if (step === 1) setFilter('mine');
      if (step === 2) w.setQuery('launch');
    },
  });
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="Find your next task"
      onInteract={playback.pause}
    >
      <nav class="product-task-filters" aria-label="Task views">
        <For
          each={
            [
              { id: 'all', label: 'All Tasks' },
              { id: 'mine', label: 'My Tasks' },
              { id: 'created', label: 'Created by me' },
            ] as const
          }
        >
          {(view) => (
            <button
              type="button"
              aria-pressed={filter() === view.id}
              onClick={() => {
                setFilter(view.id);
                w.open('tasks');
                w.setQuery('');
              }}
            >
              {view.label}
            </button>
          )}
        </For>
      </nav>
      <WorkspaceTasks workspace={w} filter={filter()} />
    </ProductDemo>
  );
}

export function TaskAgentDemo() {
  let root!: HTMLDivElement;
  const w = createDummyWorkspace('tasks');
  w.open('tasks', 'announcement');
  w.updateTask('announcement', { status: 'In Progress', comments: [] });
  const finish = () => {
    w.updateTask('announcement', {
      status: 'In Review',
      description:
        'Draft the Thursday launch announcement. Include the Q3 launch plan, product demo, and the invite checklist.',
      comments: [
        {
          id: 'agent-draft',
          person: 'claude',
          body: 'I added the launch details to the brief. Julia, please review before publishing.',
          time: '9:34 AM',
        },
      ],
    });
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 3,
    reset: () => {},
    reduced: finish,
    advance: (step) => {
      if (step === 2) finish();
    },
  });
  return (
    <div ref={root}>
      <div class="product-demo-request">
        <HomepageConversation
          messages={[
            {
              person: 'julia',
              text: '@Claude, add the launch details to this task and leave the draft ready for my review.',
            },
          ]}
        />
      </div>
      <ProductDemo
        label="An agent prepares a task for human review"
        onInteract={playback.pause}
      >
        <WorkspaceTasks workspace={w} filter="all" />
      </ProductDemo>
    </div>
  );
}
