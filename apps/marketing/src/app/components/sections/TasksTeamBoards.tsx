import { createSignal, For, onCleanup, onMount } from 'solid-js';
import avatarGabriel from '../../../assets/people/gabriel.webp';
import avatarJulia from '../../../assets/people/julia.webp';
import avatarTeo from '../../../assets/people/teo.webp';
import type { TaskCardData } from '../graphics/TaskCard';
import {
  At,
  CARD_H,
  CARD_W,
  Mention,
  PrRef,
  TaskCard,
  TaskCardStyles,
} from '../graphics/TaskCard';
export type TaskTeam = {
  id: string;
  name: string;
  line: string;
  task: TaskCardData;
};

export const taskTeams: TaskTeam[] = [
  {
    id: 'product',
    name: 'Product',
    line: 'Action items from meetings instantly convert into trackable issues.',
    task: {
      title: 'Cut the second confirm step',
      status: 'in-progress',
      priority: 'medium',
      assignee: { src: avatarJulia, name: 'Julia' },
      desc: (
        <>
          Drop-off doubles on the confirm screen. Fold it into the plan picker
          and keep one consent line. Raised in <Mention>product</Mention>.
        </>
      ),
      checks: [
        { label: 'Pull the funnel numbers for the step', done: true },
        { label: 'Draft copy for the merged screen', done: true },
        { label: 'Get legal to sign off on the consent line', done: false },
      ],
      activity: [
        {
          who: { kind: 'agent' },
          body: (
            <>
              <At>@Macro</At> pulled 12 interview notes into this list
            </>
          ),
          time: '11:02 AM',
        },
        {
          who: { kind: 'person', src: avatarJulia },
          body: (
            <>
              <At>@julia</At> moved this out of Backlog
            </>
          ),
          time: '11:20 AM',
        },
      ],
    },
  },
  {
    id: 'engineering',
    name: 'Engineering',
    line: 'Task status follows the PR. Task-from-message facilitates bug-squashing.',
    task: {
      title: 'Writer pool saturates at 200',
      status: 'in-review',
      priority: 'urgent',
      assignee: { src: avatarTeo, name: 'Teo' },
      desc: (
        <>
          Every write blocks once the pool hits its ceiling. Bound it, and alert
          before saturation next time. Traced in <Mention>engineering</Mention>.
        </>
      ),
      checks: [
        { label: 'Reproduce at 200 concurrent writes', done: true },
        { label: 'Bound the writer pool in staging', done: true },
        { label: 'Add a saturation alert', done: true },
      ],
      activity: [
        {
          who: { kind: 'pr' },
          body: (
            <>
              <At>@Macro</At> opened a fix PR:{' '}
              <PrRef>fix(db): bound the writer pool</PrRef>
            </>
          ),
          time: '2:41 PM',
        },
        {
          who: { kind: 'person', src: avatarTeo },
          body: (
            <>
              <At>@teo</At> pushed 2 commits and checked off 2 items
            </>
          ),
          time: '3:05 PM',
        },
      ],
    },
  },
  {
    id: 'sales',
    name: 'Sales',
    line: 'Track follow-ups and measurably nurture leads without leaving chat.',
    task: {
      title: 'Northwind renewal security review',
      status: 'created',
      priority: 'high',
      assignee: { src: avatarGabriel, name: 'Gabriel' },
      desc: (
        <>
          They will not sign until the questionnaire is back. Send the SOC 2
          report first, then book the call. Opened from <Mention>sales</Mention>
          .
        </>
      ),
      checks: [
        { label: 'Send the SOC 2 report', done: false },
        { label: 'Answer the 14 questionnaire items', done: false },
        { label: 'Book the call with their CISO', done: false },
      ],
      activity: [
        {
          who: { kind: 'agent' },
          body: (
            <>
              <At>@Macro</At> drafted this from Tuesday's call
            </>
          ),
          time: '9:12 AM',
        },
        {
          who: { kind: 'person', src: avatarGabriel },
          body: (
            <>
              <At>@gabriel</At> set the due date to Friday
            </>
          ),
          time: '9:30 AM',
        },
      ],
    },
  },
];

/** The original three team examples, scaled to the article rather than the viewport. */
export function TasksTeamBoards() {
  const [width, setWidth] = createSignal(680);
  let frame!: HTMLDivElement;
  onMount(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width)
    );
    observer.observe(frame);
    onCleanup(() => observer.disconnect());
  });
  const stepX = () => (width() < 500 ? 95 : 278);
  const stepY = () => (width() < 500 ? 58 : 26);
  const designWidth = () => CARD_W + stepX() * 2;
  const designHeight = () => CARD_H + stepY() * 2;
  return (
    <div
      ref={frame}
      class="tasks-guide-teams"
      role="img"
      aria-label="Related tasks for product, engineering, and sales in the same workspace"
    >
      <TaskCardStyles />
      <div
        style={{
          width: `${designWidth()}px`,
          height: `${designHeight()}px`,
          position: 'relative',
          isolation: 'isolate',
          zoom: width() / designWidth(),
        }}
      >
        <For each={taskTeams}>
          {(team, index) => (
            <div
              style={{
                position: 'absolute',
                left: `${index() * stepX()}px`,
                top: `${index() * stepY()}px`,
                'z-index': index() + 1,
              }}
            >
              <TaskCard task={team.task} />
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
