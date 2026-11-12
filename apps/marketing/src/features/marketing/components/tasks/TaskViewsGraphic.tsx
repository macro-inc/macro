import { createSignal, For, Match, onCleanup, onMount, Switch } from 'solid-js';
import './task-views-graphic.css';

type TaskStatus = 'todo' | 'progress' | 'done';
type TaskView = 'list' | 'board' | 'timeline';

const views: { id: TaskView; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'board', label: 'Board' },
  { id: 'timeline', label: 'Timeline' },
];

const statuses: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'progress', label: 'In Progress' },
  { id: 'done', label: 'Done' },
];

/** The same five tasks in every view; `start` and `days` are weekday columns. */
const tasks: {
  title: string;
  status: TaskStatus;
  tag: string;
  tone: 'red' | 'violet' | 'green' | 'yellow';
  owner: string;
  due: string;
  start: number;
  days: number;
}[] = [
  { title: 'Fix checkout timeout on Safari', status: 'progress', tag: 'Bug', tone: 'red', owner: 'P', due: 'Nov 11', start: 0, days: 3 },
  { title: 'Draft Q4 roadmap review', status: 'progress', tag: 'Planning', tone: 'violet', owner: 'M', due: 'Nov 13', start: 1, days: 4 },
  { title: 'Update onboarding checklist', status: 'todo', tag: 'Product', tone: 'green', owner: 'T', due: 'Nov 16', start: 3, days: 3 },
  { title: 'Invite beta customers', status: 'todo', tag: 'Launch', tone: 'yellow', owner: 'J', due: 'Nov 19', start: 4, days: 5 },
  { title: 'Ship the pricing page', status: 'done', tag: 'Launch', tone: 'yellow', owner: 'T', due: 'Nov 10', start: 0, days: 2 },
];

const timelineDays = [9, 10, 11, 12, 13, 16, 17, 18, 19, 20];

function StatusIcon(props: { status: TaskStatus }) {
  return (
    <svg
      class="task-views-status"
      data-status={props.status}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.25" />
      <Switch>
        <Match when={props.status === 'progress'}>
          <path d="M8 3.5a4.5 4.5 0 0 1 0 9z" class="task-views-status-fill" />
        </Match>
        <Match when={props.status === 'done'}>
          <path d="m5.25 8.25 1.9 1.9 3.6-4" class="task-views-status-check" />
        </Match>
      </Switch>
    </svg>
  );
}

function ViewIcon(props: { view: TaskView }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <Switch>
        <Match when={props.view === 'list'}>
          <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
        </Match>
        <Match when={props.view === 'board'}>
          <path d="M2.5 2.5h3v11h-3zM6.5 2.5h3v7h-3zM10.5 2.5h3v9h-3z" />
        </Match>
        <Match when={props.view === 'timeline'}>
          <path d="M2.5 4h6M5.5 8h8M3.5 12h5" />
        </Match>
      </Switch>
    </svg>
  );
}

/**
 * One set of tasks shown as a list, a board, or a timeline, switched with the
 * app's three-way view control. It steps through the views by itself until
 * someone picks one.
 */
export function TaskViewsGraphic() {
  const [view, setView] = createSignal<TaskView>('list');
  let root!: HTMLDivElement;
  let timer: number | undefined;
  let chosen = false;

  const stop = () => {
    window.clearInterval(timer);
    timer = undefined;
  };

  onMount(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Only step while the graphic is on screen, so it starts from the list.
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return stop();
      if (chosen || timer !== undefined) return;

      timer = window.setInterval(() => {
        const next = views.findIndex((item) => item.id === view()) + 1;
        setView(views[next % views.length].id);
      }, 3200);
    });
    observer.observe(root);

    onCleanup(() => {
      observer.disconnect();
      stop();
    });
  });

  const choose = (next: TaskView) => {
    // A choice is final: stop stepping and never resume.
    chosen = true;
    stop();
    setView(next);
  };

  return (
    <div ref={root} class="task-views paper-feature-glass">
      <div class="task-views-bar">
        <strong>All Tasks</strong>
        <div class="task-views-toggle" role="group" aria-label="Task view">
          <For each={views}>
            {(item) => (
              <button
                type="button"
                aria-pressed={view() === item.id}
                onClick={() => choose(item.id)}
              >
                <ViewIcon view={item.id} />
                {item.label}
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="task-views-body" data-view={view()}>
        <Switch>
          <Match when={view() === 'list'}>
            <For each={tasks}>
              {(task) => (
                <div class="task-views-row">
                  <StatusIcon status={task.status} />
                  <span class="task-views-title">{task.title}</span>
                  <span class="task-views-tag" data-tone={task.tone}>
                    {task.tag}
                  </span>
                  <span class="task-views-owner">{task.owner}</span>
                  <span class="task-views-due">{task.due}</span>
                </div>
              )}
            </For>
          </Match>
          <Match when={view() === 'board'}>
            <For each={statuses}>
              {(status) => (
                <div class="task-views-column">
                  <div class="task-views-column-head">
                    <StatusIcon status={status.id} />
                    {status.label}
                  </div>
                  <For each={tasks.filter((task) => task.status === status.id)}>
                    {(task) => (
                      <div class="task-views-card">
                        <span>{task.title}</span>
                        <div>
                          <span class="task-views-tag" data-tone={task.tone}>
                            {task.tag}
                          </span>
                          <span class="task-views-owner">{task.owner}</span>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </For>
          </Match>
          <Match when={view() === 'timeline'}>
            <div class="task-views-days">
              <span>Nov</span>
              <For each={timelineDays}>{(day) => <span>{day}</span>}</For>
            </div>
            <For each={tasks}>
              {(task) => (
                <div class="task-views-lane">
                  <span class="task-views-title">{task.title}</span>
                  <div class="task-views-track">
                    <span
                      class="task-views-bar-span"
                      data-tone={task.tone}
                      data-status={task.status}
                      style={{ '--start': task.start, '--days': task.days }}
                    />
                  </div>
                </div>
              )}
            </For>
          </Match>
        </Switch>
      </div>
    </div>
  );
}
