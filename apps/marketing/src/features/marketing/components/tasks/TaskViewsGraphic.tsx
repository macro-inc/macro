import PriorityUrgent from '@icon/system/fill/priority-urgent-fill.svg';
import StatusCompleted from '@icon/system/fill/task-completed-fill.svg';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import CaretDown from '@icon/system/regular/caret-down.svg';
import GanttIcon from '@icon/system/regular/chart-gantt.svg';
import ProjectIcon from '@icon/system/regular/cube.svg';
import FilterIcon from '@icon/system/regular/funnel.svg';
import BoardIcon from '@icon/system/regular/kanban.svg';
import ListIcon from '@icon/system/regular/list-bullets.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SortIcon from '@icon/system/regular/sort-ascending.svg';
import GroupIcon from '@icon/system/regular/stack.svg';
import StatusNotStarted from '@icon/system/regular/task-created.svg';
import StatusInProgress from '@icon/system/regular/task-in-progress.svg';
import StatusInReview from '@icon/system/regular/task-in-review.svg';
import {
  type Component,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import PriorityHigh from '../../../../assets/icons/wide-priority-high.svg';
import PriorityMedium from '../../../../assets/icons/wide-priority-medium.svg';
import gabriel from '../../../../assets/people/gabriel.webp';
import julia from '../../../../assets/people/julia.webp';
import teo from '../../../../assets/people/teo.webp';
import './task-views-graphic.css';

type Icon = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
type TaskStatus = 'not-started' | 'in-progress' | 'in-review' | 'completed';
type TaskPriority = 'Urgent' | 'High' | 'Medium';
type TaskView = 'list' | 'board' | 'gantt';

const views: { id: TaskView; label: string; icon: Icon }[] = [
  { id: 'list', label: 'List', icon: ListIcon },
  { id: 'board', label: 'Board', icon: BoardIcon },
  { id: 'gantt', label: 'Gantt', icon: GanttIcon },
];

const statusIcons: Record<TaskStatus, Icon> = {
  'not-started': StatusNotStarted,
  'in-progress': StatusInProgress,
  'in-review': StatusInReview,
  completed: StatusCompleted,
};

const priorityIcons: Record<TaskPriority, Icon> = {
  Urgent: PriorityUrgent,
  High: PriorityHigh,
  Medium: PriorityMedium,
};

type Task = {
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  tag?: { label: string; tone: 'red' | 'blue' | 'amber' | 'violet' };
  due: string;
  project: string;
  owner: string;
  /** Where the Gantt bar starts and how long it runs, as a share of the range. */
  start: number;
  length: number;
};

/** The same tasks in every view, grouped by priority as the app groups them. */
const tasks: Task[] = [
  { title: 'Fix calendar sync for shared inboxes', status: 'in-review', priority: 'Urgent', tag: { label: 'bug', tone: 'red' }, due: 'Nov 5', project: 'Platform', owner: gabriel, start: 0.2, length: 0.34 },
  { title: 'Fix the checkout bug on the pricing page', status: 'in-progress', priority: 'High', tag: { label: 'bug', tone: 'red' }, due: 'Nov 6', project: 'Q4 launch', owner: teo, start: 0.34, length: 0.26 },
  { title: 'Update pricing page copy', status: 'in-progress', priority: 'High', tag: { label: 'Q4', tone: 'amber' }, due: 'Nov 6', project: 'Q4 launch', owner: teo, start: 0.4, length: 0.22 },
  { title: 'Press kit final review', status: 'not-started', priority: 'High', tag: { label: 'Q4', tone: 'amber' }, due: 'Nov 7', project: 'Q4 launch', owner: julia, start: 0.46, length: 0.22 },
  { title: 'Launch video end card', status: 'in-progress', priority: 'Medium', tag: { label: 'design', tone: 'violet' }, due: 'Nov 10', project: 'Q4 launch', owner: teo, start: 0.52, length: 0.3 },
  { title: 'Offsite agenda', status: 'not-started', priority: 'Medium', due: 'Nov 12', project: 'Offsite', owner: julia, start: 0.62, length: 0.3 },
];

const priorities: TaskPriority[] = ['Urgent', 'High', 'Medium'];
const grouped = priorities.map((priority) => ({
  priority,
  tasks: tasks.filter((task) => task.priority === priority),
}));

function Status(props: { status: TaskStatus }) {
  return (
    <Dynamic
      component={statusIcons[props.status]}
      class="task-views-status"
      data-status={props.status}
      aria-hidden="true"
    />
  );
}

function Priority(props: { priority: TaskPriority }) {
  return (
    <Dynamic
      component={priorityIcons[props.priority]}
      class="task-views-priority"
      data-priority={props.priority}
      aria-hidden="true"
    />
  );
}

function GroupHead(props: { priority: TaskPriority; count: number }) {
  return (
    <div class="task-views-group">
      <CaretDown class="task-views-caret" aria-hidden="true" />
      <Priority priority={props.priority} />
      <strong>{props.priority}</strong>
      <span>{props.count}</span>
    </div>
  );
}

/**
 * The app's task collection as a list, a board, or a Gantt chart, switched
 * with its three-way layout control. It steps through the layouts by itself
 * until someone picks one.
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
    <div ref={root} class="task-views">
      <div class="task-views-bar">
        <strong>All tasks</strong>
        <span class="task-views-pill task-views-filter" aria-hidden="true">
          <FilterIcon />
          <b>3</b>
        </span>
        <div class="task-views-layouts" role="group" aria-label="Task layout">
          <For each={views}>
            {(item) => (
              <button
                type="button"
                aria-label={item.label}
                aria-pressed={view() === item.id}
                onClick={() => choose(item.id)}
              >
                <Dynamic component={item.icon} aria-hidden="true" />
              </button>
            )}
          </For>
        </div>
        <span class="task-views-pill task-views-extra" aria-hidden="true">
          <SortIcon />
          <GroupIcon />
        </span>
        <span class="task-views-pill task-views-extra" aria-hidden="true">
          <PlusIcon />
          New
          <CaretDown class="task-views-caret" />
        </span>
      </div>
      <div class="task-views-body" data-view={view()}>
        <Switch>
          <Match when={view() === 'list'}>
            <For each={grouped}>
              {(group) => (
                <>
                  <GroupHead
                    priority={group.priority}
                    count={group.tasks.length}
                  />
                  <For each={group.tasks}>
                    {(task) => (
                      <div class="task-views-row">
                        <Priority priority={task.priority} />
                        <Status status={task.status} />
                        <span class="task-views-title">{task.title}</span>
                        <Show when={task.tag}>
                          {(tag) => (
                            <span class="task-views-tag" data-tone={tag().tone}>
                              {tag().label}
                            </span>
                          )}
                        </Show>
                        <span class="task-views-meta task-views-due">
                          <CalendarIcon aria-hidden="true" />
                          {task.due}
                        </span>
                        <img class="task-views-avatar" src={task.owner} alt="" />
                      </div>
                    )}
                  </For>
                </>
              )}
            </For>
          </Match>
          <Match when={view() === 'board'}>
            <For each={grouped}>
              {(group) => (
                <div class="task-views-column">
                  <div class="task-views-column-head">
                    <Priority priority={group.priority} />
                    <strong>{group.priority}</strong>
                    <span>{group.tasks.length}</span>
                    <PlusIcon aria-hidden="true" />
                  </div>
                  <For each={group.tasks}>
                    {(task) => (
                      <div class="task-views-card">
                        <div>
                          <Status status={task.status} />
                          <span>{task.title}</span>
                          <img
                            class="task-views-avatar"
                            src={task.owner}
                            alt=""
                          />
                        </div>
                        <div class="task-views-card-meta">
                          <span class="task-views-meta">
                            <CalendarIcon aria-hidden="true" />
                            {task.due}
                          </span>
                          <span class="task-views-meta">
                            <ProjectIcon aria-hidden="true" />
                            {task.project}
                          </span>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </For>
          </Match>
          <Match when={view() === 'gantt'}>
            <div class="task-views-months">
              <strong>October 2026</strong>
              <span>24</span>
              <strong>November</strong>
              <span>9</span>
              <span>16</span>
            </div>
            <For each={grouped}>
              {(group) => (
                <>
                  <GroupHead
                    priority={group.priority}
                    count={group.tasks.length}
                  />
                  <For each={group.tasks}>
                    {(task) => (
                      <div class="task-views-lane">
                        <div class="task-views-lane-name">
                          <Status status={task.status} />
                          <span class="task-views-title">{task.title}</span>
                        </div>
                        <div class="task-views-track">
                          <div
                            class="task-views-span"
                            style={{
                              '--start': task.start,
                              '--length': task.length,
                            }}
                          >
                            <Status status={task.status} />
                            <span class="task-views-title">{task.title}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </>
              )}
            </For>
            <i class="task-views-today" />
          </Match>
        </Switch>
      </div>
    </div>
  );
}
