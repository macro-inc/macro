import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import DatabaseIcon from '@icon/system/regular/database.svg';
import GripIcon from '@icon/system/regular/dots-six-vertical.svg';
import DotsIcon from '@icon/system/regular/dots-three.svg';
import FilterIcon from '@icon/system/regular/funnel.svg';
import StatusIcon from '@icon/system/regular/list-bullets.svg';
import NameIcon from '@icon/system/regular/pencil.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SidebarIcon from '@icon/system/regular/sidebar-simple.svg';
import SortIcon from '@icon/system/regular/sort-ascending.svg';
import OwnerIcon from '@icon/system/regular/user-circle.svg';
import { For, Match, Switch } from 'solid-js';
import { Badge } from '../../../../ui/components/Badge';
import { homepagePeople } from '../../core/homepage-demo-people';
import { createViewStepper } from '../../primitives/createViewStepper';
import './database-views-graphic.css';

type RecordStatus = 'Planned' | 'In progress' | 'Done';
type DatabaseView = 'table' | 'board' | 'timeline';

/** The saved views of the table, named as the app names them. */
const views: { id: DatabaseView; label: string }[] = [
  { id: 'table', label: 'All records' },
  { id: 'board', label: 'Board' },
  { id: 'timeline', label: 'Timeline' },
];

type LaunchRecord = {
  name: string;
  status: RecordStatus;
  due: string;
  owner: 'julia' | 'teo' | 'jacob' | 'gabriel';
  /** Where the timeline bar starts and how long it runs, as a share of the range. */
  start: number;
  length: number;
};

/** The same records in every view. */
const records: LaunchRecord[] = [
  {
    name: 'Customer announcement',
    status: 'Done',
    due: 'Oct 28, 2026',
    owner: 'julia',
    start: 0.08,
    length: 0.32,
  },
  {
    name: 'Pricing page',
    status: 'Done',
    due: 'Nov 3, 2026',
    owner: 'teo',
    start: 0.22,
    length: 0.28,
  },
  {
    name: 'Setup guide',
    status: 'In progress',
    due: 'Nov 14, 2026',
    owner: 'jacob',
    start: 0.4,
    length: 0.3,
  },
  {
    name: 'Press kit',
    status: 'In progress',
    due: 'Nov 17, 2026',
    owner: 'gabriel',
    start: 0.5,
    length: 0.27,
  },
  {
    name: 'Launch checklist',
    status: 'Planned',
    due: 'Nov 28, 2026',
    owner: 'julia',
    start: 0.7,
    length: 0.28,
  },
  {
    name: 'Partner webinar',
    status: 'Planned',
    due: 'Dec 4, 2026',
    owner: 'teo',
    start: 0.76,
    length: 0.32,
  },
];

const lanes = (['In progress', 'Planned', 'Done'] as const).map((status) => ({
  status,
  records: records.filter((record) => record.status === status),
}));

/** Timeline header marks, placed as a share of the range. */
const marks = [
  { label: '17', at: 0.2, minor: true },
  { label: '24', at: 0.33 },
  { label: 'November', at: 0.48, month: true },
  { label: '9', at: 0.63, minor: true },
  { label: '16', at: 0.76 },
  { label: '24', at: 0.91 },
];

function StatusPill(props: { status: RecordStatus }) {
  return (
    <Badge
      variant="outline"
      size="sm"
      class="database-views-status"
      data-status={props.status}
    >
      <i />
      {props.status}
    </Badge>
  );
}

function Owner(props: { owner: LaunchRecord['owner'] }) {
  return (
    <span class="database-views-owner">
      <img src={homepagePeople[props.owner].photo} alt="" />
      {homepagePeople[props.owner].shortName}
    </span>
  );
}

/**
 * One database seen through its three saved views: all records, a board, and
 * a timeline. The view tabs beside its name switch it, and it steps through
 * them by itself until someone picks one.
 */
export function DatabaseViewsGraphic() {
  let root!: HTMLDivElement;
  const { view, choose } = createViewStepper(
    views.map((item) => item.id),
    () => root
  );

  return (
    <div ref={root} class="database-views">
      <div class="database-views-bar">
        <DatabaseIcon class="database-views-mark" aria-hidden="true" />
        <strong>Launch projects</strong>
        <div
          class="database-views-tabs"
          role="group"
          aria-label="Database view"
        >
          <For each={views}>
            {(item) => (
              <button
                type="button"
                class="database-views-pill"
                aria-pressed={view() === item.id}
                onClick={() => choose(item.id)}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
        <span
          class="database-views-pill database-views-extra"
          aria-hidden="true"
        >
          <FilterIcon />
          <SortIcon />
        </span>
      </div>
      <div class="database-views-body" data-view={view()}>
        <Switch>
          <Match when={view() === 'table'}>
            <div class="database-views-row database-views-columns">
              <span>#</span>
              <span>
                <NameIcon aria-hidden="true" />
                Name
              </span>
              <span>
                <StatusIcon aria-hidden="true" />
                Status
              </span>
              <span class="database-views-due">
                <CalendarIcon aria-hidden="true" />
                Due
              </span>
              <span>
                <OwnerIcon aria-hidden="true" />
                Owner
              </span>
            </div>
            <For each={records}>
              {(record, index) => (
                <div class="database-views-row">
                  <span class="database-views-number">{index() + 1}</span>
                  <span class="database-views-name">{record.name}</span>
                  <span>
                    <StatusPill status={record.status} />
                  </span>
                  <span class="database-views-due">{record.due}</span>
                  <Owner owner={record.owner} />
                </div>
              )}
            </For>
            <p class="database-views-count">{records.length} records in view</p>
          </Match>
          <Match when={view() === 'board'}>
            <For each={lanes}>
              {(lane) => (
                <div class="database-views-lane">
                  <div
                    class="database-views-lane-head"
                    data-status={lane.status}
                  >
                    <i />
                    <strong>{lane.status}</strong>
                    <span>{lane.records.length}</span>
                    <DotsIcon aria-hidden="true" />
                    <PlusIcon aria-hidden="true" />
                  </div>
                  <For each={lane.records}>
                    {(record) => (
                      <div class="database-views-card">
                        <div class="database-views-card-title">
                          <span>{record.name}</span>
                          <GripIcon aria-hidden="true" />
                        </div>
                        <small>Due</small>
                        <span>{record.due}</span>
                        <small>Owner</small>
                        <Owner owner={record.owner} />
                      </div>
                    )}
                  </For>
                </div>
              )}
            </For>
          </Match>
          <Match when={view() === 'timeline'}>
            <div class="database-views-scale">
              <SidebarIcon aria-hidden="true" />
              <strong>October 2026</strong>
              <For each={marks}>
                {(mark) => (
                  <span
                    classList={{
                      'database-views-month': mark.month,
                      'database-views-minor': mark.minor,
                    }}
                    style={{ '--at': mark.at }}
                  >
                    {mark.label}
                  </span>
                )}
              </For>
            </div>
            <div class="database-views-tracks">
              <For each={marks}>
                {(mark) => (
                  <i
                    class="database-views-gridline"
                    style={{ '--at': mark.at }}
                  />
                )}
              </For>
              <i class="database-views-today" />
              <For each={records}>
                {(record) => (
                  <div class="database-views-track">
                    <div
                      class="database-views-span"
                      data-status={record.status}
                      style={{
                        '--start': record.start,
                        '--length': record.length,
                      }}
                    >
                      {record.name}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  );
}
