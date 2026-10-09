import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { WorkspaceTask } from '../../core/dummy-workspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoCursor } from '../DemoCursor';
import { ProductDemo } from '../product/ProductPage';
import { TaskComposer } from '../workspace/frozen/TaskComposer';
import { WorkspaceChannel } from '../workspace/WorkspaceChannel';
import { TaskProjectView } from './TaskProjectView';
import {
  createTaskProject,
  REQUEST_CONTEXT,
  REQUEST_TASK,
} from './taskProject';
import './task-creation-flow.css';

/** One request becomes an owned task, then a completed link in the plan. */
export function TaskCreationFlow() {
  let root!: HTMLDivElement;
  let frame!: HTMLDivElement;
  const w = createTaskProject('messages');
  w.setData('tasks', []);
  w.setData('channels', 0, 'messages', 1, 'taskId', undefined);
  const [phase, setPhase] = createSignal(0);
  const [automatic, setAutomatic] = createSignal(true);
  const [taskId, setTaskId] = createSignal<string>();
  const [pointer, setPointer] = createSignal<{ x: number; y: number }>();
  const [draft, setDraft] = createStore<WorkspaceTask>({
    id: 'task-draft',
    title: REQUEST_TASK,
    description: '',
    owner: 'julia',
    creator: 'jacob',
    priority: 'Medium',
    status: 'Not Started',
    channel: 'sales',
    tags: [],
    steps: [],
    comments: [],
  });
  const [dueDate, setDueDate] = createSignal<string>();
  const create = () => {
    let id = taskId();
    if (!id) {
      id = 'proposal';
      w.setData('tasks', [
        { ...draft, id, description: REQUEST_CONTEXT, tags: ['Customers'] },
      ]);
      w.setData('channels', 0, 'messages', 1, 'taskId', id);
      setTaskId(id);
    }
    w.updateTask(id, {
      title: draft.title,
      owner: draft.owner,
      priority: draft.priority,
      status: draft.status,
    });
    w.open('tasks', id);
    setPhase(4);
  };
  const finish = () => {
    if (!taskId()) create();
    w.updateTask(taskId()!, {
      status: 'Completed',
      description: 'Proposal ready: scope, pricing, and a delivery timeline.',
    });
    setPhase(6);
    setAutomatic(false);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 7,
    reset: () => {},
    reduced: finish,
    delay: (step) =>
      [0, 1200, 1600, 1500, 1500, 2200, 2500, 2400][step] ?? 1400,
    advance: (step) => {
      if (step === 3) {
        setDraft('priority', 'High');
        setDueDate('Friday');
      }
      if (step === 4) create();
      else if (step === 5) {
        w.updateTask(taskId()!, {
          status: 'In Progress',
          description: 'Adding pricing and delivery dates to the proposal.',
        });
        setPhase(step);
      } else if (step === 6) finish();
      else if (step === 7) {
        w.open('documents', 'customer-brief');
        setPhase(step);
      } else setPhase(step);
    },
  });
  const pause = () => {
    setAutomatic(false);
    playback.pause();
  };
  onMount(() => {
    const position = () => {
      const selector = [
        undefined,
        '[data-hovered=true] [aria-label="Task"]',
        '[aria-label="Change priority"]',
        '[data-task-submit]',
        '[aria-label="Task description"]',
        '[aria-label="Change status"]',
      ][phase()];
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
        x: bounds.left - parent.left + Math.min(bounds.width / 2, 40),
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
  return (
    <div ref={root} class="task-creation-flow">
      <div
        ref={frame}
        class="task-flow-frame"
        role="group"
        aria-label="Task walkthrough"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && phase() >= 2 && phase() < 4) {
            pause();
            setPhase(0);
          }
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key === 'Enter' &&
            phase() >= 2 &&
            phase() < 4 &&
            draft.title.trim()
          ) {
            event.preventDefault();
            pause();
            create();
          }
        }}
      >
        <ProductDemo
          label="Follow a request from message to completion"
          onInteract={pause}
          height={560}
          mobileHeight={620}
        >
          <Show when={phase() < 4} fallback={<TaskProjectView workspace={w} />}>
            <WorkspaceChannel
              workspace={w}
              hoveredMessage={phase() === 1 ? 'proposal-request' : undefined}
              onTaskMessage={(message) => {
                pause();
                setDraft(
                  'title',
                  message.id === 'proposal-request'
                    ? REQUEST_TASK
                    : message.body
                );
                setPhase(2);
              }}
            />
            <Show when={phase() >= 2}>
              <div class="task-flow-popover">
                <TaskComposer
                  draft={draft}
                  sourceChannel="sales"
                  dueDateLabel={dueDate()}
                  update={(patch) => setDraft(patch)}
                  submit={() => {
                    pause();
                    create();
                  }}
                  close={() => {
                    pause();
                    setPhase(0);
                  }}
                />
              </div>
            </Show>
          </Show>
        </ProductDemo>
        <Show when={automatic() && pointer()}>
          {(p) => (
            <DemoCursor
              label={phase() >= 4 ? 'Julia' : 'Jacob'}
              class="task-flow-pointer"
              clicking={phase() === 3}
              style={{ transform: `translate(${p().x}px, ${p().y}px)` }}
            />
          )}
        </Show>
      </div>
    </div>
  );
}
