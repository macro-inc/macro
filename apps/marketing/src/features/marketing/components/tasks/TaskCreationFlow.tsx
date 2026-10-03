import Cursor from '@phosphor/cursor.svg';
import Hash from '@phosphor/hash.svg';
import ListChecks from '@phosphor/list-checks.svg';
import { Button } from '@ui';
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import type { WorkspaceTask } from '../../core/dummy-workspace';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { ViewShell } from '../DemoWorkspaceChrome';
import { ProductDemo } from '../product/ProductPage';
import { MessageRow } from '../workspace/frozen/MessageRow';
import {
  TaskOwnerMenu,
  TaskPriorityMenu,
} from '../workspace/frozen/TaskProperties';
import { WorkspaceChannel } from '../workspace/WorkspaceChannel';
import { WorkspaceTasks } from '../workspace/WorkspaceTasks';
import './task-creation-flow.css';

const request =
  'Keep the invited team selected through sign-up. New and existing accounts should land in the right workspace.';

/** Both paths use the same local task model and the app's message/property presentation. */
export function TaskCreationFlow(props: { fromChannel?: boolean }) {
  let root!: HTMLDivElement;
  let frame!: HTMLDivElement;
  const w = createDummyWorkspace('messages');
  if (props.fromChannel) {
    w.setData('channels', (c) => c.id === 'launch', 'messages', [
      {
        id: 'context',
        person: 'julia',
        body: 'Last pass before Thursday. Can someone take the invite flow?',
        time: '9:16 AM',
      },
    ]);
  }
  const [phase, setPhase] = createSignal(0);
  const [automatic, setAutomatic] = createSignal(true);
  const [taskId, setTaskId] = createSignal<string>();
  const [sendAsTask, setSendAsTask] = createSignal(false);
  const [pointer, setPointer] = createSignal<{ x: number; y: number }>();
  const [draft, setDraft] = createStore<WorkspaceTask>({
    id: 'task-draft',
    title: 'Fix the team invite handoff',
    description: props.fromChannel ? '' : request,
    owner: 'jacob',
    creator: 'jacob',
    priority: 'High',
    status: 'Not Started',
    channel: 'launch',
    tags: ['Launch'],
    steps: [],
    comments: [],
  });
  const create = () => {
    let id = taskId();
    if (!id) {
      id = w.createTask(draft.title, draft.description, 'launch');
      if (props.fromChannel) w.post(draft.description, undefined, id);
      else
        w.setData('channels', (c) => c.id === 'launch', 'messages', [
          {
            id: 'invite-request',
            person: 'julia',
            body: request,
            time: '9:18 AM',
            taskId: id,
          },
        ]);
      setTaskId(id);
    }
    w.updateTask(id, {
      title: draft.title,
      description: draft.description,
      owner: draft.owner,
      priority: draft.priority,
    });
    w.open(
      props.fromChannel ? 'messages' : 'tasks',
      props.fromChannel ? 'launch' : id
    );
    setPhase(5);
    setAutomatic(false);
  };
  const advance = (step: number) => {
    setPhase(step);
    if (step === 1 && props.fromChannel) setDraft('description', request);
    if (step === 2) setSendAsTask(true);
    if (step === 3) setDraft('owner', 'teo');
    if (step === 5) create();
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 5,
    reset: () => {},
    reduced: () => {
      setDraft('owner', 'teo');
      if (props.fromChannel) setDraft('description', request);
      create();
    },
    advance,
  });
  const pause = () => {
    setAutomatic(false);
    playback.pause();
  };
  const select = (step: number) => {
    pause();
    if (step === 5) {
      if (taskId()) {
        w.open(
          props.fromChannel ? 'messages' : 'tasks',
          props.fromChannel ? 'launch' : taskId()
        );
        setPhase(5);
      } else {
        if (props.fromChannel && !draft.description)
          setDraft('description', request);
        create();
      }
    } else {
      setPhase(step);
      if (step >= 2) {
        setSendAsTask(true);
        if (props.fromChannel && !draft.description)
          setDraft('description', request);
      }
    }
  };
  onMount(() => {
    const position = () => {
      const selectors = props.fromChannel
        ? [
            '[aria-label="Channel task message"]',
            '[aria-label="Send as task"]',
            '[aria-label="Change assignee"]',
            '[aria-label="Change assignee"]',
            '[data-task-submit]',
          ]
        : [
            '[aria-label="Create task from message"]',
            '[aria-label="Create task from message"]',
            '[aria-label="New task title"]',
            '[aria-label="Change assignee"]',
            '[data-task-submit]',
          ];
      const selector = selectors[phase()];
      const target = selector
        ? frame.querySelector<HTMLElement>(selector)
        : undefined;
      if (!automatic() || !target) {
        setPointer(undefined);
        return;
      }
      const bounds = target.getBoundingClientRect();
      const parent = frame.getBoundingClientRect();
      setPointer({
        x: bounds.left - parent.left + Math.min(bounds.width / 2, 90),
        y: bounds.top - parent.top + bounds.height / 2,
      });
    };
    createEffect(() => {
      phase();
      automatic();
      const timer = requestAnimationFrame(position);
      onCleanup(() => cancelAnimationFrame(timer));
    });
    const resize = new ResizeObserver(position);
    resize.observe(frame);
    onCleanup(() => resize.disconnect());
  });
  const labels = () =>
    props.fromChannel
      ? ['Write in chat', 'Send as task', 'Assign', 'In the channel']
      : ['The request', 'Create task', 'Assign', 'The task'];
  return (
    <div ref={root} class="task-creation-flow">
      <nav
        class="task-flow-steps"
        aria-label={
          props.fromChannel
            ? 'Channel task creation steps'
            : 'Message conversion steps'
        }
      >
        <For each={[0, 2, 3, 5]}>
          {(step, index) => (
            <button
              type="button"
              aria-pressed={phase() >= step && phase() < [2, 3, 5, 6][index()]}
              onClick={() => select(step)}
            >
              <span>{index() + 1}</span>
              {labels()[index()]}
            </button>
          )}
        </For>
      </nav>
      <div ref={frame} class="task-flow-frame" onFocusIn={pause}>
        <ProductDemo
          label={
            props.fromChannel
              ? 'Send a task directly to a channel'
              : 'Create a task from a channel message'
          }
          onInteract={pause}
          action={phase() === 1 ? 'create' : undefined}
        >
          <Show
            when={phase() < 5}
            fallback={
              <Show
                when={w.contentView() === 'messages'}
                fallback={<WorkspaceTasks workspace={w} filter="all" />}
              >
                <WorkspaceChannel workspace={w} />
              </Show>
            }
          >
            <ViewShell.TopBar>
              <Hash class="size-4" />
              <span class="text-sm font-medium">launch</span>
            </ViewShell.TopBar>
            <div class="sample-chat-log dummy-scroll task-flow-chat">
              <div class="sample-date-divider">
                <span>Today</span>
              </div>
              <MessageRow
                message={{
                  id: 'context',
                  person: props.fromChannel ? 'julia' : 'teo',
                  body: props.fromChannel
                    ? 'Last pass before Thursday. Can someone take the invite flow?'
                    : 'I can reproduce it. The invite lands in the personal workspace after sign-up.',
                  time: '9:16 AM',
                }}
              />
              <Show when={!props.fromChannel}>
                <MessageRow
                  message={{
                    id: 'invite-request',
                    person: 'julia',
                    body: request,
                    time: '9:18 AM',
                  }}
                  onTask={() => select(2)}
                />
              </Show>
            </div>
            <Show when={props.fromChannel}>
              <form
                class="task-flow-compose"
                onSubmit={(e) => {
                  e.preventDefault();
                  pause();
                  if (sendAsTask()) create();
                }}
              >
                <textarea
                  aria-label="Channel task message"
                  placeholder="Write a message to #launch…"
                  value={draft.description}
                  onInput={(e) => {
                    pause();
                    setDraft('description', e.currentTarget.value);
                    setPhase(Math.max(phase(), 1));
                  }}
                />
                <div class="task-flow-compose-actions">
                  <button
                    type="button"
                    role="switch"
                    aria-label="Send as task"
                    aria-checked={sendAsTask()}
                    onClick={() => {
                      pause();
                      setSendAsTask(!sendAsTask());
                      setPhase(2);
                    }}
                  >
                    <ListChecks class="size-4" />
                    Send as task
                    <span class="task-flow-switch" />
                  </button>
                  <Show when={sendAsTask()}>
                    <TaskOwnerMenu
                      task={draft}
                      onSave={(owner) => setDraft('owner', owner)}
                    />
                  </Show>
                  <Button
                    type="submit"
                    data-task-submit
                    disabled={!sendAsTask() || !draft.description.trim()}
                    variant="accent"
                    size="sm"
                  >
                    Send task
                  </Button>
                </div>
              </form>
            </Show>
            <Show when={!props.fromChannel && phase() >= 2}>
              <div class="task-flow-scrim">
                <form
                  class="task-flow-draft glass-input"
                  aria-label="Create task preview"
                  onSubmit={(e) => {
                    e.preventDefault();
                    pause();
                    create();
                  }}
                >
                  <header>
                    <ListChecks class="size-4 text-task" />
                    New task <span>From #launch</span>
                  </header>
                  <input
                    aria-label="New task title"
                    value={draft.title}
                    onInput={(e) => setDraft('title', e.currentTarget.value)}
                  />
                  <textarea
                    aria-label="New task description"
                    value={draft.description}
                    onInput={(e) =>
                      setDraft('description', e.currentTarget.value)
                    }
                  />
                  <div class="task-flow-properties">
                    <TaskOwnerMenu
                      task={draft}
                      onSave={(owner) => setDraft('owner', owner)}
                    />
                    <TaskPriorityMenu
                      task={draft}
                      onSave={(priority) => setDraft('priority', priority)}
                    />
                  </div>
                  <footer>
                    <Button variant="plain" size="sm" onClick={() => select(0)}>
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="accent"
                      size="sm"
                      data-task-submit
                      disabled={!draft.title.trim()}
                    >
                      Create task
                    </Button>
                  </footer>
                </form>
              </div>
            </Show>
          </Show>
        </ProductDemo>
        <Show when={automatic() && pointer()}>
          {(p) => (
            <div
              class="task-flow-pointer"
              aria-hidden="true"
              style={{ transform: `translate(${p().x}px, ${p().y}px)` }}
            >
              <Cursor />
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
