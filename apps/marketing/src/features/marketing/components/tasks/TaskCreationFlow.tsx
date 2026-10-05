import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { WorkspaceTask } from '../../core/dummy-workspace';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoCursor } from '../DemoCursor';
import { ProductDemo } from '../product/ProductPage';
import { TaskComposer } from '../workspace/frozen/TaskComposer';
import { WorkspaceChannel } from '../workspace/WorkspaceChannel';
import { WorkspaceTasks } from '../workspace/WorkspaceTasks';
import './task-creation-flow.css';

const context =
  'Reproduced it. New teammates land in their personal workspace after accepting an invite.';
const request =
  'Keep the invited team selected through sign-up @[Teo](demo-mention:teo)';

/**
 * The channel ActionMenu's Task button opens ComposeTask with the message as
 * its title, a link back to the message, and the mentioned person assigned.
 * Phases: 0 channel, 1 hover the message, 2 composer, 3 priority, 4 created.
 */
export function TaskCreationFlow() {
  let root!: HTMLDivElement;
  let frame!: HTMLDivElement;
  const w = createDummyWorkspace('messages');
  w.setData('channels', (c) => c.id === 'launch', 'messages', [
    {
      id: 'checks',
      person: 'gabriel',
      body: 'Ran through signup on staging. Existing accounts are fine, new ones are not.',
      time: '9:11 AM',
    },
    { id: 'context', person: 'teo', body: context, time: '9:16 AM' },
    { id: 'invite-request', person: 'julia', body: request, time: '9:18 AM' },
  ]);
  w.open('messages', 'launch');
  const [phase, setPhase] = createSignal(0);
  const [automatic, setAutomatic] = createSignal(true);
  const [taskId, setTaskId] = createSignal<string>();
  const [pointer, setPointer] = createSignal<{ x: number; y: number }>();
  const [draft, setDraft] = createStore<WorkspaceTask>({
    id: 'task-draft',
    title: 'Keep the invited team selected through sign-up',
    description: '',
    owner: 'teo',
    creator: 'jacob',
    priority: 'Medium',
    status: 'Not Started',
    channel: 'launch',
    tags: [],
    steps: [],
    comments: [],
  });
  const create = () => {
    let id = taskId();
    if (!id) {
      id = w.createTask(draft.title, context, 'launch');
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
    setAutomatic(false);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 4,
    reset: () => {},
    reduced: create,
    delay: (step) => [0, 1200, 1600, 1500, 1500][step] ?? 1400,
    advance: (step) => {
      if (step === 3) setDraft('priority', 'High');
      if (step === 4) create();
      else setPhase(step);
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
      <div ref={frame} class="task-flow-frame" onFocusIn={pause}>
        <ProductDemo
          label="Create a task from a channel message"
          onInteract={pause}
          height={520}
          mobileHeight={600}
        >
          <Show
            when={phase() < 4}
            fallback={<WorkspaceTasks workspace={w} filter="all" />}
          >
            <WorkspaceChannel
              workspace={w}
              hoveredMessage={phase() === 1 ? 'invite-request' : undefined}
              onTaskMessage={() => {
                pause();
                setPhase(2);
              }}
            />
            <Show when={phase() >= 2}>
              <div class="task-flow-popover">
                <TaskComposer
                  draft={draft}
                  sourceChannel="launch"
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
              label="Jacob"
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
