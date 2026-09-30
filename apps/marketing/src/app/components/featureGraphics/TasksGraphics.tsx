import {
  type Component,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import IconAi from '../../../assets/icons/icon-ai.svg';
import IconCall from '../../../assets/icons/icon-call.svg';
import IconChannels from '../../../assets/icons/icon-channels.svg';
import IconCompany from '../../../assets/icons/icon-company.svg';
import IconEmail from '../../../assets/icons/icon-email.svg';
import IconFolder from '../../../assets/icons/icon-folder.svg';
import IconGithub from '../../../assets/icons/icon-github.svg';
import IconHome from '../../../assets/icons/icon-home.svg';
import IconInbox from '../../../assets/icons/icon-inbox.svg';
import IconPlus from '../../../assets/icons/icon-plus.svg';
import IconSearch from '../../../assets/icons/icon-search.svg';
import IconTasks from '../../../assets/icons/icon-tasks.svg';
import StatusCancelled from '../../../assets/icons/square-task-cancelled-circle.svg';
import StatusCreated from '../../../assets/icons/square-task-created-circle.svg';
import StatusDone from '../../../assets/icons/square-task-done-circle.svg';
import StatusInProgress from '../../../assets/icons/square-task-in-progress-circle.svg';
import StatusInReview from '../../../assets/icons/square-task-in-review-circle.svg';
import PriorityHigh from '../../../assets/icons/wide-priority-high.svg';
import PriorityLow from '../../../assets/icons/wide-priority-low.svg';
import PriorityMedium from '../../../assets/icons/wide-priority-medium.svg';
import PriorityUrgent from '../../../assets/icons/wide-priority-urgent.svg';
import IconTaskMacro from '../../../assets/icons/wide-task.svg';
import avatarGabriel from '../../../assets/people/gabriel.webp';
import avatarJacob from '../../../assets/people/jacob.webp';
import avatarJulia from '../../../assets/people/julia.webp';
import { breakpoint, isMobileViewport } from '../../utils/utilBreakpoint';
import { TabsInset } from '../graphics/MockupChrome';
import { PreviewWindow } from '../graphics/PreviewWindow';
import { SsgDesktop, SsgMobile } from '../utils/SsgGate';

const mobile = isMobileViewport;

const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Motion for the capture connector (dashes march toward the created task) and
// the agent timeline's in-flight dot. Injected by the graphics that use the
// classes; duplicate <style> tags are harmless.
const tasksMotionStyles = `
  @media (prefers-reduced-motion: no-preference) {
    @keyframes tasksFlowMarch { to { stroke-dashoffset: -10; } }
    .tasks-flow-line { animation: tasksFlowMarch 0.9s linear infinite; }
    @keyframes tasksActivePulse { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--a0) 45%, transparent); } 70% { box-shadow: 0 0 0 6px transparent; } }
    .tasks-active-dot { animation: tasksActivePulse 2.2s ease-out infinite; }
  }
`;

function eyebrowStyle(): JSX.CSSProperties {
  return {
    color: 'var(--a0)',
    'font-family': 'rajdhani, body',
    'font-size': breakpoint() ? '12px' : '16px',
    'letter-spacing': '0.08em',
    'text-transform': 'uppercase',
  };
}

// ---------------------------------------------------------------------------
// App-chrome icons (Macro product nav set)
// ---------------------------------------------------------------------------

const NAV_ICONS: Record<string, Component<{ style?: JSX.CSSProperties }>> = {
  create: IconPlus,
  home: IconHome,
  inbox: IconInbox,
  search: IconSearch,
  agents: IconAi,
  email: IconEmail,
  files: IconFolder,
  tasks: IconTasks,
  channels: IconChannels,
  calls: IconCall,
  companies: IconCompany,
};

function navIconStyle(props: {
  active?: boolean;
  accent?: boolean;
  size?: number;
}): JSX.CSSProperties {
  const s = props.size ?? 16;
  return {
    color: props.accent
      ? 'var(--a0)'
      : props.active
        ? 'var(--c1)'
        : 'var(--c4)',
    display: 'block',
    flex: 'none',
    height: `${s}px`,
    overflow: 'visible',
    width: `${s}px`,
  };
}

function MacroNavIcon(props: {
  name: string;
  active?: boolean;
  accent?: boolean;
  size?: number;
}) {
  const Icon = NAV_ICONS[props.name];
  if (!Icon) return null;
  return <Icon aria-hidden="true" style={navIconStyle(props)} />;
}

// Real headshots for the recurring fictional teammates, keyed by their
// initials so every graphic on the page shows a consistent face.
const AVATAR_PHOTOS: Record<string, string> = {
  GB: avatarGabriel,
  JW: avatarJulia,
  JB: avatarJacob,
};

function Avatar(props: {
  initials: string;
  size?: number;
  color?: string;
  image?: string;
}) {
  const s = props.size ?? 26;
  const photo = () => props.image ?? AVATAR_PHOTOS[props.initials];
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        'background-color': props.color ?? 'var(--b3)',
        border: '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        display: 'inline-grid',
        flex: 'none',
        'font-family': appFont,
        'font-size': `${Math.round(s * 0.38)}px`,
        'font-weight': '600',
        height: `${s}px`,
        overflow: 'hidden',
        'place-items': 'center',
        width: `${s}px`,
      }}
    >
      <Show when={photo()} fallback={props.initials}>
        <img
          src={photo()}
          alt=""
          width={s}
          height={s}
          style={{
            display: 'block',
            height: '100%',
            'object-fit': 'cover',
            width: '100%',
          }}
        />
      </Show>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------

function ChevronGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 12;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M6 9l6 6 6-6"
        fill="none"
        stroke={props.color ?? 'var(--c4)'}
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function SparkleGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 12;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M12 5c.4 4.6 2.4 6.6 7 7-4.6.4-6.6 2.4-7 7-.4-4.6-2.4-6.6-7-7 4.6-.4 6.6-2.4 7-7z"
        fill={props.color ?? 'currentColor'}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Status & priority icons (mirroring the real Tasks UI)
// ---------------------------------------------------------------------------

type StatusKind =
  | 'not-started'
  | 'in-progress'
  | 'in-review'
  | 'completed'
  | 'canceled';

const STATUS_META: Record<StatusKind, { label: string; color: string }> = {
  'not-started': { label: 'Not Started', color: 'var(--a2)' },
  'in-progress': { label: 'In Progress', color: 'var(--a0)' },
  'in-review': { label: 'In Review', color: 'var(--a4)' },
  completed: { label: 'Completed', color: 'var(--a0)' },
  canceled: { label: 'Canceled', color: 'var(--c4)' },
};

// Canonical Macro status circles (square-task-*-circle), tinted by status color.
const STATUS_ICON: Record<
  StatusKind,
  Component<{ style?: JSX.CSSProperties }>
> = {
  'not-started': StatusCreated,
  'in-progress': StatusInProgress,
  'in-review': StatusInReview,
  completed: StatusDone,
  canceled: StatusCancelled,
};

function StatusIcon(props: { kind: StatusKind; size?: number }) {
  const s = props.size ?? 16;
  return (
    <Dynamic
      component={STATUS_ICON[props.kind]}
      aria-hidden="true"
      style={{
        color: STATUS_META[props.kind].color,
        display: 'block',
        flex: 'none',
        height: `${s}px`,
        width: `${s}px`,
      }}
    />
  );
}

type PriorityKind = 'none' | 'low' | 'medium' | 'high' | 'urgent';

const PRIORITY_META: Record<PriorityKind, { label: string }> = {
  none: { label: 'No priority' },
  low: { label: 'Low' },
  medium: { label: 'Medium' },
  high: { label: 'High' },
  urgent: { label: 'Urgent' },
};

// Canonical Macro priority bars (wide-priority-*). Neutral for low/med/high,
// accent for urgent; "none" falls back to a faint dashed circle.
const PRIORITY_ICON: Partial<
  Record<PriorityKind, Component<{ style?: JSX.CSSProperties }>>
> = {
  low: PriorityLow,
  medium: PriorityMedium,
  high: PriorityHigh,
  urgent: PriorityUrgent,
};

function PriorityIcon(props: { kind: PriorityKind; size?: number }) {
  const s = props.size ?? 16;
  if (props.kind === 'none') {
    return (
      <svg
        width={s}
        height={s}
        viewBox="0 0 24 24"
        aria-hidden="true"
        style={{ display: 'block', flex: 'none' }}
      >
        <circle
          cx="12"
          cy="12"
          r="7.5"
          fill="none"
          stroke="color-mix(in srgb, var(--c4) 50%, transparent)"
          stroke-width="2"
          stroke-dasharray="2.2 2.6"
        />
      </svg>
    );
  }
  // The bar glyphs are 3:2 (low/med/high) — keep their aspect (height drives it).
  return (
    <Dynamic
      component={PRIORITY_ICON[props.kind]!}
      aria-hidden="true"
      style={{
        color: props.kind === 'urgent' ? 'var(--a0)' : 'var(--c2)',
        display: 'block',
        flex: 'none',
        height: `${Math.round(s * 0.78)}px`,
        width: `${s}px`,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Hero: realistic app window (grouped task list + Ask-AI bar)
// ---------------------------------------------------------------------------

const heroTabs = ['Assigned', 'Created', 'All'];

// The green task icon prefixing every task row — the Macro app's tasks icon.
function TaskRowGlyph(props: { size?: number }) {
  const s = props.size ?? 15;
  return (
    <IconTaskMacro
      aria-hidden="true"
      style={{
        color: 'var(--a2)',
        display: 'block',
        flex: 'none',
        height: `${s}px`,
        width: `${s}px`,
      }}
    />
  );
}

type HeroAssignee = {
  initials: string;
  label: string;
  extra?: number;
  agent?: boolean;
};

interface HeroTaskRow {
  title: string;
  status: StatusKind;
  priority: PriorityKind;
  assignee: HeroAssignee;
  createdBy: { initials: string; label: string };
  updated: string;
  selected?: boolean;
}

interface HeroStatusGroup {
  status: StatusKind;
  count: number;
  loadMore?: boolean;
  rows: HeroTaskRow[];
}

const heroGroups: HeroStatusGroup[] = [
  {
    status: 'not-started',
    count: 5,
    rows: [
      {
        title: 'Port PDF package to Solid.js',
        status: 'not-started',
        priority: 'medium',
        assignee: { initials: 'JB', label: 'Jacob' },
        createdBy: { initials: 'TN', label: 'Teo' },
        updated: 'May 14',
        selected: true,
      },
      {
        title: 'Generate team memory with MCP',
        status: 'not-started',
        priority: 'medium',
        assignee: { initials: 'GB', label: 'Gabriel' },
        createdBy: { initials: 'GB', label: 'Gabriel' },
        updated: 'Jun 12',
      },
    ],
  },
  {
    status: 'in-progress',
    count: 2,
    rows: [
      {
        title: 'Ship realtime sync to the finish line',
        status: 'in-progress',
        priority: 'high',
        assignee: { initials: 'JW', label: 'Julia' },
        createdBy: { initials: 'TN', label: 'Teo' },
        updated: '2:14 PM',
      },
    ],
  },
];

// A stack of overlapping avatars for multi-assignee rows.
function AvatarStack(props: { count: number }) {
  const items = () => Array.from({ length: Math.min(props.count, 3) });
  const colors = ['var(--b3)', 'var(--b4)', 'var(--b3)'];
  return (
    <span style={{ 'align-items': 'center', display: 'inline-flex' }}>
      <For each={items()}>
        {(_, i) => (
          <span
            style={{
              'border-radius': '999px',
              'box-shadow': '0 0 0 1.5px var(--b0)',
              display: 'inline-flex',
              'margin-left': i() === 0 ? '0' : '-6px',
            }}
          >
            <Avatar initials="" size={18} color={colors[i() % 3]} />
          </span>
        )}
      </For>
    </span>
  );
}

function HeroAssigneeCell(props: { assignee: HeroAssignee; compact: boolean }) {
  if (props.assignee.agent) {
    // Match the human assignee shape — a round avatar + name — rather than a
    // bordered pill, so the agent reads as just another assignee.
    return (
      <span
        style={{ 'align-items': 'center', display: 'inline-flex', gap: '7px' }}
      >
        <span
          style={{
            'align-items': 'center',
            'background-color': 'color-mix(in srgb, var(--a0) 18%, var(--b1))',
            'border-radius': '999px',
            display: 'inline-flex',
            flex: 'none',
            height: '20px',
            'justify-content': 'center',
            width: '20px',
          }}
        >
          <IconAi
            style={{
              color: 'var(--a0)',
              height: '12px',
              width: '12px',
              flex: 'none',
            }}
          />
        </span>
        <Show when={!props.compact}>
          <span
            style={{
              color: 'var(--c2)',
              'font-family': appFont,
              'font-size': '12.5px',
              'white-space': 'nowrap',
            }}
          >
            Agent
          </span>
        </Show>
      </span>
    );
  }
  if (props.assignee.extra) {
    return (
      <span
        style={{ 'align-items': 'center', display: 'inline-flex', gap: '7px' }}
      >
        <AvatarStack count={(props.assignee.extra ?? 0) + 1} />
        <Show when={!props.compact}>
          <span
            style={{
              color: 'var(--c2)',
              'font-family': appFont,
              'font-size': '12.5px',
              'white-space': 'nowrap',
            }}
          >
            {props.assignee.label}
          </span>
        </Show>
      </span>
    );
  }
  return (
    <span
      style={{ 'align-items': 'center', display: 'inline-flex', gap: '7px' }}
    >
      <Avatar initials={props.assignee.initials} size={20} color="var(--b3)" />
      <Show when={!props.compact}>
        <span
          style={{
            color: 'var(--c2)',
            'font-family': appFont,
            'font-size': '12.5px',
            'white-space': 'nowrap',
          }}
        >
          {props.assignee.label}
        </span>
      </Show>
    </span>
  );
}

export function HeroTaskWindow() {
  const _compact = () => mobile();
  const [activeTab, setActiveTab] = createSignal(0);
  // Hover-driven selection (same pattern as the email window): the route's
  // :hover CSS isn't injected in the home preview, and an inline background
  // would override it anyway — so reflect the hovered row in inline state.
  const [selected, setSelected] = createSignal(
    heroGroups.flatMap((g) => g.rows).find((r) => r.selected)?.title ?? ''
  );
  const headerCell: JSX.CSSProperties = {
    'align-items': 'center',
    color: 'var(--c4)',
    display: 'inline-flex',
    'font-family': appFont,
    'font-size': '11.5px',
    gap: '5px',
    'white-space': 'nowrap',
  };

  return (
    <PreviewWindow
      class="tasks-hero-window"
      mask="linear-gradient(to bottom, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 70%, rgb(0 0 0 / 0.18) 100%)"
    >
      <style>{`
          /* Viewport-dependent styling lives in CSS (not JS ternaries) so the
             1440px build-time prerender paints correctly on phones before the
             JS bundle loads. */
          .tasks-gfx-hero-toolbar { gap: 16px; height: 46px; padding: 0 16px; }
          .tasks-gfx-hero-title { font-size: 15px; }
          .tasks-gfx-hero-cols { grid-template-columns: minmax(0, 1fr) 104px 44px 124px 52px; }
          .tasks-gfx-hero-list { min-height: 300px; }
          .tasks-gfx-hero-group { padding: 10px 16px 4px; }
          .tasks-gfx-hero-row { gap: 12px; padding: 9px 16px; }
          @media (max-width: 699px) {
            .tasks-gfx-hero-toolbar { gap: 12px; height: 42px; padding: 0 13px; }
            .tasks-gfx-hero-title { font-size: 14px; }
            .tasks-gfx-hero-cols { grid-template-columns: auto minmax(0, 1fr) auto auto; }
            .tasks-gfx-hero-list { min-height: 0; }
            .tasks-gfx-hero-group { padding: 9px 13px 4px; }
            .tasks-gfx-hero-row { gap: 10px; padding: 11px 13px; }
          }
        `}</style>
      {/* Tasks pane */}
      <div
        style={{
          display: 'grid',
          'grid-template-rows': 'auto auto 1fr auto',
          'min-width': 0,
        }}
      >
        {/* Toolbar: title + tabs + new task */}
        <div
          class="tasks-gfx-hero-toolbar"
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--b4) 18%, transparent)',
            'box-sizing': 'border-box',
            display: 'flex',
            overflow: 'hidden',
          }}
        >
          <span
            class="tasks-gfx-hero-title"
            style={{
              'align-items': 'center',
              color: 'var(--c1)',
              display: 'inline-flex',
              'font-family': appFont,
              'font-weight': '500',
              gap: '8px',
            }}
          >
            <MacroNavIcon name="tasks" active size={16} /> Tasks
          </span>
          <SsgDesktop>
            <TabsInset
              tabs={heroTabs}
              active={activeTab()}
              onSelect={setActiveTab}
              compact={false}
              compactMaxIndex={2}
            />
          </SsgDesktop>
          <SsgMobile>
            <TabsInset
              tabs={heroTabs}
              active={activeTab()}
              onSelect={setActiveTab}
              compact
              compactMaxIndex={2}
            />
          </SsgMobile>
        </div>

        {/* Column headers */}
        <SsgDesktop>
          <div
            class="tasks-gfx-hero-cols"
            style={{
              'align-items': 'center',
              color: 'var(--c4)',
              display: 'grid',
              gap: '12px',
              padding: '7px 16px',
            }}
          >
            <span style={{ ...headerCell, 'padding-left': '18px' }}>Task</span>
            <span style={headerCell}>Status</span>
            <span style={headerCell}>Priority</span>
            <span style={headerCell}>Assignees</span>
            <span style={{ ...headerCell, 'justify-content': 'flex-end' }}>
              Updated
            </span>
          </div>
        </SsgDesktop>

        {/* Grouped by status with subtle (un-coloured) headers; the Status
              column intentionally repeats each group's status. */}
        <div
          class="tasks-gfx-hero-list"
          style={{ display: 'grid', 'align-content': 'start' }}
        >
          <For each={heroGroups}>
            {(group) => (
              <>
                {/* Subtle group header — status icon, muted label, count;
                      no coloured band. */}
                <div
                  class="tasks-gfx-hero-group"
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    gap: '7px',
                  }}
                >
                  <ChevronGlyph size={11} />
                  <StatusIcon kind={group.status} size={13} />
                  <span
                    style={{
                      color: 'var(--c2)',
                      'font-family': appFont,
                      'font-size': '12px',
                      'font-weight': '600',
                    }}
                  >
                    {STATUS_META[group.status].label}
                  </span>
                  <span
                    style={{
                      color: 'var(--c4)',
                      'font-family': appFont,
                      'font-size': '11px',
                      'font-weight': '500',
                    }}
                  >
                    {group.count}
                  </span>
                  {/* Faint hairline running right from the label — matches the
                        email/calls temporal dividers (PreviewListDivider). */}
                  <span
                    aria-hidden="true"
                    style={{
                      'background-color':
                        'color-mix(in srgb, var(--b4) 12%, transparent)',
                      flex: '1 1 0',
                      height: '1px',
                    }}
                  />
                </div>
                <For each={group.rows}>
                  {(row) => (
                    <div
                      class="tasks-hero-row tasks-gfx-hero-row tasks-gfx-hero-cols"
                      onMouseEnter={() => setSelected(row.title)}
                      style={{
                        'align-items': 'center',
                        'background-color':
                          selected() === row.title
                            ? 'color-mix(in srgb, var(--c1) 4%, transparent)'
                            : 'transparent',
                        'border-radius': '8px',
                        'box-sizing': 'border-box',
                        cursor: 'pointer',
                        display: 'grid',
                        transition: 'background-color 120ms ease',
                      }}
                    >
                      <SsgMobile>
                        <StatusIcon kind={row.status} size={16} />
                        <span
                          style={{
                            color: 'var(--c1)',
                            'font-family': appFont,
                            'font-size': '13px',
                            'min-width': 0,
                            overflow: 'hidden',
                            'text-overflow': 'ellipsis',
                            'white-space': 'nowrap',
                          }}
                        >
                          {row.title}
                        </span>
                        <PriorityIcon kind={row.priority} size={15} />
                        <HeroAssigneeCell assignee={row.assignee} compact />
                      </SsgMobile>
                      <SsgDesktop>
                        {/* Task — indented by the group header's chevron+gap (18px)
                        so the task icon lines up under the group status icon. */}
                        <span
                          style={{
                            'align-items': 'center',
                            display: 'inline-flex',
                            gap: '10px',
                            'min-width': 0,
                            'padding-left': '18px',
                          }}
                        >
                          <TaskRowGlyph size={15} />
                          <span
                            style={{
                              color: 'var(--c1)',
                              'font-family': appFont,
                              'font-size': '14px',
                              'min-width': 0,
                              overflow: 'hidden',
                              'text-overflow': 'ellipsis',
                              'white-space': 'nowrap',
                            }}
                          >
                            {row.title}
                          </span>
                        </span>
                        {/* Status */}
                        <span
                          style={{
                            'align-items': 'center',
                            display: 'inline-flex',
                            gap: '6px',
                            'min-width': 0,
                          }}
                        >
                          <StatusIcon kind={row.status} size={14} />
                          <span
                            style={{
                              color: 'var(--c2)',
                              'font-family': appFont,
                              'font-size': '12px',
                              overflow: 'hidden',
                              'text-overflow': 'ellipsis',
                              'white-space': 'nowrap',
                            }}
                          >
                            {STATUS_META[row.status].label}
                          </span>
                        </span>
                        {/* Priority */}
                        <span
                          style={{
                            'align-items': 'center',
                            display: 'inline-flex',
                          }}
                        >
                          <PriorityIcon kind={row.priority} size={15} />
                        </span>
                        {/* Assignees */}
                        <HeroAssigneeCell
                          assignee={row.assignee}
                          compact={false}
                        />
                        {/* Updated */}
                        <span
                          style={{
                            color: 'var(--c4)',
                            'font-family': appFont,
                            'font-size': '12px',
                            'text-align': 'right',
                            'white-space': 'nowrap',
                          }}
                        >
                          {row.updated}
                        </span>
                      </SsgDesktop>
                    </div>
                  )}
                </For>
              </>
            )}
          </For>
        </div>
      </div>
    </PreviewWindow>
  );
}

// ---------------------------------------------------------------------------
// Task management spotlight — the hero task list with the selected task's
// management panel popped over its right edge. Static composition for the
// closing "guide the work" section.
// ---------------------------------------------------------------------------

function PanelCheckbox(props: { done?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        'background-color': props.done ? 'var(--a2)' : 'transparent',
        border: props.done
          ? '0'
          : '1.5px solid color-mix(in srgb, var(--c4) 40%, transparent)',
        'border-radius': '5px',
        'box-sizing': 'border-box',
        color: 'var(--b0)',
        display: 'inline-grid',
        flex: 'none',
        height: '15px',
        'place-items': 'center',
        width: '15px',
      }}
    >
      <Show when={props.done}>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          style={{ display: 'block' }}
        >
          <path
            d="M5 12l4.5 4.5L19 7"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </Show>
    </span>
  );
}

function TaskManagementPanel() {
  const compact = () => mobile();
  const pillStyle: JSX.CSSProperties = {
    'align-items': 'center',
    border: '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
    'border-radius': '999px',
    color: 'var(--c2)',
    display: 'inline-flex',
    'font-family': appFont,
    'font-size': '11.5px',
    gap: '6px',
    padding: '4px 9px',
    'white-space': 'nowrap',
  };
  const bodyText: JSX.CSSProperties = {
    color: 'var(--c4)',
    'font-family': appFont,
    'font-size': '12.5px',
    'line-height': 1.5,
  };
  const checkRow: JSX.CSSProperties = {
    'align-items': 'center',
    display: 'flex',
    gap: '9px',
  };
  return (
    <div
      style={{
        'background-color': 'var(--b1)',
        border: '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
        'border-radius': '14px',
        'box-shadow': 'var(--shadow-panel-lg)',
        'box-sizing': 'border-box',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      {/* Title */}
      <div
        style={{
          'align-items': 'center',
          display: 'flex',
          gap: '10px',
          padding: '13px 15px 10px',
        }}
      >
        <TaskRowGlyph size={16} />
        <span
          style={{
            color: 'var(--c1)',
            'font-family': appFont,
            'font-size': compact() ? '13.5px' : '14px',
            'font-weight': '600',
            'line-height': 1.25,
            'min-width': 0,
          }}
        >
          Port PDF package to Solid.js
        </span>
      </div>
      {/* Properties */}
      <div
        style={{
          'align-items': 'center',
          display: 'flex',
          'flex-wrap': 'wrap',
          gap: '7px',
          padding: '0 15px 12px',
        }}
      >
        <span style={pillStyle}>
          <StatusIcon kind="not-started" size={13} /> Not Started
        </span>
        <span style={pillStyle}>
          <PriorityIcon kind="medium" size={13} /> Medium
        </span>
        <span style={pillStyle}>
          <Avatar initials="JB" size={16} color="var(--b3)" /> Jacob
        </span>
      </div>
      {/* Description + checklist */}
      <div
        style={{
          'border-top':
            '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          display: 'grid',
          gap: '10px',
          padding: '12px 15px',
        }}
      >
        <span style={bodyText}>
          Move the PDF viewer onto Solid primitives without breaking existing
          embeds.
        </span>
        <div style={{ display: 'grid', gap: '8px' }}>
          <div style={checkRow}>
            <PanelCheckbox done />
            <span style={bodyText}>Port render pipeline</span>
          </div>
          <div style={checkRow}>
            <PanelCheckbox done />
            <span style={bodyText}>Swap hooks for signals</span>
          </div>
          <div style={checkRow}>
            <PanelCheckbox />
            <span style={{ ...bodyText, color: 'var(--c2)' }}>
              Update embed API docs
            </span>
          </div>
        </div>
      </div>
      {/* Activity */}
      <div
        style={{
          'border-top':
            '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          display: 'grid',
          gap: '9px',
          padding: '11px 15px 13px',
        }}
      >
        <span
          style={{
            color: 'var(--c4)',
            'font-family': appFont,
            'font-size': '10.5px',
            'font-weight': '600',
            'letter-spacing': '0.06em',
            'text-transform': 'uppercase',
          }}
        >
          Activity
        </span>
        <div style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}>
          <span
            style={{
              'align-items': 'center',
              background:
                'linear-gradient(135deg, var(--a0), color-mix(in srgb, var(--a0) 55%, var(--b0)))',
              'border-radius': '999px',
              color: 'var(--b0)',
              display: 'inline-flex',
              flex: 'none',
              height: '18px',
              'justify-content': 'center',
              width: '18px',
            }}
          >
            <SparkleGlyph size={10} />
          </span>
          <span
            style={{
              ...bodyText,
              'font-size': '12px',
              'min-width': 0,
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
            }}
          >
            <span style={{ color: 'var(--c2)' }}>Macro</span> added the
            migration checklist
          </span>
          <span
            style={{
              color: 'var(--c4)',
              flex: 'none',
              'font-family': appFont,
              'font-size': '11px',
              'margin-left': 'auto',
              opacity: 0.7,
            }}
          >
            May 14
          </span>
        </div>
        <div style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}>
          <Avatar initials="TN" size={18} color="var(--b3)" />
          <span
            style={{
              ...bodyText,
              'font-size': '12px',
              'min-width': 0,
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
            }}
          >
            <span style={{ color: 'var(--c2)' }}>Teo</span> created this task
          </span>
          <span
            style={{
              color: 'var(--c4)',
              flex: 'none',
              'font-family': appFont,
              'font-size': '11px',
              'margin-left': 'auto',
              opacity: 0.7,
            }}
          >
            May 12
          </span>
        </div>
        {/* Comment field hint */}
        <div
          style={{
            'align-items': 'center',
            border: '1px solid color-mix(in srgb, var(--c4) 18%, transparent)',
            'border-radius': '9px',
            color: 'var(--c4)',
            display: 'flex',
            'font-family': appFont,
            'font-size': '12px',
            'margin-top': '2px',
            padding: '7px 11px',
          }}
        >
          Leave a comment…
        </div>
      </div>
    </div>
  );
}

export function TaskManagementSpotlight() {
  const compact = () => mobile();
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        position: 'relative',
        width: '100%',
      }}
    >
      <HeroTaskWindow />
      <div
        style={
          compact()
            ? {
                filter: 'drop-shadow(0 14px 30px rgb(0 0 0 / 0.45))',
                'justify-self': 'center',
                'margin-top': '-46px',
                width: 'min(340px, 94%)',
                'z-index': 1,
              }
            : {
                filter: 'drop-shadow(0 18px 40px rgb(0 0 0 / 0.5))',
                position: 'absolute',
                right: '3%',
                top: '54px',
                width: 'min(330px, 36%)',
                'z-index': 1,
              }
        }
      >
        <TaskManagementPanel />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capture graphic — turn a channel message into an email in one click
// ---------------------------------------------------------------------------

function EmailFromMessageGlyph(props: { size?: number }) {
  const s = props.size ?? 16;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
      />
      <path
        d="M4 7l8 6 8-6"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function _CaptureGraphic() {
  const compact = () => mobile();
  const cardStyle: JSX.CSSProperties = {
    'background-color': '#0a0a0a',
    border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
    'border-radius': '12px',
    'box-shadow':
      'var(--shadow-panel-sm), inset 0 1px 0 color-mix(in srgb, var(--c1) 7%, transparent)',
    'box-sizing': 'border-box',
    width: 'min(440px, 100%)',
  };

  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '0',
        'justify-items': 'center',
        padding: compact() ? '34px 18px' : '40px 24px',
        width: '100%',
      }}
    >
      {/* Source: channel message with a hover "create task" action */}
      <div style={cardStyle}>
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            gap: '8px',
            'justify-content': 'space-between',
            padding: '10px 14px',
          }}
        >
          <span
            style={{
              'align-items': 'center',
              color: 'var(--c1)',
              display: 'inline-flex',
              'font-family': appFont,
              'font-size': '13px',
              'font-weight': '600',
              gap: '7px',
              'min-width': 0,
            }}
          >
            <EmailFromMessageGlyph size={15} />
            Re: Customer Feedback
          </span>
          <span
            style={{
              'align-items': 'center',
              border:
                '1px solid color-mix(in srgb, var(--c4) 18%, transparent)',
              'border-radius': '7px',
              color: 'var(--c2)',
              display: 'inline-flex',
              flex: 'none',
              'font-family': appFont,
              'font-size': '12.5px',
              gap: '6px',
              padding: '5px 10px',
              'white-space': 'nowrap',
            }}
          >
            <EmailFromMessageGlyph size={13} />
            Reply by email
          </span>
        </div>
        <div
          style={{
            'align-items': 'flex-start',
            display: 'flex',
            gap: '11px',
            padding: '13px 14px',
          }}
        >
          <Avatar initials="LH" size={28} color="var(--b3)" />
          <div style={{ display: 'grid', gap: '3px', 'min-width': 0 }}>
            <span
              style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}
            >
              <span
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': '13.5px',
                  'font-weight': '600',
                }}
              >
                Lena Hartwell
              </span>
              <span
                style={{
                  color: 'var(--c4)',
                  'font-family': appFont,
                  'font-size': '11.5px',
                }}
              >
                9:14 AM
              </span>
            </span>
            <span
              style={{
                color: 'var(--c2)',
                'font-family': appFont,
                'font-size': compact() ? '13px' : '14px',
                'line-height': 1.5,
              }}
            >
              Deploys are flaking again. The pipeline times out on the realtime
              sync tests about half the time.
            </span>
          </div>
        </div>
      </div>

      {/* Connector */}
      <div
        aria-hidden="true"
        style={{
          'align-items': 'center',
          display: 'grid',
          gap: '8px',
          'grid-template-columns': 'auto auto',
          padding: '14px 0',
        }}
      >
        <svg
          width="14"
          height="56"
          viewBox="0 0 14 56"
          aria-hidden="true"
          style={{ overflow: 'visible' }}
        >
          <line
            class="tasks-flow-line"
            x1="7"
            y1="0"
            x2="7"
            y2="46"
            stroke="var(--a0)"
            stroke-width="1.5"
            stroke-dasharray="5 5"
          />
          <path d="M2 46 L7 54 L12 46 Z" fill="var(--a0)" />
        </svg>
        <span
          style={{
            color: 'var(--a0)',
            'font-family': 'rajdhani, body',
            'font-size': '12px',
            'font-weight': '700',
            'letter-spacing': '0.08em',
            'line-height': 1,
            'text-transform': 'uppercase',
          }}
        >
          One click
        </span>
      </div>

      {/* Resulting email draft, @linked back to the message */}
      <div
        style={{
          ...cardStyle,
          'border-color': 'color-mix(in srgb, var(--a0) 40%, transparent)',
        }}
      >
        <div
          style={{
            'align-items': 'center',
            display: 'flex',
            gap: '11px',
            padding: '13px 14px 10px',
          }}
        >
          <span style={{ color: 'var(--a0)', display: 'inline-flex' }}>
            <EmailFromMessageGlyph size={17} />
          </span>
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': compact() ? '14px' : '15px',
              'line-height': 1.2,
            }}
          >
            Re: Deploys are flaking again
          </span>
        </div>
        <div
          style={{
            'border-top':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'grid',
            gap: '8px',
            padding: '11px 14px',
          }}
        >
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '12px',
            }}
          >
            To <span style={{ color: 'var(--c2)' }}>Lena Hartwell</span>
          </span>
          <span
            style={{
              color: 'var(--c2)',
              'font-family': appFont,
              'font-size': compact() ? '13px' : '13.5px',
              'line-height': 1.5,
            }}
          >
            Thanks for the flag. Digging into the realtime sync timeouts now and
            will follow up here.
          </span>
          <div
            style={{
              display: 'flex',
              'flex-wrap': 'wrap',
              gap: '8px',
              'margin-top': '2px',
            }}
          >
            <span
              style={{
                'align-items': 'center',
                'background-color':
                  'color-mix(in srgb, var(--a0) 14%, transparent)',
                'border-radius': '6px',
                color: 'var(--a0)',
                display: 'inline-flex',
                'font-family': appFont,
                'font-size': '11.5px',
                'font-weight': '600',
                gap: '5px',
                padding: '4px 8px',
              }}
            >
              <span style={{ 'font-weight': '700' }}>#</span> linked to
              bug-reports
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capture-to-task graphic — a channel message becomes a task in one click
// ---------------------------------------------------------------------------

export function CaptureTaskGraphic() {
  const cardStyle: JSX.CSSProperties = {
    'background-color': '#0a0a0a',
    border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
    'border-radius': '12px',
    'box-shadow':
      'var(--shadow-panel-sm), inset 0 1px 0 color-mix(in srgb, var(--c1) 7%, transparent)',
    'box-sizing': 'border-box',
    width: 'min(440px, 100%)',
  };

  return (
    <div
      class="tasks-gfx-capture"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '0',
        'justify-items': 'center',
        width: '100%',
      }}
    >
      <style>{tasksMotionStyles}</style>
      <style>{`
        /* Viewport-dependent styling lives in CSS (not JS ternaries) so the
           1440px build-time prerender paints correctly on phones before the
           JS bundle loads. */
        .tasks-gfx-capture { padding: 16px 24px; }
        .tasks-gfx-capture-msg { font-size: 14px; }
        .tasks-gfx-capture-connector { padding: 14px 0; }
        .tasks-gfx-capture-title { font-size: 15px; }
        @media (max-width: 699px) {
          .tasks-gfx-capture { padding: 12px 14px; }
          .tasks-gfx-capture-msg { font-size: 13px; }
          .tasks-gfx-capture-connector { padding: 10px 0; }
          .tasks-gfx-capture-title { font-size: 14px; }
        }
      `}</style>
      {/* Source: a channel message with a hover "create task" action */}
      <div style={cardStyle}>
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            gap: '8px',
            'justify-content': 'space-between',
            padding: '10px 14px',
          }}
        >
          <span
            style={{
              'align-items': 'center',
              color: 'var(--c1)',
              display: 'inline-flex',
              'font-family': appFont,
              'font-size': '13px',
              'font-weight': '600',
              gap: '7px',
              'min-width': 0,
            }}
          >
            <MacroNavIcon name="channels" size={15} />
            bug-reports
          </span>
          <span
            style={{
              'align-items': 'center',
              'background-color':
                'color-mix(in srgb, var(--c4) 12%, transparent)',
              border:
                '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
              'border-radius': '7px',
              color: 'var(--c2)',
              display: 'inline-flex',
              flex: 'none',
              'font-family': appFont,
              'font-size': '12.5px',
              'font-weight': '400',
              gap: '6px',
              padding: '5px 10px',
              'white-space': 'nowrap',
            }}
          >
            <MacroNavIcon name="tasks" size={13} />
            Create task
          </span>
        </div>
        <div
          style={{
            'align-items': 'flex-start',
            display: 'flex',
            gap: '11px',
            padding: '13px 14px',
          }}
        >
          <Avatar initials="LH" size={28} color="var(--b3)" />
          <div style={{ display: 'grid', gap: '3px', 'min-width': 0 }}>
            <span
              style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}
            >
              <span
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': '13.5px',
                  'font-weight': '600',
                }}
              >
                Lena Hartwell
              </span>
              <span
                style={{
                  color: 'var(--c4)',
                  'font-family': appFont,
                  'font-size': '11.5px',
                }}
              >
                9:14 AM
              </span>
            </span>
            <span
              class="tasks-gfx-capture-msg"
              style={{
                color: 'var(--c2)',
                'font-family': appFont,
                'line-height': 1.5,
              }}
            >
              Deploys are flaking again. The pipeline times out on the realtime
              sync tests about half the time.
            </span>
          </div>
        </div>
      </div>

      {/* Connector */}
      <div
        aria-hidden="true"
        class="tasks-gfx-capture-connector"
        style={{
          display: 'grid',
          'justify-items': 'center',
          position: 'relative',
          width: '100%',
        }}
      >
        <svg
          width="14"
          height="56"
          viewBox="0 0 14 56"
          aria-hidden="true"
          style={{ overflow: 'visible' }}
        >
          <line
            class="tasks-flow-line"
            x1="7"
            y1="0"
            x2="7"
            y2="46"
            stroke="var(--a0)"
            stroke-width="1.5"
            stroke-dasharray="5 5"
          />
          <path d="M2 46 L7 54 L12 46 Z" fill="var(--a0)" />
        </svg>
        <span
          style={{
            color: 'var(--a0)',
            'font-family': 'rajdhani, body',
            'font-size': '12px',
            'font-weight': '700',
            left: 'calc(50% + 15px)',
            'letter-spacing': '0.08em',
            'line-height': 1,
            position: 'absolute',
            top: '50%',
            transform: 'translateY(-50%)',
            'text-transform': 'uppercase',
            'white-space': 'nowrap',
          }}
        >
          One click
        </span>
      </div>

      {/* Resulting task, @linked back to the message */}
      <div
        style={{
          ...cardStyle,
          'border-color': 'color-mix(in srgb, var(--a0) 40%, transparent)',
        }}
      >
        <div
          style={{
            'align-items': 'center',
            display: 'flex',
            gap: '11px',
            padding: '13px 14px 11px',
          }}
        >
          <StatusIcon kind="not-started" size={18} />
          <span
            class="tasks-gfx-capture-title"
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'line-height': 1.2,
              'min-width': 0,
            }}
          >
            Fix flaky deploy pipeline
          </span>
        </div>
        <div
          style={{
            'align-items': 'center',
            'border-top':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            'flex-wrap': 'wrap',
            gap: '8px',
            padding: '11px 14px',
          }}
        >
          <span
            style={{
              'align-items': 'center',
              border:
                '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
              'border-radius': '999px',
              color: 'var(--c2)',
              display: 'inline-flex',
              'font-family': appFont,
              'font-size': '11.5px',
              'font-weight': '400',
              gap: '6px',
              padding: '4px 9px',
            }}
          >
            <StatusIcon kind="not-started" size={13} /> Not Started
          </span>
          <span
            style={{
              'align-items': 'center',
              border:
                '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
              'border-radius': '999px',
              color: 'var(--c2)',
              display: 'inline-flex',
              'font-family': appFont,
              'font-size': '11.5px',
              'font-weight': '400',
              gap: '6px',
              padding: '3px 9px 3px 7px',
            }}
          >
            <Avatar initials="EH" size={16} color="var(--b3)" /> Eric
          </span>
          <span
            style={{
              'align-items': 'center',
              'background-color':
                'color-mix(in srgb, var(--c4) 12%, transparent)',
              'border-radius': '6px',
              color: 'var(--c2)',
              display: 'inline-flex',
              'font-family': appFont,
              'font-size': '11.5px',
              'font-weight': '400',
              gap: '5px',
              'margin-left': 'auto',
              padding: '4px 8px',
            }}
          >
            # linked to bug-reports
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status & priority graphic — the real picker menus
// ---------------------------------------------------------------------------

const statusOrder: StatusKind[] = [
  'not-started',
  'in-progress',
  'in-review',
  'completed',
  'canceled',
];
const priorityOrder: PriorityKind[] = [
  'none',
  'low',
  'medium',
  'high',
  'urgent',
];

// The bare dropdown panel (search header + rows) shared by the picker menus and
// the anchored status-menu composition below.
function PickerPanel(props: { heading: string; children: JSX.Element }) {
  return (
    <div
      style={{
        'background-color': 'var(--b1)',
        border: '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
        'border-radius': '14px',
        'box-shadow': 'var(--shadow-panel-lg)',
        'box-sizing': 'border-box',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          'align-items': 'center',
          'border-bottom':
            '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          display: 'flex',
          gap: '8px',
          padding: '9px 16px',
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ color: 'var(--a0)', display: 'block', flex: 'none' }}
        >
          <circle
            cx="11"
            cy="11"
            r="6"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          />
          <path
            d="M20 20l-4-4"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
        <span
          style={{
            color: 'var(--c4)',
            'font-family': appFont,
            'font-size': '12px',
          }}
        >
          {props.heading}
        </span>
      </div>
      <div style={{ display: 'grid', padding: '6px' }}>{props.children}</div>
    </div>
  );
}

function PickerMenu(props: {
  trigger: JSX.Element;
  heading: string;
  children: JSX.Element;
}) {
  return (
    <div style={{ display: 'grid', gap: '8px', width: 'min(260px, 100%)' }}>
      <SsgDesktop>{props.trigger}</SsgDesktop>
      <PickerPanel heading={props.heading}>{props.children}</PickerPanel>
    </div>
  );
}

export function StatusPriorityGraphic(
  props: { mode?: 'status' | 'priority' | 'both' } = {}
) {
  const showStatus = () => {
    const mode = props.mode ?? 'both';
    return mode === 'status' || mode === 'both';
  };
  const showPriority = () => {
    const mode = props.mode ?? 'both';
    return mode === 'priority' || mode === 'both';
  };
  const rowStyle = (active: boolean): JSX.CSSProperties => ({
    'align-items': 'center',
    ...(active
      ? { 'background-color': 'color-mix(in srgb, var(--c1) 7%, transparent)' }
      : {}),
    'border-radius': '9px',
    cursor: 'pointer',
    display: 'flex',
    gap: '10px',
    padding: '8px 10px',
  });
  const countStyle: JSX.CSSProperties = {
    'align-items': 'center',
    'background-color': 'color-mix(in srgb, var(--c4) 12%, transparent)',
    'border-radius': '5px',
    color: 'var(--c4)',
    display: 'inline-flex',
    'font-family': appFont,
    'font-size': '11px',
    'justify-content': 'center',
    'margin-left': 'auto',
    'min-width': '18px',
    padding: '2px 5px',
  };
  const counts = ['12', '5', '2', '38', '3'];

  return (
    <div
      class="tasks-gfx-pickers"
      classList={{ 'tasks-gfx-pickers-dual': showStatus() && showPriority() }}
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '20px',
        'justify-items': 'center',
        width: '100%',
        'max-width': '620px',
      }}
    >
      <style>{`
        /* Viewport-dependent styling lives in CSS (not JS ternaries) so the
           1440px build-time prerender paints correctly on phones before the
           JS bundle loads. */
        .tasks-gfx-pickers { grid-template-columns: 1fr; padding: 44px 24px; }
        .tasks-gfx-pickers-dual { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        @media (max-width: 699px) {
          .tasks-gfx-pickers { padding: 34px 18px; }
          .tasks-gfx-pickers-dual { grid-template-columns: 1fr; }
        }
      `}</style>
      <Show when={showStatus()}>
        <PickerMenu
          heading="Change status…"
          trigger={
            <span
              class="tasks-picker-trigger"
              style={{
                'align-items': 'center',
                border: '1px solid var(--b3)',
                'border-radius': '999px',
                color: 'var(--c1)',
                cursor: 'pointer',
                display: 'inline-flex',
                'font-family': appFont,
                'font-size': '13px',
                gap: '7px',
                'justify-self': 'start',
                padding: '6px 12px',
              }}
            >
              <StatusIcon kind="in-progress" size={15} /> In Progress{' '}
              <ChevronGlyph size={11} />
            </span>
          }
        >
          <For each={statusOrder}>
            {(kind, i) => (
              <div
                class="tasks-picker-row"
                style={rowStyle(kind === 'in-progress')}
              >
                <StatusIcon kind={kind} size={16} />
                <span
                  style={{
                    color: 'var(--c1)',
                    'font-family': appFont,
                    'font-size': '13.5px',
                  }}
                >
                  {STATUS_META[kind].label}
                </span>
                <span style={countStyle}>{counts[i()]}</span>
              </div>
            )}
          </For>
        </PickerMenu>
      </Show>

      <Show when={showPriority()}>
        <PickerMenu
          heading="Change priority…"
          trigger={
            <span
              class="tasks-picker-trigger"
              style={{
                'align-items': 'center',
                border: '1px solid var(--b3)',
                'border-radius': '999px',
                color: 'var(--c1)',
                cursor: 'pointer',
                display: 'inline-flex',
                'font-family': appFont,
                'font-size': '13px',
                gap: '7px',
                'justify-self': 'start',
                padding: '6px 12px',
              }}
            >
              <PriorityIcon kind="urgent" size={15} /> Urgent{' '}
              <ChevronGlyph size={11} />
            </span>
          }
        >
          <For each={priorityOrder}>
            {(kind, i) => (
              <div class="tasks-picker-row" style={rowStyle(kind === 'urgent')}>
                <PriorityIcon kind={kind} size={16} />
                <span
                  style={{
                    color: 'var(--c1)',
                    'font-family': appFont,
                    'font-size': '13.5px',
                  }}
                >
                  {PRIORITY_META[kind].label}
                </span>
                <span style={countStyle}>
                  {['9', '6', '14', '7', '4'][i()]}
                </span>
              </div>
            )}
          </For>
        </PickerMenu>
      </Show>
    </div>
  );
}

export function StatusPickerGraphic() {
  return <StatusPriorityGraphic mode="status" />;
}

export function PriorityPickerGraphic() {
  return <StatusPriorityGraphic mode="priority" />;
}

// ---------------------------------------------------------------------------
// Status menu, anchored — the composition a user actually sees: one focused
// task row with the status pill clicked and the menu open beneath it. "In
// Review" is highlighted as the row about to be picked.
// ---------------------------------------------------------------------------

export function StatusMenuGraphic() {
  const compact = () => mobile();
  const menuRow = (active: boolean): JSX.CSSProperties => ({
    'align-items': 'center',
    ...(active
      ? { 'background-color': 'color-mix(in srgb, var(--c1) 7%, transparent)' }
      : {}),
    'border-radius': '9px',
    display: 'flex',
    gap: '10px',
    padding: '8px 10px',
  });
  const countStyle: JSX.CSSProperties = {
    'align-items': 'center',
    'background-color': 'color-mix(in srgb, var(--c4) 12%, transparent)',
    'border-radius': '5px',
    color: 'var(--c4)',
    display: 'inline-flex',
    'font-family': appFont,
    'font-size': '11px',
    'justify-content': 'center',
    'margin-left': 'auto',
    'min-width': '18px',
    padding: '2px 5px',
  };
  const counts = ['12', '5', '2', '38', '3'];
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: compact() ? '12px 14px' : '16px 24px',
        width: '100%',
      }}
    >
      <div style={{ display: 'grid', width: 'min(600px, 100%)' }}>
        {/* The focused task row, floating as a card */}
        <div
          style={{
            'align-items': 'center',
            'background-color': '#0a0a0a',
            border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
            'border-radius': '12px',
            'box-shadow':
              'var(--shadow-panel-md), inset 0 1px 0 color-mix(in srgb, var(--c1) 7%, transparent)',
            'box-sizing': 'border-box',
            display: 'flex',
            gap: compact() ? '10px' : '13px',
            padding: compact() ? '11px 13px' : '12px 16px',
            width: '100%',
          }}
        >
          <TaskRowGlyph size={15} />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': compact() ? '13.5px' : '14px',
              'min-width': 0,
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
            }}
          >
            Ship realtime sync to the finish line
          </span>
          {/* The clicked status pill */}
          <span
            style={{
              'align-items': 'center',
              'background-color':
                'color-mix(in srgb, var(--c1) 7%, transparent)',
              border:
                '1px solid color-mix(in srgb, var(--c1) 22%, transparent)',
              'border-radius': '999px',
              color: 'var(--c1)',
              display: 'inline-flex',
              flex: 'none',
              'font-family': appFont,
              'font-size': '12.5px',
              gap: '6px',
              'margin-left': 'auto',
              padding: '5px 11px',
              'white-space': 'nowrap',
            }}
          >
            <StatusIcon kind="in-progress" size={14} /> In Progress{' '}
            <ChevronGlyph size={10} />
          </span>
          <Show when={!compact()}>
            <PriorityIcon kind="high" size={15} />
            <Avatar initials="JW" size={20} color="var(--b3)" />
          </Show>
        </div>
        {/* The open menu, hanging beneath the pill */}
        <div
          style={{
            display: 'grid',
            'justify-content': compact() ? 'center' : 'end',
            'margin-top': '10px',
            'padding-right': compact() ? '0' : '76px',
          }}
        >
          <div style={{ width: 'min(272px, 100%)' }}>
            <PickerPanel heading="Change status…">
              <For each={statusOrder}>
                {(kind, i) => (
                  <div style={menuRow(kind === 'in-review')}>
                    <StatusIcon kind={kind} size={16} />
                    <span
                      style={{
                        color: 'var(--c1)',
                        'font-family': appFont,
                        'font-size': '13.5px',
                      }}
                    >
                      {STATUS_META[kind].label}
                    </span>
                    <span style={countStyle}>{counts[i()]}</span>
                  </div>
                )}
              </For>
            </PickerPanel>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Properties graphic — custom properties picker (mirrors "Add a property")
// ---------------------------------------------------------------------------

function PropTypeGlyph(props: { name: string; size?: number }) {
  const s = props.size ?? 16;
  const common = {
    width: s,
    height: s,
    viewBox: '0 0 24 24',
    'aria-hidden': true,
    style: { display: 'block', flex: 'none' } as JSX.CSSProperties,
  };
  switch (props.name) {
    case 'multi':
      return (
        <svg {...common}>
          <path
            d="M9 6h11 M9 12h11 M9 18h11"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
          <path
            d="M4 5.5l1.4 1.4L7.5 4.5 M4 11.5l1.4 1.4L7.5 10.5 M4 17.5l1.4 1.4L7.5 16.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      );
    case 'date':
      return (
        <svg {...common}>
          <rect
            x="4"
            y="5"
            width="16"
            height="15"
            rx="2.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
          />
          <path
            d="M4 9.5h16 M8 3v4 M16 3v4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
        </svg>
      );
    case 'option':
      return (
        <svg {...common}>
          <circle
            cx="12"
            cy="12"
            r="8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
          />
          <circle cx="12" cy="12" r="3.2" fill="currentColor" />
        </svg>
      );
    case 'user':
      return (
        <svg {...common}>
          <circle
            cx="12"
            cy="8.5"
            r="3.6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
          />
          <path
            d="M5.5 19.5a6.5 6.5 0 0 1 13 0"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
        </svg>
      );
    case 'number':
      return (
        <svg {...common}>
          <path
            d="M9 4l-2 16 M17 4l-2 16 M5 9h14 M4 15h14"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
      );
    case 'text':
      return (
        <svg {...common}>
          <path
            d="M5 6h14 M5 11h14 M5 16h9"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
        </svg>
      );
    default:
      return null;
  }
}

const propertyItems: {
  name: string;
  label: string;
  type: string;
  glyph: string;
}[] = [
  {
    name: 'multi',
    label: 'Depends On',
    type: 'Multi-Select Task',
    glyph: 'multi',
  },
  { name: 'date', label: 'Due Date', type: 'Date', glyph: 'date' },
  { name: 'option', label: 'Effort', type: 'Single Option', glyph: 'option' },
  {
    name: 'user',
    label: 'Recipients',
    type: 'Multi-Select User',
    glyph: 'user',
  },
  {
    name: 'number',
    label: 'Story Points',
    type: 'Input (Number)',
    glyph: 'number',
  },
  { name: 'text', label: 'Subject', type: 'Input', glyph: 'text' },
];

export function PropertiesGraphic() {
  const compact = () => mobile();
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: compact() ? '32px 18px' : '44px 24px',
        width: '100%',
      }}
    >
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          width: 'min(420px, 100%)',
        }}
      >
        {/* search field */}
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            gap: '9px',
            padding: '11px 14px',
          }}
        >
          <ChevronGlyph size={12} />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13.5px',
            }}
          >
            Add a property…
          </span>
          <span
            aria-hidden="true"
            class="tasks-caret"
            style={{
              'background-color': 'var(--a0)',
              display: 'inline-block',
              height: '15px',
              width: '1.5px',
            }}
          />
        </div>
        <For each={propertyItems}>
          {(item, i) => (
            <div
              style={{
                'align-items': 'center',
                'background-color':
                  i() === 0
                    ? 'color-mix(in srgb, var(--c1) 6%, transparent)'
                    : 'transparent',
                display: 'flex',
                gap: '11px',
                padding: '9px 14px',
              }}
            >
              <span style={{ color: 'var(--c2)', display: 'inline-flex' }}>
                <PropTypeGlyph name={item.glyph} size={16} />
              </span>
              <span
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': '13.5px',
                }}
              >
                {item.label}
              </span>
              <span
                style={{
                  color: 'var(--c4)',
                  'font-family': appFont,
                  'font-size': '12px',
                  'margin-left': 'auto',
                }}
              >
                {item.type}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GitHub-linked graphic — branch / PR / merge moves the task automatically
// ---------------------------------------------------------------------------

function GitBranchGlyph(props: { size?: number }) {
  const s = props.size ?? 16;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <circle
        cx="7"
        cy="5"
        r="2.4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
      />
      <circle
        cx="7"
        cy="19"
        r="2.4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
      />
      <circle
        cx="17"
        cy="8"
        r="2.4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
      />
      <path
        d="M7 7.4v9.2 M17 10.4c0 3.4-2.6 4.2-5 4.6"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

const githubSteps: {
  status: StatusKind;
  label: string;
  meta: string;
  ref: string;
  subtitle?: string;
}[] = [
  {
    status: 'not-started',
    label: 'Task created',
    subtitle: 'from #bug-reports',
    meta: '9:14 AM',
    ref: '',
  },
  {
    status: 'in-progress',
    label: 'Branch checked out',
    meta: '9:32 AM',
    ref: 'fix/deploy-flake',
  },
  {
    status: 'in-review',
    label: 'Pull request opened',
    meta: '11:02 AM',
    ref: '#482',
  },
  {
    status: 'completed',
    label: 'PR merged to main',
    meta: '2:48 PM',
    ref: '#482',
  },
];

export function GithubLinkedGraphic() {
  return (
    <div
      class="tasks-gfx-gh"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        width: '100%',
      }}
    >
      <style>{`
        /* Viewport-dependent styling lives in CSS (not JS ternaries) so the
           1440px build-time prerender paints correctly on phones before the
           JS bundle loads. */
        .tasks-gfx-gh { padding: 40px 24px; }
        .tasks-gfx-gh-card { width: min(520px, 100%); }
        .tasks-gfx-gh-head { gap: 11px; padding: 14px 18px; }
        .tasks-gfx-gh-title { font-size: 15px; }
        .tasks-gfx-gh-pill { border-radius: 7px; gap: 6px; padding: 4px 9px; }
        .tasks-gfx-gh-steps { padding: 14px 18px 18px; }
        .tasks-gfx-gh-label { font-size: 14px; }
        .tasks-gfx-gh-subtitle { font-size: 12px; }
        @media (max-width: 699px) {
          .tasks-gfx-gh { padding: 34px 4px; }
          .tasks-gfx-gh-card { width: min(460px, 100%); }
          .tasks-gfx-gh-head { gap: 8px; padding: 13px 14px; }
          .tasks-gfx-gh-title { font-size: 13px; }
          .tasks-gfx-gh-pill { border-radius: 999px; gap: 0; height: 28px; padding: 0; width: 28px; }
          .tasks-gfx-gh-pill-text { display: none; }
          .tasks-gfx-gh-steps { padding: 10px 14px 14px; }
          .tasks-gfx-gh-label { font-size: 13px; }
          .tasks-gfx-gh-subtitle { font-size: 11.5px; }
        }
      `}</style>
      <div
        class="tasks-gfx-gh-card"
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
        }}
      >
        {/* Task header */}
        <div
          class="tasks-gfx-gh-head"
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
          }}
        >
          <StatusIcon kind="completed" size={18} />
          <span
            class="tasks-gfx-gh-title"
            style={{
              color: 'var(--c1)',
              display: 'block',
              flex: '1 1 0',
              'font-family': appFont,
              'line-height': 1.25,
              'min-width': 0,
            }}
          >
            Fix flaky deploy pipeline
          </span>
          <span
            aria-label="GitHub"
            class="tasks-gfx-gh-pill"
            style={{
              'align-items': 'center',
              border:
                '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
              color: 'var(--c2)',
              display: 'inline-flex',
              flex: 'none',
              'font-family': appFont,
              'font-size': '11.5px',
              'justify-content': 'center',
              'margin-left': 'auto',
            }}
          >
            <IconGithub
              style={{
                display: 'block',
                flex: 'none',
                height: '13px',
                width: '13px',
              }}
            />{' '}
            <span class="tasks-gfx-gh-pill-text">GitHub</span>
          </span>
        </div>
        {/* Timeline */}
        <div class="tasks-gfx-gh-steps" style={{ display: 'grid', gap: '0' }}>
          <For each={githubSteps}>
            {(step, index) => (
              <div
                style={{
                  'column-gap': '12px',
                  display: 'grid',
                  'grid-template-columns': '18px minmax(0, 1fr) auto',
                  position: 'relative',
                }}
              >
                <Show when={index() < githubSteps.length - 1}>
                  <span
                    aria-hidden="true"
                    style={{
                      'background-color': 'var(--b3)',
                      bottom: '-2px',
                      left: '8.5px',
                      position: 'absolute',
                      top: '24px',
                      width: '1.5px',
                      'z-index': 0,
                    }}
                  />
                </Show>
                <span
                  style={{
                    'align-self': 'start',
                    'background-color': '#0a0a0a',
                    'margin-top': '7px',
                    position: 'relative',
                    'z-index': 1,
                  }}
                >
                  <StatusIcon kind={step.status} size={18} />
                </span>
                <div
                  style={{
                    display: 'grid',
                    gap: step.subtitle ? '2px' : 0,
                    padding: '7px 0',
                  }}
                >
                  <div
                    style={{
                      'align-items': 'center',
                      display: 'flex',
                      'flex-wrap': 'wrap',
                      gap: '8px',
                    }}
                  >
                    <span
                      class="tasks-gfx-gh-label"
                      style={{
                        color:
                          index() === githubSteps.length - 1
                            ? 'var(--c1)'
                            : 'var(--c2)',
                        'font-family': appFont,
                        'line-height': 1.35,
                      }}
                    >
                      {step.label}
                    </span>
                    <Show when={step.ref}>
                      <span
                        style={{
                          'align-items': 'center',
                          'background-color':
                            'color-mix(in srgb, var(--a0) 14%, transparent)',
                          'border-radius': '6px',
                          color: 'var(--a0)',
                          display: 'inline-flex',
                          'font-family':
                            "ui-monospace, 'SFMono-Regular', Menlo, monospace",
                          'font-size': '11.5px',
                          gap: '5px',
                          padding: '2px 7px',
                        }}
                      >
                        <GitBranchGlyph size={12} /> {step.ref}
                      </span>
                    </Show>
                  </div>
                  <Show when={step.subtitle}>
                    <span
                      class="tasks-gfx-gh-subtitle"
                      style={{
                        color: 'var(--c4)',
                        'font-family': appFont,
                        'line-height': 1.35,
                      }}
                    >
                      {step.subtitle}
                    </span>
                  </Show>
                </div>
                <span
                  style={{
                    'align-self': 'start',
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': '12px',
                    'margin-top': '7px',
                    'white-space': 'nowrap',
                  }}
                >
                  {step.meta}
                </span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delegate graphic — assign a task to an agent, it works and reports back
// ---------------------------------------------------------------------------

const agentSteps = [
  { label: 'Assigned to agent', meta: '9:14 AM', state: 'done' },
  {
    label: 'Traced the timeout to a race in deploy.yml',
    meta: '9:16 AM',
    state: 'done',
  },
  {
    label: 'Opened PR #482: fix flaky deploy pipeline',
    meta: '9:21 AM',
    state: 'active',
  },
  { label: 'Review requested: you', meta: 'now', state: 'open' },
] as const;

export function AgentGraphic() {
  return (
    <div
      class="tasks-gfx-agent"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        width: '100%',
      }}
    >
      <style>{tasksMotionStyles}</style>
      <style>{`
        /* Viewport-dependent styling lives in CSS (not JS ternaries) so the
           1440px build-time prerender paints correctly on phones before the
           JS bundle loads. */
        .tasks-gfx-agent { padding: 40px 24px; }
        .tasks-gfx-agent-card { width: min(520px, 100%); }
        .tasks-gfx-agent-head { gap: 11px; padding: 14px 18px; }
        .tasks-gfx-agent-title { font-size: 15px; }
        .tasks-gfx-agent-pill { gap: 6px; padding: 4px 10px 4px 8px; }
        .tasks-gfx-agent-steps { padding: 12px 18px 18px; }
        .tasks-gfx-agent-label { font-size: 14px; }
        @media (max-width: 699px) {
          .tasks-gfx-agent { padding: 34px 4px; }
          .tasks-gfx-agent-card { width: min(460px, 100%); }
          .tasks-gfx-agent-head { gap: 8px; padding: 13px 14px; }
          .tasks-gfx-agent-title { font-size: 13px; }
          .tasks-gfx-agent-pill { gap: 0; height: 28px; padding: 0; width: 28px; }
          .tasks-gfx-agent-pill-text { display: none; }
          .tasks-gfx-agent-steps { padding: 10px 14px 14px; }
          .tasks-gfx-agent-label { font-size: 13px; }
        }
      `}</style>
      <div
        class="tasks-gfx-agent-card"
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
        }}
      >
        <div
          class="tasks-gfx-agent-head"
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
          }}
        >
          <StatusIcon kind="in-progress" size={18} />
          <span
            class="tasks-gfx-agent-title"
            style={{
              color: 'var(--c1)',
              display: 'block',
              flex: '1 1 0',
              'font-family': appFont,
              'line-height': 1.25,
              'min-width': 0,
            }}
          >
            Fix flaky deploy pipeline
          </span>
          <span
            aria-label="Agent"
            class="tasks-gfx-agent-pill"
            style={{
              'align-items': 'center',
              'background-color':
                'color-mix(in srgb, var(--c4) 12%, var(--b1))',
              border:
                '1px solid color-mix(in srgb, var(--c4) 26%, transparent)',
              'border-radius': '999px',
              color: 'var(--c2)',
              display: 'inline-flex',
              flex: 'none',
              'font-family': appFont,
              'font-size': '11.5px',
              'font-weight': '600',
              'justify-content': 'center',
              'margin-left': 'auto',
            }}
          >
            <IconAi
              style={{
                color: 'var(--c2)',
                height: '13px',
                width: '13px',
                flex: 'none',
              }}
            />{' '}
            <span class="tasks-gfx-agent-pill-text">Agent</span>
          </span>
        </div>
        <div
          class="tasks-gfx-agent-steps"
          style={{ display: 'grid', gap: '0' }}
        >
          <For each={agentSteps}>
            {(step, index) => (
              <div
                style={{
                  'column-gap': '12px',
                  display: 'grid',
                  'grid-template-columns': '14px minmax(0, 1fr) auto',
                  position: 'relative',
                }}
              >
                <Show when={index() < agentSteps.length - 1}>
                  <span
                    aria-hidden="true"
                    style={{
                      'background-color': 'var(--b3)',
                      bottom: '-7px',
                      left: '6.5px',
                      position: 'absolute',
                      top: '19px',
                      width: '1px',
                    }}
                  />
                </Show>
                <span
                  aria-hidden="true"
                  class={
                    step.state === 'active' ? 'tasks-active-dot' : undefined
                  }
                  style={{
                    'align-self': 'start',
                    'background-color':
                      step.state === 'open' ? 'transparent' : 'var(--a0)',
                    border:
                      step.state === 'open'
                        ? '1px solid var(--b4)'
                        : '1px solid var(--a0)',
                    'border-radius': '999px',
                    'box-sizing': 'border-box',
                    height: '9px',
                    'margin-left': '2.5px',
                    'margin-top': '10px',
                    opacity: step.state === 'done' ? 0.55 : 1,
                    width: '9px',
                  }}
                />
                <span
                  class="tasks-gfx-agent-label"
                  style={{
                    color: step.state === 'active' ? 'var(--c1)' : 'var(--c4)',
                    'font-family': appFont,
                    'line-height': 1.4,
                    padding: '7px 0',
                  }}
                >
                  {step.label}
                </span>
                <span
                  style={{
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': '12px',
                    opacity: 0.65,
                    padding: '8px 0',
                    'white-space': 'nowrap',
                  }}
                >
                  {step.meta}
                </span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyboard-first graphic
// ---------------------------------------------------------------------------

function Keycap(props: { label: string; wide?: boolean }) {
  return (
    <span
      style={{
        'align-items': 'center',
        background: 'linear-gradient(180deg, #0a0a0a, #080808)',
        border: '1px solid color-mix(in srgb, var(--b4) 70%, transparent)',
        'border-radius': '8px',
        'box-shadow':
          '0 3px 0 color-mix(in srgb, var(--b0) 70%, var(--b4)), inset 0 1px 0 color-mix(in srgb, var(--c1) 12%, transparent)',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        display: 'inline-grid',
        'font-family': 'rajdhani, body',
        'font-size': mobile() ? '15px' : '17px',
        'font-weight': '700',
        height: mobile() ? '40px' : '48px',
        'letter-spacing': '0.04em',
        'line-height': 1,
        'min-width': mobile() ? '40px' : '48px',
        padding: props.wide ? '0 14px' : '0',
        'place-items': 'center',
      }}
    >
      {props.label}
    </span>
  );
}

const shortcuts = [
  { keys: ['C', 'T'], label: 'New task' },
  { keys: ['\u2318', '\u21E7', 'S'], label: 'Set status' },
  { keys: ['\u2318', '\u21E7', 'P'], label: 'Set priority' },
  { keys: ['\u2318', '\u21E7', 'A'], label: 'Assign' },
];

export function KeyboardGraphic(props: { columns?: number } = {}) {
  const columns = () => props.columns ?? (mobile() ? 2 : 4);
  return (
    <div
      style={{
        display: 'grid',
        gap: mobile() ? '14px' : columns() === 2 ? '26px 18px' : '18px',
        'grid-template-columns': `repeat(${columns()}, minmax(0, ${columns() === 4 && !mobile() ? 'max-content' : '1fr'}))`,
        'justify-content': 'center',
        width: '100%',
      }}
    >
      <For each={shortcuts}>
        {(shortcut) => (
          <div
            style={{
              'align-content': 'start',
              display: 'grid',
              gap: '10px',
              'justify-items': 'center',
              padding: mobile() ? '8px 0' : '0 18px',
            }}
          >
            <span
              style={{
                'align-items': 'center',
                display: 'inline-flex',
                gap: '6px',
              }}
            >
              <For each={shortcut.keys}>
                {(key) => <Keycap label={key} wide={key.length > 1} />}
              </For>
            </span>
            <span
              style={{
                color: 'var(--c4)',
                'font-family': 'rajdhani, body',
                'font-size': mobile() ? '12px' : '13px',
                'font-weight': '700',
                'letter-spacing': '0.08em',
                'line-height': 1,
                'text-align': 'center',
                'text-transform': 'uppercase',
              }}
            >
              {shortcut.label}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison table (Macro vs Linear vs Asana vs Jira vs ClickUp)
// ---------------------------------------------------------------------------

type Cell = boolean | 'partial' | string;

const comparisonColumns = ['Macro', 'Linear', 'Asana', 'Jira', 'ClickUp'];

const comparisonRows: {
  feature: string;
  cells: [Cell, Cell, Cell, Cell, Cell];
}[] = [
  {
    feature: 'Status, priority, assignee, keyboard-first',
    cells: [true, true, 'partial', 'partial', true],
  },
  {
    feature: 'GitHub: branch, PR & merge move the task',
    cells: [true, true, false, 'partial', 'partial'],
  },
  {
    feature: 'Tasks in the same app as email & chat',
    cells: [true, false, false, false, 'partial'],
  },
  {
    feature: 'Turn an email or message into a task',
    cells: [true, false, false, false, 'partial'],
  },
  {
    feature: 'Non-engineers see work without a new seat',
    cells: [true, false, 'partial', false, 'partial'],
  },
  {
    feature: '@mention a task in docs & channels',
    cells: [true, 'partial', false, false, 'partial'],
  },
  {
    feature: 'Custom properties when you want them',
    cells: [true, 'partial', true, true, true],
  },
  {
    feature: 'Light by default, no setup',
    cells: [true, true, 'partial', false, false],
  },
  {
    feature: 'Agents that close tasks for you',
    cells: [true, 'partial', false, false, 'partial'],
  },
  {
    feature: 'Part of one unified team memory',
    cells: [true, false, false, false, false],
  },
  {
    feature: 'Open source (AGPLv3)',
    cells: [true, false, false, false, false],
  },
  { feature: 'Price / seat / month', cells: ['$40', '$8', '$11', '$8', '$7'] },
];

function CheckMark() {
  return (
    <svg
      width="16"
      height="13"
      viewBox="0 0 16 13"
      aria-label="Yes"
      role="img"
      style={{ display: 'block' }}
    >
      <path
        d="M1.5 6.5 L5.8 11 L14.5 1.6"
        fill="none"
        stroke="var(--a0)"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
function PartialMark() {
  return (
    <span
      aria-label="Partial"
      role="img"
      style={{
        'background-color': 'color-mix(in srgb, var(--c4) 55%, transparent)',
        'border-radius': '999px',
        display: 'block',
        height: '4px',
        width: '14px',
      }}
    />
  );
}
function CrossMark() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      aria-label="No"
      role="img"
      style={{ display: 'block', opacity: 0.45 }}
    >
      <path
        d="M2 2 L11 11 M11 2 L2 11"
        fill="none"
        stroke="var(--c4)"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

function ComparisonCell(props: { value: Cell; macro: boolean }) {
  const isPrice = () =>
    typeof props.value === 'string' && props.value !== 'partial';
  return (
    <div
      style={{
        'align-items': 'center',
        display: 'flex',
        'justify-content': 'center',
        'min-height': '22px',
      }}
    >
      <Show
        when={isPrice()}
        fallback={
          <Show
            when={props.value === true}
            fallback={
              <Show when={props.value === 'partial'} fallback={<CrossMark />}>
                <PartialMark />
              </Show>
            }
          >
            <CheckMark />
          </Show>
        }
      >
        <span
          style={{
            color: props.macro ? 'var(--a0)' : 'var(--c2)',
            'font-family': 'rajdhani, body',
            'font-size': mobile() ? '13px' : '15px',
            'font-weight': '700',
            'letter-spacing': '0.02em',
            'white-space': 'nowrap',
          }}
        >
          {props.value as string}
        </span>
      </Show>
    </div>
  );
}

function _ComparisonTable() {
  const gridTemplate = () =>
    mobile()
      ? 'minmax(140px, 1.5fr) repeat(5, minmax(56px, 1fr))'
      : 'minmax(0, 2.2fr) minmax(0, 1fr) repeat(4, minmax(0, 1fr))';

  const headerCellStyle = (macro: boolean): JSX.CSSProperties => ({
    'align-items': 'center',
    'background-color': macro
      ? 'color-mix(in srgb, var(--a0) 12%, var(--b0))'
      : 'transparent',
    color: macro ? 'var(--a0)' : 'var(--c2)',
    display: 'flex',
    'font-family': 'rajdhani, body',
    'font-size': mobile() ? '12px' : '15px',
    'font-weight': '700',
    'justify-content': 'center',
    'letter-spacing': '0.04em',
    'line-height': 1.1,
    padding: mobile() ? '14px 6px' : '18px 12px',
    'text-align': 'center',
    'text-transform': 'uppercase',
  });

  return (
    <div
      class="no-scrollbar"
      style={{
        'overflow-x': mobile() ? 'auto' : 'visible',
        width: '100%',
        'min-width': '0',
        'max-width': '100%',
        '-webkit-overflow-scrolling': 'touch',
      }}
    >
      <div
        style={{
          border: '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          'box-sizing': 'border-box',
          display: 'grid',
          'grid-template-columns': gridTemplate(),
          'min-width': mobile() ? '560px' : 'auto',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            'background-color': 'var(--b0)',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          }}
        />
        <For each={comparisonColumns}>
          {(col, index) => (
            <div
              style={{
                ...headerCellStyle(index() === 0),
                'border-bottom':
                  index() === 0
                    ? '1px solid var(--a0)'
                    : '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
              }}
            >
              {col}
            </div>
          )}
        </For>

        <For each={comparisonRows}>
          {(row, rowIndex) => (
            <>
              <div
                style={{
                  'align-items': 'center',
                  'background-color': 'var(--b0)',
                  'border-bottom':
                    rowIndex() === comparisonRows.length - 1
                      ? '0'
                      : '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                  color: 'var(--c2)',
                  display: 'flex',
                  'font-size': mobile() ? '13px' : '16px',
                  'line-height': 1.25,
                  padding: mobile() ? '13px 12px 13px 14px' : '15px 20px',
                  position: mobile() ? 'sticky' : 'static',
                  left: mobile() ? '0' : 'auto',
                  'z-index': mobile() ? 1 : 'auto',
                }}
              >
                {row.feature}
              </div>
              <For each={row.cells}>
                {(cell, cellIndex) => (
                  <div
                    style={{
                      'align-items': 'center',
                      'background-color':
                        cellIndex() === 0
                          ? 'color-mix(in srgb, var(--a0) 7%, var(--b0))'
                          : 'var(--b0)',
                      'border-bottom':
                        rowIndex() === comparisonRows.length - 1
                          ? '0'
                          : '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                      'border-left':
                        cellIndex() === 0
                          ? '1px solid color-mix(in srgb, var(--a0) 28%, transparent)'
                          : '0',
                      'border-right':
                        cellIndex() === 0
                          ? '1px solid color-mix(in srgb, var(--a0) 28%, transparent)'
                          : '0',
                      display: 'flex',
                      'justify-content': 'center',
                      padding: mobile() ? '13px 6px' : '15px 12px',
                    }}
                  >
                    <ComparisonCell value={cell} macro={cellIndex() === 0} />
                  </div>
                )}
              </For>
            </>
          )}
        </For>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

const faqItems: { q: string; a: JSX.Element }[] = [
  {
    q: 'How is Macro Tasks different from Linear?',
    a: (
      <>
        In building Macro Tasks we were heavily inspired by Linear: status,
        priority, assignee, keyboard-first, and a GitHub integration that moves
        a task to "In Review" and "Done" as you open a PR and merge it. The
        difference is that Macro Tasks live in the same app as your email,
        channels, and docs. You can turn a message into a task in one click, and
        non-engineers see the work without needing a separate seat in a separate
        tool.
      </>
    ),
  },
  {
    q: 'Can I migrate my issues from Linear?',
    a: (
      <>
        Most teams just recreate their open work, since finished issues rarely
        justify carrying over. If you do want history, connect Linear under{' '}
        <strong>Settings → Connectors</strong> and ask an agent to bring your
        open issues across. You can also keep Linear connected via MCP so agents
        can still reference it during a gradual cutover.
      </>
    ),
  },
  {
    q: 'Does the GitHub integration really update status for me?',
    a: (
      <>
        Yes. Copy a task's branch name into your editor, and the task follows
        the pull request from there: it goes to <strong>In Review</strong> when
        you open the PR, and <strong>Done</strong> when it merges. The task
        records which pull request is associated with it, so status updates
        itself instead of waiting on standup. See the{' '}
        <a
          href="https://docs.macro.com/integrations/github"
          target="_blank"
          rel="noreferrer"
        >
          GitHub integration
        </a>{' '}
        docs.
      </>
    ),
  },
  {
    q: "Aren't tasks just another app to check?",
    a: (
      <>
        That's exactly what we wanted to avoid. Tasks share one inbox with your
        email and messages, you can @mention a task in any doc or channel, and
        creating one from an email or message takes a single click. They're kept
        deliberately light (status, priority, and assignee by default), so
        there's nothing to check that the work doesn't already surface.
      </>
    ),
  },
  {
    q: 'Can I add custom fields like story points or effort?',
    a: (
      <>
        Yes. Fields are minimal by default, but you can add custom properties
        (story points, effort, due date, dependencies, recipients, and more)
        from the <strong>Add a property</strong> menu when you want them. We
        advise keeping it light, but the extra fields are there when a team
        needs them.
      </>
    ),
  },
  {
    q: 'Can agents work on tasks?',
    a: (
      <>
        Assign a task to an agent the same way you'd assign it to a teammate. It
        does the work, opens a PR, and reports back in the task itself. Because
        every task feeds the shared context your agents read, they always know
        what the rest of the team is doing.
      </>
    ),
  },
  {
    q: 'Is Macro open source?',
    a: (
      <>
        Yes, fully open source under the AGPLv3 (as of May 31 2026), not "open
        core." To build on Macro under a different license, contact{' '}
        <a href="mailto:licensing@macro.com">licensing@macro.com</a>.
      </>
    ),
  },
];

function _FaqSection() {
  return (
    <section
      aria-label="Frequently asked questions"
      style={{
        'background-color': 'var(--b0)',
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '24px' : '40px',
        'justify-items': 'center',
        padding: mobile() ? '48px 18px' : '72px 54px',
        width: '100%',
      }}
    >
      <style>{`
        .tasks-faq__item { border-bottom: 1px solid color-mix(in srgb, var(--c4) 10%, transparent); }
        .tasks-faq__item > summary {
          align-items: center;
          color: var(--c1);
          cursor: default;
          display: flex;
          font-family: 'display';
          font-size: 20px;
          font-weight: 410;
          gap: 16px;
          justify-content: space-between;
          letter-spacing: -0.01em;
          list-style: none;
          padding: 22px 4px;
        }
        .tasks-faq__item > summary::-webkit-details-marker { display: none; }
        .tasks-faq__item > summary .tasks-faq__chevron { color: var(--c4); flex-shrink: 0; transition: transform 220ms ease; }
        .tasks-faq__item[open] > summary .tasks-faq__chevron { transform: rotate(180deg); }
        .tasks-faq__answer { color: var(--c4); font-size: 16px; line-height: 1.6; margin: 0; padding: 0 4px 24px; max-width: 760px; }
        .tasks-faq__answer a { color: var(--a0); text-decoration: none; }
        @media (hover) {
          .tasks-faq__item > summary:hover { color: var(--a0); }
          .tasks-faq__answer a:hover { text-decoration: underline; }
        }
        @media (max-width: 700px) {
          .tasks-faq__item > summary { font-size: 17px; padding: 18px 4px; }
        }
      `}</style>
      <div
        style={{
          display: 'grid',
          gap: '12px',
          'justify-items': 'center',
          'max-width': '720px',
          'text-align': 'center',
        }}
      >
        <span style={eyebrowStyle()}>FAQ</span>
        <h2
          style={{
            color: 'var(--c1)',
            'font-family': 'display',
            'font-size': mobile() ? '32px' : breakpoint() ? '38px' : '44px',
            'font-weight': '410',
            'letter-spacing': '-0.015em',
            'line-height': 1.1,
            margin: 0,
          }}
        >
          Questions, answered
        </h2>
      </div>
      <div
        style={{
          'border-top':
            '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          width: '100%',
          'max-width': '860px',
        }}
      >
        <For each={faqItems}>
          {(item) => (
            <details class="tasks-faq__item">
              <summary>
                <span>{item.q}</span>
                <svg
                  class="tasks-faq__chevron"
                  width="16"
                  height="16"
                  viewBox="0 0 256 256"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
                </svg>
              </summary>
              <p class="tasks-faq__answer">{item.a}</p>
            </details>
          )}
        </For>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Create-from-anywhere graphic — the quick "New task" creator modal,
// floating over a dimmed app backdrop to convey it launches over any screen.
// ---------------------------------------------------------------------------

function ExpandGlyph(props: { size?: number }) {
  const s = props.size ?? 16;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M9 4H5a1 1 0 0 0-1 1v4 M15 4h4a1 1 0 0 1 1 1v4 M9 20H5a1 1 0 0 1-1-1v-4 M15 20h4a1 1 0 0 1 1-1v-4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function CloseGlyph(props: { size?: number }) {
  const s = props.size ?? 16;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M6 6l12 12 M18 6 L6 18"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

function DueDateGlyph(props: { size?: number }) {
  const s = props.size ?? 14;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <rect
        x="4"
        y="5.5"
        width="16"
        height="14.5"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-dasharray="2.2 2.4"
      />
      <path
        d="M8 3v4 M16 3v4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
      />
    </svg>
  );
}

// Dimmed, blurred faux app list shown behind the modal so the creator reads as
// an overlay that pops over whatever you're already doing.
const creatorBackdropRows = [
  {
    icon: 'calls',
    who: 'Engineering Standup: Multi-inbox & deploys',
    meta: 'Jun 12',
  },
  {
    icon: 'email',
    who: 'Lena Hartwell · Revised SOW before Thursday?',
    meta: 'Jun 12',
  },
  {
    icon: 'channels',
    who: '#bug-reports · deploys are flaking again',
    meta: 'Jun 11',
  },
  {
    icon: 'email',
    who: 'Stripe · Your June payout is on the way',
    meta: 'Jun 11',
  },
  { icon: 'calls', who: 'Teo & Aidan · Sprint sync', meta: 'Jun 10' },
  {
    icon: 'channels',
    who: '#go-to-market · launch embargo time?',
    meta: 'Jun 10',
  },
];

function CreatorBackdrop() {
  return (
    <div
      aria-hidden="true"
      style={{
        filter: 'blur(3px)',
        inset: '0',
        opacity: 0.5,
        'pointer-events': 'none',
        position: 'absolute',
        'z-index': 0,
      }}
    >
      <div
        style={{
          display: 'grid',
          'align-content': 'start',
          height: '100%',
          padding: mobile() ? '18px 14px' : '26px 40px',
        }}
      >
        <For each={creatorBackdropRows}>
          {(row) => (
            <div
              style={{
                'align-items': 'center',
                'border-bottom':
                  '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                display: 'flex',
                gap: '12px',
                padding: '13px 6px',
              }}
            >
              <MacroNavIcon name={row.icon} size={15} />
              <span
                style={{
                  color: 'var(--c2)',
                  'font-family': appFont,
                  'font-size': '14px',
                  'min-width': 0,
                  overflow: 'hidden',
                  'text-overflow': 'ellipsis',
                  'white-space': 'nowrap',
                }}
              >
                {row.who}
              </span>
              <span
                style={{
                  color: 'var(--c4)',
                  'font-family': appFont,
                  'font-size': '12px',
                  'margin-left': 'auto',
                }}
              >
                {row.meta}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export function CreateTaskCreator() {
  const compact = () => mobile();
  const [createMore, setCreateMore] = createSignal(false);
  const pillStyle: JSX.CSSProperties = {
    'align-items': 'center',
    background: 'transparent',
    border: '1px solid color-mix(in srgb, var(--c4) 26%, transparent)',
    'border-radius': '999px',
    color: 'var(--c2)',
    cursor: 'pointer',
    display: 'inline-flex',
    'font-family': appFont,
    'font-size': '12.5px',
    gap: '6px',
    padding: '5px 11px',
    'white-space': 'nowrap',
  };
  return (
    <div
      style={{
        'background-color': 'var(--b1)',
        border: '1px solid color-mix(in srgb, var(--a0) 50%, transparent)',
        'border-radius': '16px',
        'box-shadow': 'var(--shadow-accent-panel)',
        'box-sizing': 'border-box',
        overflow: 'hidden',
        position: 'relative',
        width: 'min(560px, 100%)',
        'z-index': 2,
      }}
    >
      {/* header */}
      <div
        style={{
          'align-items': 'center',
          color: 'var(--c4)',
          display: 'flex',
          'justify-content': 'space-between',
          padding: '13px 16px 0',
        }}
      >
        <ExpandGlyph size={15} />
        <CloseGlyph size={15} />
      </div>
      {/* body */}
      <div
        style={{
          display: 'grid',
          gap: compact() ? '12px' : '15px',
          padding: compact() ? '12px 16px 16px' : '12px 18px 18px',
        }}
      >
        <span
          style={{
            'align-items': 'center',
            color: 'var(--c1)',
            display: 'inline-flex',
            'font-family': appFont,
            'font-size': compact() ? '20px' : '23px',
            'font-weight': '450',
          }}
        >
          New task
          <span
            aria-hidden="true"
            class="tasks-caret"
            style={{
              'background-color': 'var(--a0)',
              display: 'inline-block',
              height: compact() ? '21px' : '24px',
              'margin-left': '2px',
              width: '2px',
            }}
          />
        </span>
        <span
          style={{
            color: 'var(--c4)',
            'font-family': appFont,
            'font-size': compact() ? '14px' : '15px',
          }}
        >
          Add description…
        </span>
        {/* property pills */}
        <div
          style={{
            display: 'flex',
            'flex-wrap': 'wrap',
            gap: '8px',
            'padding-top': '4px',
          }}
        >
          <button type="button" class="tasks-creator-pill" style={pillStyle}>
            <StatusIcon kind="not-started" size={14} /> Not Started{' '}
            <ChevronGlyph size={10} />
          </button>
          <button type="button" class="tasks-creator-pill" style={pillStyle}>
            <PriorityIcon kind="none" size={14} /> Priority{' '}
            <ChevronGlyph size={10} />
          </button>
          <button type="button" class="tasks-creator-pill" style={pillStyle}>
            <Avatar initials="J" size={16} color="var(--b3)" /> jacob{' '}
            <ChevronGlyph size={10} />
          </button>
          <button type="button" class="tasks-creator-pill" style={pillStyle}>
            <DueDateGlyph size={13} /> Due Date <ChevronGlyph size={10} />
          </button>
        </div>
      </div>
      {/* footer */}
      <div
        style={{
          'align-items': 'center',
          'border-top':
            '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          display: 'flex',
          gap: '12px',
          padding: '11px 16px',
        }}
      >
        <button
          type="button"
          aria-label="Attach file"
          class="tasks-creator-icon"
          style={{
            background: 'transparent',
            border: '0',
            color: 'var(--c4)',
            cursor: 'pointer',
            display: 'inline-flex',
            padding: '4px',
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 256 256"
            fill="currentColor"
            style={{ display: 'block' }}
          >
            <path d="M209.66,122.34a8,8,0,0,1,0,11.32l-82.05,82a56,56,0,0,1-79.2-79.21L147.67,37.21a40,40,0,1,1,56.61,56.55L105,193A24,24,0,1,1,71,159l85.41-85.42a8,8,0,0,1,11.32,11.31L82.34,170.34a8,8,0,0,0,11.32,11.32L192.93,82.45a24,24,0,1,0-34-33.94L59.76,147.8a40,40,0,1,0,56.53,56.62l82.06-82A8,8,0,0,1,209.66,122.34Z" />
          </svg>
        </button>
        <button
          type="button"
          aria-pressed={createMore()}
          onClick={() => setCreateMore((v) => !v)}
          style={{
            'align-items': 'center',
            background: 'transparent',
            border: '0',
            color: createMore() ? 'var(--c1)' : 'var(--c4)',
            cursor: 'pointer',
            display: 'inline-flex',
            'font-family': appFont,
            'font-size': '13px',
            gap: '8px',
            'margin-left': 'auto',
            padding: '4px 2px',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              'align-items': 'center',
              'background-color': createMore()
                ? 'var(--a0)'
                : 'color-mix(in srgb, var(--c4) 28%, transparent)',
              'border-radius': '999px',
              'box-sizing': 'border-box',
              display: 'inline-flex',
              height: '16px',
              'justify-content': createMore() ? 'flex-end' : 'flex-start',
              padding: '2px',
              transition: 'background-color 140ms ease',
              width: '28px',
            }}
          >
            <span
              style={{
                'background-color': 'var(--b0)',
                'border-radius': '999px',
                height: '12px',
                width: '12px',
              }}
            />
          </span>
          Create More
        </button>
        <button
          type="button"
          class="tasks-creator-create"
          style={{
            'align-items': 'center',
            background: 'transparent',
            border: '0',
            color: 'var(--c1)',
            cursor: 'pointer',
            display: 'inline-flex',
            'font-family': appFont,
            'font-size': '13px',
            'font-weight': '600',
            gap: '8px',
            padding: '4px 2px',
          }}
        >
          Create Task
          <span
            style={{
              'align-items': 'center',
              'background-color':
                'color-mix(in srgb, var(--c1) 10%, transparent)',
              'border-radius': '6px',
              color: 'var(--c2)',
              display: 'inline-flex',
              'font-family': 'rajdhani, body',
              'font-size': '12px',
              'font-weight': '700',
              gap: '3px',
              padding: '3px 6px',
            }}
          >
            ⌘ ↵
          </span>
        </button>
      </div>
    </div>
  );
}

function _CreateAnywhereGraphic() {
  const compact = () => mobile();
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: compact() ? '24px' : '30px',
        'justify-items': 'center',
        width: '100%',
      }}
    >
      <div
        style={{
          'align-items': 'center',
          border: '1px solid color-mix(in srgb, var(--c4) 14%, transparent)',
          'border-radius': '16px',
          'box-sizing': 'border-box',
          display: 'grid',
          'justify-items': 'center',
          'min-height': compact() ? '360px' : '420px',
          overflow: 'hidden',
          padding: compact() ? '28px 16px' : '48px 24px',
          position: 'relative',
          width: 'min(880px, 100%)',
        }}
      >
        <CreatorBackdrop />
        {/* scrim that darkens the backdrop toward the edges */}
        <div
          aria-hidden="true"
          style={{
            background:
              'radial-gradient(120% 90% at 50% 45%, transparent 0%, color-mix(in srgb, var(--b0) 72%, transparent) 60%, var(--b0) 100%)',
            inset: '0',
            'pointer-events': 'none',
            position: 'absolute',
            'z-index': 1,
          }}
        />
        <div
          style={{
            'align-self': 'center',
            display: 'grid',
            'justify-items': 'center',
            position: 'relative',
            width: '100%',
            'z-index': 2,
          }}
        >
          <CreateTaskCreator />
        </div>
      </div>
    </div>
  );
}

function _StatementCorners() {
  const cornerSize = () => (mobile() ? '10px' : '14px');
  const cornerThickness = () => (mobile() ? '1.5px' : '2px');
  const cornerOffset = () => (mobile() ? '4px' : '6px');
  const base: JSX.CSSProperties = {
    'border-color': 'var(--a0)',
    'border-style': 'solid',
    'box-sizing': 'border-box',
    height: cornerSize(),
    position: 'absolute',
    width: cornerSize(),
  };
  return (
    <>
      <div
        aria-hidden="true"
        style={{
          ...base,
          'border-width': `${cornerThickness()} 0 0 ${cornerThickness()}`,
          left: cornerOffset(),
          top: cornerOffset(),
        }}
      />
      <div
        aria-hidden="true"
        style={{
          ...base,
          'border-width': `${cornerThickness()} ${cornerThickness()} 0 0`,
          right: cornerOffset(),
          top: cornerOffset(),
        }}
      />
      <div
        aria-hidden="true"
        style={{
          ...base,
          'border-width': `0 0 ${cornerThickness()} ${cornerThickness()}`,
          bottom: cornerOffset(),
          left: cornerOffset(),
        }}
      />
      <div
        aria-hidden="true"
        style={{
          ...base,
          'border-width': `0 ${cornerThickness()} ${cornerThickness()} 0`,
          bottom: cornerOffset(),
          right: cornerOffset(),
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Lifecycle demo — one task, captured from a message and carried all the way
// to shipped. A self-driving stage player replaces the per-feature carousels:
// it tells a single continuous story instead of seven disconnected ones.
// ---------------------------------------------------------------------------

const STAGE_DURATION_MS = 5200;

type LifecycleStage = {
  id: string;
  title: string;
  blurb: string;
  graphic: Component;
};

const lifecycleStages: LifecycleStage[] = [
  {
    id: 'capture',
    title: 'Capture',
    blurb: 'Turn any message into a task in one keystroke.',
    graphic: CaptureTaskGraphic,
  },
  {
    id: 'triage',
    title: 'Triage',
    blurb: 'Status, priority, and assignee: one keystroke each.',
    graphic: () => <StatusPriorityGraphic mode="both" />,
  },
  {
    id: 'delegate',
    title: 'Delegate',
    blurb: 'Hand it to an agent that reports back in the task.',
    graphic: AgentGraphic,
  },
  {
    id: 'ship',
    title: 'Ship',
    blurb: 'Open a PR and the status keeps itself up to date.',
    graphic: GithubLinkedGraphic,
  },
];

export function TaskLifecycleGraphic() {
  const _compact = () => mobile();
  const [active, setActive] = createSignal(0);
  const [progress, setProgress] = createSignal(0);
  const [paused, setPaused] = createSignal(false);

  const select = (index: number) => {
    setActive(index);
    setProgress(0);
  };

  onMount(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (!paused()) {
        const next = progress() + dt / STAGE_DURATION_MS;
        if (next >= 1) {
          setProgress(0);
          setActive((a) => (a + 1) % lifecycleStages.length);
        } else {
          setProgress(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  return (
    <div
      aria-label="How a task moves through Macro"
      class="tasks-gfx-lc-root"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        position: 'relative',
        width: '100%',
      }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusIn={() => setPaused(true)}
      onFocusOut={() => setPaused(false)}
    >
      <style>{`
        .lc-step { transition: opacity 220ms ease, border-color 220ms ease; }
        .lc-step-btn { transition: color 160ms ease; }
        @media (hover) {
          .lc-step-btn:hover .lc-step-title { color: var(--c1); }
          .lc-chip:hover { color: var(--c2) !important; }
        }
        @keyframes lcFade {
          from { opacity: 0; transform: translateY(8px) scale(0.99); }
          to { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: no-preference) {
          .lc-stage-graphic { animation: lcFade 460ms cubic-bezier(0.22, 1, 0.36, 1); }
        }
        /* Viewport-dependent styling lives in CSS (not JS ternaries) so the
           1440px build-time prerender paints correctly on phones before the
           JS bundle loads. The mobile stage reserves 82px at the bottom for
           the active stage's blurb. */
        .tasks-gfx-lc-root { gap: 40px; }
        .tasks-gfx-lc-body { gap: 36px; padding-inline: 24px; }
        .tasks-gfx-lc-stage { height: 500px; margin-inline: 0; overflow: hidden; width: 100%; }
        .tasks-gfx-lc-window { inset: 0; }
        .tasks-gfx-lc-spotlight { inset: 0; padding: 24px; }
        @media (max-width: 699px) {
          .tasks-gfx-lc-root { gap: 0; }
          .tasks-gfx-lc-body { gap: 0; padding-inline: 6px; }
          .tasks-gfx-lc-stage {
            background: linear-gradient(to bottom, color-mix(in srgb, var(--b1) 62%, var(--c1) 24%) 0%, color-mix(in srgb, var(--b1) 88%, var(--b0)) 68%, var(--b0) 100%);
            border: 1px solid color-mix(in srgb, var(--b4) 24%, var(--b0));
            border-radius: 8px;
            height: 546px;
            margin-inline: -10px;
            overflow: visible;
            width: calc(100% + 20px);
          }
          .tasks-gfx-lc-backdrop {
            -webkit-mask-image: radial-gradient(ellipse at 18% 18%, rgb(0 0 0 / 0.9) 0%, rgb(0 0 0 / 0.2) 100%);
            mask-image: radial-gradient(ellipse at 18% 18%, rgb(0 0 0 / 0.9) 0%, rgb(0 0 0 / 0.2) 100%);
          }
          .tasks-gfx-lc-window { border-radius: 12px; inset: 10px 10px 82px; }
          .tasks-gfx-lc-spotlight {
            inset: 10px 10px 82px;
            -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 72%, transparent 100%);
            mask-image: linear-gradient(to bottom, #000 0%, #000 72%, transparent 100%);
            overflow: hidden;
            padding: 0;
          }
        }
      `}</style>

      {/* Demo body — full-width stage on top, the stepper beneath it */}
      <div
        class="tasks-gfx-lc-body"
        style={{
          'box-sizing': 'border-box',
          display: 'grid',
          'max-width': '1100px',
          position: 'relative',
          width: '100%',
          'z-index': 1,
        }}
      >
        {/* Stage viewport — the live tasks window dimmed behind, the active
            stage graphic spotlit on top (same treatment as the email block). */}
        <div
          class="tasks-gfx-lc-stage"
          style={{
            'box-sizing': 'border-box',
            position: 'relative',
          }}
        >
          <div
            class="tasks-gfx-lc-backdrop"
            style={{
              inset: '0',
              position: 'absolute',
              'z-index': 0,
            }}
          >
            {/* Dimmed tasks app window backdrop */}
            <div
              aria-hidden="true"
              class="tasks-gfx-lc-window"
              style={{
                filter: 'saturate(0.9)',
                overflow: 'hidden',
                'mask-image':
                  'linear-gradient(to bottom, #000 0%, #000 56%, transparent 100%)',
                '-webkit-mask-image':
                  'linear-gradient(to bottom, #000 0%, #000 56%, transparent 100%)',
                opacity: 1,
                'pointer-events': 'none',
                position: 'absolute',
                'z-index': 0,
              }}
            >
              <HeroTaskWindow />
              <div
                aria-hidden="true"
                style={{
                  background: 'rgb(0 0 0 / 0.48)',
                  inset: '0',
                  'pointer-events': 'none',
                  position: 'absolute',
                }}
              />
            </div>
            {/* Spotlit foreground — the active stage graphic */}
            <div
              class="tasks-gfx-lc-spotlight"
              style={{
                'align-items': 'center',
                display: 'grid',
                'justify-items': 'center',
                position: 'absolute',
                'z-index': 1,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  'justify-items': 'center',
                  position: 'relative',
                  width: '100%',
                }}
              >
                <For each={lifecycleStages}>
                  {(stage, i) => (
                    <Show when={active() === i()}>
                      <div
                        class="lc-stage-graphic"
                        style={{
                          'align-items': 'center',
                          display: 'flex',
                          filter: 'drop-shadow(0 30px 60px rgb(0 0 0 / 0.5))',
                          'justify-content': 'center',
                          'max-height': '100%',
                          position: 'relative',
                          width: '100%',
                          'z-index': 1,
                        }}
                      >
                        <Dynamic component={stage.graphic} />
                      </div>
                    </Show>
                  )}
                </For>
              </div>
            </div>
          </div>
          <SsgMobile>
            <div
              style={{
                'align-items': 'center',
                bottom: '6px',
                'box-sizing': 'border-box',
                display: 'grid',
                height: '82px',
                'justify-items': 'center',
                'padding-inline': '18px',
                position: 'absolute',
                width: '100%',
                'z-index': 2,
              }}
            >
              <p
                style={{
                  color: 'var(--c0)',
                  'font-family': 'body',
                  'font-size': '15px',
                  'font-weight': '600',
                  'line-height': 1.5,
                  margin: 0,
                  'text-align': 'center',
                  width: '100%',
                }}
              >
                {lifecycleStages[active()].blurb}
              </p>
            </div>
          </SsgMobile>
        </div>

        {/* Desktop: figure-style step columns with vertical dividers */}
        <SsgDesktop>
          <ol
            style={{
              'border-top':
                '1px solid color-mix(in srgb, var(--b4) 20%, transparent)',
              display: 'grid',
              'grid-template-columns': `repeat(${lifecycleStages.length}, minmax(0, 1fr))`,
              'list-style': 'none',
              margin: 0,
              padding: 0,
            }}
          >
            <For each={lifecycleStages}>
              {(stage, i) => (
                <li
                  class="lc-step"
                  style={{
                    'border-left':
                      i() > 0
                        ? '1px solid color-mix(in srgb, var(--b4) 20%, transparent)'
                        : 'none',
                    'box-sizing': 'border-box',
                  }}
                >
                  <button
                    type="button"
                    class="lc-step-btn"
                    aria-current={active() === i() ? 'step' : undefined}
                    onClick={() => select(i())}
                    style={{
                      background: 'transparent',
                      border: 0,
                      cursor: 'default',
                      display: 'grid',
                      gap: '10px',
                      padding: '24px 28px',
                      'text-align': 'left',
                      width: '100%',
                    }}
                  >
                    <span
                      class="lc-step-title"
                      style={{
                        color: active() === i() ? 'var(--c1)' : 'var(--c2)',
                        'font-family': 'body',
                        'font-size': '15px',
                        'font-weight': '700',
                        'letter-spacing': '0.07em',
                        'line-height': 1.2,
                        'text-transform': 'uppercase',
                        transition: 'color 200ms ease',
                      }}
                    >
                      {stage.title}
                    </span>
                    <span
                      style={{
                        color:
                          active() === i()
                            ? 'var(--c4)'
                            : 'color-mix(in srgb, var(--c4) 45%, transparent)',
                        'font-family': 'body',
                        'font-size': '14px',
                        'font-weight': '500',
                        'line-height': 1.5,
                        transition: 'color 200ms ease',
                      }}
                    >
                      {stage.blurb}
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ol>
        </SsgDesktop>
      </div>

      {/* Mobile: tabs sit directly on the frame's bottom divider. */}
      <SsgMobile>
        <div
          style={{
            'max-width': '1100px',
            position: 'relative',
            width: '100%',
            'z-index': 1,
          }}
        >
          <div
            role="tablist"
            aria-label="Task stages"
            style={{
              'box-sizing': 'border-box',
              display: 'flex',
              gap: '6px',
              'justify-content': 'space-between',
              padding: '13px 10px 3px',
              width: '100%',
            }}
          >
            <For each={lifecycleStages}>
              {(stage, i) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={active() === i()}
                  class="lc-chip"
                  onClick={() => select(i())}
                  style={{
                    'align-items': 'center',
                    background:
                      active() === i()
                        ? 'color-mix(in srgb, var(--c1) 10%, transparent)'
                        : 'color-mix(in srgb, var(--b1) 52%, transparent)',
                    border:
                      active() === i()
                        ? '1px solid color-mix(in srgb, var(--b4) 28%, var(--b0))'
                        : '1px solid color-mix(in srgb, var(--b4) 18%, transparent)',
                    'border-radius': '999px',
                    'box-shadow':
                      active() === i()
                        ? 'inset 0 1px 0 color-mix(in srgb, var(--b4) 10%, transparent)'
                        : undefined,
                    color: active() === i() ? 'var(--c0)' : 'var(--c3)',
                    cursor: 'default',
                    display: 'inline-flex',
                    flex: 'none',
                    'font-family': 'body',
                    'font-size': '16px',
                    'font-weight': '700',
                    gap: '7px',
                    'letter-spacing': '0.07em',
                    'line-height': 1,
                    padding: '8px 10px',
                    'text-transform': 'uppercase',
                  }}
                >
                  {stage.title}
                </button>
              )}
            </For>
          </div>
        </div>
      </SsgMobile>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat integration graphic — a channel conversation where a message becomes a
// task (hover action), a later message @mentions the task inline, and a hover
// preview card shows the task without leaving the thread. Static composition.
// ---------------------------------------------------------------------------

// Inline task @mention as the real app renders it in a message: the green task
// glyph + underlined title + trailing status ring.
function TaskMentionInline(props: { label: string; status?: StatusKind }) {
  const StatusGlyph = STATUS_ICON[props.status ?? 'in-progress'];
  return (
    <span
      style={{
        color: 'var(--c1)',
        'font-family': appFont,
        'white-space': 'nowrap',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          'margin-right': '4px',
          'vertical-align': 'middle',
        }}
      >
        <IconTaskMacro
          aria-hidden="true"
          style={{
            color: 'var(--a2)',
            display: 'block',
            flex: 'none',
            height: '13px',
            width: '13px',
          }}
        />
      </span>
      <span
        style={{
          'text-decoration-line': 'underline',
          'text-decoration-color':
            'color-mix(in oklab, currentColor 20%, transparent)',
          'text-underline-offset': '2px',
        }}
      >
        {props.label}
      </span>
      <span
        style={{
          display: 'inline-flex',
          'margin-left': '5px',
          'vertical-align': 'middle',
        }}
      >
        <StatusGlyph
          aria-hidden="true"
          style={{
            color: STATUS_META[props.status ?? 'in-progress'].color,
            display: 'block',
            flex: 'none',
            height: '12px',
            width: '12px',
          }}
        />
      </span>
    </span>
  );
}

// Accent @person mention (matches the channels-page UserMention pill).
function PersonMentionInline(props: { label: string }) {
  return (
    <span
      style={{
        'background-color': 'color-mix(in srgb, var(--a0) 8%, transparent)',
        'border-radius': '6px',
        color: 'var(--a0)',
        'font-family': appFont,
        margin: '0 2px',
        padding: '1px 4px',
        'white-space': 'nowrap',
      }}
    >
      @{props.label}
    </span>
  );
}

// Classic OS pointer, planted on the hover action to imply the click.
function PointerGlyph(props: { size?: number }) {
  const s = props.size ?? 20;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path
        d="M5 2.5l13.5 7.2-5.7 1.3-1.2 5.9z"
        fill="var(--c1)"
        stroke="var(--b0)"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// One channel message row: avatar, name + time, body.
function ChatMessage(props: {
  initials: string;
  name: string;
  time: string;
  children: JSX.Element;
  compact: boolean;
}) {
  return (
    <div
      style={{
        'align-items': 'flex-start',
        display: 'flex',
        gap: '10px',
        'min-width': 0,
      }}
    >
      <Avatar initials={props.initials} size={28} color="var(--b3)" />
      <div style={{ display: 'grid', gap: '3px', 'min-width': 0 }}>
        <span style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}>
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13.5px',
              'font-weight': '600',
            }}
          >
            {props.name}
          </span>
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '11.5px',
            }}
          >
            {props.time}
          </span>
        </span>
        <p
          style={{
            color: 'var(--c2)',
            'font-family': appFont,
            'font-size': props.compact ? '13px' : '14px',
            'line-height': 1.6,
            margin: 0,
          }}
        >
          {props.children}
        </p>
      </div>
    </div>
  );
}

// Bordered property pill used inside the task preview card.
function TaskPropertyPill(props: { children: JSX.Element }) {
  return (
    <span
      style={{
        'align-items': 'center',
        border: '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
        'border-radius': '999px',
        color: 'var(--c2)',
        display: 'inline-flex',
        'font-family': appFont,
        'font-size': '11.5px',
        gap: '6px',
        padding: '4px 9px',
        'white-space': 'nowrap',
      }}
    >
      {props.children}
    </span>
  );
}

export function ChatTasksGraphic() {
  const compact = () => mobile();
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: compact() ? '12px 14px' : '16px 24px',
        width: '100%',
      }}
    >
      <div style={{ display: 'grid', width: 'min(500px, 100%)' }}>
        {/* The channel conversation */}
        <div
          style={{
            'background-color': '#0a0a0a',
            border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
            'border-radius': '12px',
            'box-shadow': 'var(--shadow-panel-md)',
            'box-sizing': 'border-box',
            width: '100%',
          }}
        >
          <div
            style={{
              'align-items': 'center',
              'border-bottom':
                '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
              display: 'flex',
              gap: '8px',
              padding: '11px 14px',
            }}
          >
            <MacroNavIcon name="channels" size={15} />
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '13.5px',
                'font-weight': '600',
              }}
            >
              growth
            </span>
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '11.5px',
                'margin-left': 'auto',
              }}
            >
              Today
            </span>
          </div>

          {/* Message with its hover "Create task" action mid-click */}
          <div
            style={{
              padding: compact() ? '14px 14px 4px' : '16px 16px 4px',
              position: 'relative',
            }}
          >
            <ChatMessage
              initials="JW"
              name="Julia"
              time="9:12 AM"
              compact={compact()}
            >
              Signups stall at the pricing step — can someone dig in before the
              launch call?
            </ChatMessage>
            {/* Floating message-actions bar, "Create task" highlighted */}
            <div
              style={{
                'align-items': 'center',
                'background-color': 'var(--b1)',
                border:
                  '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
                'border-radius': '9px',
                'box-shadow': 'var(--shadow-panel-sm)',
                display: 'inline-flex',
                gap: '2px',
                padding: '3px',
                position: 'absolute',
                right: compact() ? '10px' : '14px',
                top: '-13px',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  'align-items': 'center',
                  color: 'var(--c4)',
                  display: 'inline-grid',
                  height: '24px',
                  'place-items': 'center',
                  width: '24px',
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  style={{ display: 'block' }}
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="8.5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                  />
                  <path
                    d="M8.5 13.5a4.5 4.5 0 0 0 7 0"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                  />
                  <circle cx="9.3" cy="9.8" r="1" fill="currentColor" />
                  <circle cx="14.7" cy="9.8" r="1" fill="currentColor" />
                </svg>
              </span>
              <span
                aria-hidden="true"
                style={{
                  'align-items': 'center',
                  color: 'var(--c4)',
                  display: 'inline-grid',
                  height: '24px',
                  'place-items': 'center',
                  width: '24px',
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  style={{ display: 'block' }}
                >
                  <path
                    d="M9 17l-5-5 5-5M4.5 12H14a5.5 5.5 0 0 1 5.5 5.5V19"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </span>
              <span
                style={{
                  'align-items': 'center',
                  'background-color':
                    'color-mix(in srgb, var(--a0) 14%, transparent)',
                  'border-radius': '7px',
                  color: 'var(--c1)',
                  display: 'inline-flex',
                  'font-family': appFont,
                  'font-size': '12px',
                  'font-weight': '600',
                  gap: '6px',
                  height: '24px',
                  padding: '0 8px',
                  position: 'relative',
                  'white-space': 'nowrap',
                }}
              >
                <MacroNavIcon name="tasks" size={13} accent />
                Create task
                <span
                  aria-hidden="true"
                  style={{
                    bottom: '-13px',
                    position: 'absolute',
                    right: '-7px',
                  }}
                >
                  <PointerGlyph size={18} />
                </span>
              </span>
            </div>
          </div>

          {/* Follow-up message referencing the created task inline */}
          <div
            style={{ padding: compact() ? '12px 14px 16px' : '13px 16px 18px' }}
          >
            <ChatMessage
              initials="GB"
              name="Gabriel"
              time="9:15 AM"
              compact={compact()}
            >
              On it — tracking in{' '}
              <TaskMentionInline
                label="Fix pricing-step drop-off"
                status="in-progress"
              />
            </ChatMessage>
          </div>
        </div>

        {/* Hover preview of the mentioned task, overlapping the thread like a
            popover. The backlink row carries the "linked to its message" story. */}
        <div
          style={{
            'background-color': 'var(--b1)',
            border: '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
            'border-radius': '12px',
            'box-shadow': 'var(--shadow-panel-lg)',
            'box-sizing': 'border-box',
            'justify-self': 'end',
            margin: compact() ? '-8px 6px 0 0' : '-10px 24px 0 0',
            width: 'min(340px, 94%)',
            'z-index': 1,
          }}
        >
          <div
            style={{
              'align-items': 'center',
              display: 'flex',
              gap: '10px',
              padding: '12px 14px 10px',
            }}
          >
            <StatusIcon kind="in-progress" size={17} />
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': compact() ? '13.5px' : '14px',
                'font-weight': '600',
                'line-height': 1.25,
                'min-width': 0,
              }}
            >
              Fix pricing-step drop-off
            </span>
          </div>
          <div
            style={{
              'align-items': 'center',
              display: 'flex',
              'flex-wrap': 'wrap',
              gap: '7px',
              padding: '0 14px 12px',
            }}
          >
            <TaskPropertyPill>
              <StatusIcon kind="in-progress" size={13} /> In Progress
            </TaskPropertyPill>
            <TaskPropertyPill>
              <Avatar initials="GB" size={16} color="var(--b3)" /> Gabriel
            </TaskPropertyPill>
            <TaskPropertyPill>
              <PriorityIcon kind="high" size={13} /> High
            </TaskPropertyPill>
          </div>
          <div
            style={{
              'align-items': 'center',
              'border-top':
                '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
              color: 'var(--c4)',
              display: 'flex',
              gap: '7px',
              padding: '10px 14px',
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              aria-hidden="true"
              style={{ display: 'block', flex: 'none' }}
            >
              <path
                d="M10 14a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2M14 10a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
            <span
              style={{
                'font-family': appFont,
                'font-size': '11.5px',
                'min-width': 0,
                overflow: 'hidden',
                'text-overflow': 'ellipsis',
                'white-space': 'nowrap',
              }}
            >
              Created from Julia's message in{' '}
              <span style={{ color: 'var(--c2)' }}>#growth</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent handoff graphic — @Macro is mentioned in a thread, picks the task up,
// works it (status, description, comments), then hands it back. Static.
// ---------------------------------------------------------------------------

const agentHandoffSteps: {
  label: JSX.Element;
  meta: string;
  state: 'done' | 'active';
}[] = [
  {
    label: (
      <>
        Moved to <span style={{ color: 'var(--c2)' }}>In Progress</span>
      </>
    ),
    meta: '9:42 AM',
    state: 'done',
  },
  {
    label: <>Updated the description with repro steps</>,
    meta: '9:58 AM',
    state: 'done',
  },
  {
    label: <>Commented: root cause is the coupon validator</>,
    meta: '10:14 AM',
    state: 'done',
  },
  {
    label: (
      <>
        Moved to <span style={{ color: 'var(--c2)' }}>In Review</span> · handed
        back to Jacob
      </>
    ),
    meta: '10:31 AM',
    state: 'active',
  },
];

export function AgentHandoffGraphic() {
  const compact = () => mobile();
  const cardStyle: JSX.CSSProperties = {
    'background-color': '#0a0a0a',
    border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
    'border-radius': '12px',
    'box-shadow': 'var(--shadow-panel-md)',
    'box-sizing': 'border-box',
    width: 'min(520px, 100%)',
  };
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '0',
        'justify-items': 'center',
        padding: compact() ? '12px 14px' : '16px 24px',
        width: '100%',
      }}
    >
      {/* The thread: a teammate hands the task to @Macro, the agent accepts */}
      <div style={cardStyle}>
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            gap: '8px',
            padding: '11px 14px',
          }}
        >
          <MacroNavIcon name="channels" size={15} />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13.5px',
              'font-weight': '600',
            }}
          >
            growth
          </span>
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '11.5px',
              'margin-left': 'auto',
            }}
          >
            Thread
          </span>
        </div>
        <div style={{ padding: compact() ? '14px 14px 4px' : '16px 16px 4px' }}>
          <ChatMessage
            initials="JB"
            name="Jacob"
            time="9:41 AM"
            compact={compact()}
          >
            <PersonMentionInline label="Macro" /> can you take{' '}
            <TaskMentionInline
              label="Fix pricing-step drop-off"
              status="not-started"
            />
            ? I'm heads-down on launch prep.
          </ChatMessage>
        </div>
        {/* Agent reply */}
        <div
          style={{
            'align-items': 'flex-start',
            display: 'flex',
            gap: '10px',
            padding: compact() ? '12px 14px 16px' : '13px 16px 18px',
          }}
        >
          <span
            style={{
              'align-items': 'center',
              background:
                'linear-gradient(135deg, var(--a0), color-mix(in srgb, var(--a0) 55%, var(--b0)))',
              'border-radius': '999px',
              color: 'var(--b0)',
              display: 'inline-flex',
              flex: 'none',
              height: '28px',
              'justify-content': 'center',
              width: '28px',
            }}
          >
            <SparkleGlyph size={15} />
          </span>
          <div style={{ display: 'grid', gap: '3px', 'min-width': 0 }}>
            <span
              style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}
            >
              <span
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': '13.5px',
                  'font-weight': '600',
                }}
              >
                Macro
              </span>
              <span
                style={{
                  color: 'var(--c4)',
                  'font-family': appFont,
                  'font-size': '11.5px',
                }}
              >
                Agent · 9:41 AM
              </span>
            </span>
            <p
              style={{
                color: 'var(--c2)',
                'font-family': appFont,
                'font-size': compact() ? '13px' : '14px',
                'line-height': 1.6,
                margin: 0,
              }}
            >
              On it — I'll update the task as I go and hand it back for review.
            </p>
          </div>
        </div>
      </div>

      {/* Connector — the agent carries the work into the task below */}
      <div
        aria-hidden="true"
        style={{
          display: 'grid',
          'justify-items': 'center',
          padding: compact() ? '10px 0' : '14px 0',
          position: 'relative',
          width: '100%',
        }}
      >
        <svg
          width="14"
          height="56"
          viewBox="0 0 14 56"
          aria-hidden="true"
          style={{ overflow: 'visible' }}
        >
          <line
            x1="7"
            y1="0"
            x2="7"
            y2="46"
            stroke="var(--a0)"
            stroke-width="1.5"
            stroke-dasharray="5 5"
          />
          <path d="M2 46 L7 54 L12 46 Z" fill="var(--a0)" />
        </svg>
        <span
          style={{
            color: 'var(--a0)',
            'font-family': 'rajdhani, body',
            'font-size': '12px',
            'font-weight': '700',
            left: 'calc(50% + 15px)',
            'letter-spacing': '0.08em',
            'line-height': 1,
            position: 'absolute',
            top: '50%',
            transform: 'translateY(-50%)',
            'text-transform': 'uppercase',
            'white-space': 'nowrap',
          }}
        >
          Agent at work
        </span>
      </div>

      {/* The task, updated by the agent step by step */}
      <div
        style={{
          ...cardStyle,
          'border-color': 'color-mix(in srgb, var(--a0) 40%, transparent)',
        }}
      >
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            gap: '11px',
            padding: compact() ? '13px 14px' : '14px 16px',
          }}
        >
          <StatusIcon kind="in-review" size={18} />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': compact() ? '13px' : '15px',
              'line-height': 1.25,
              'min-width': 0,
            }}
          >
            Fix pricing-step drop-off
          </span>
          <span
            style={{
              'align-items': 'center',
              display: 'inline-flex',
              flex: 'none',
              gap: '7px',
              'margin-left': 'auto',
            }}
          >
            <Avatar initials="JB" size={20} color="var(--b3)" />
            <Show when={!compact()}>
              <span
                style={{
                  color: 'var(--c2)',
                  'font-family': appFont,
                  'font-size': '12.5px',
                  'white-space': 'nowrap',
                }}
              >
                Jacob
              </span>
            </Show>
          </span>
        </div>
        <div
          style={{
            display: 'grid',
            gap: '0',
            padding: compact() ? '10px 14px 14px' : '12px 16px 16px',
          }}
        >
          <For each={agentHandoffSteps}>
            {(step, index) => (
              <div
                style={{
                  'column-gap': '12px',
                  display: 'grid',
                  'grid-template-columns': '14px minmax(0, 1fr) auto',
                  position: 'relative',
                }}
              >
                <Show when={index() < agentHandoffSteps.length - 1}>
                  <span
                    aria-hidden="true"
                    style={{
                      'background-color': 'var(--b3)',
                      bottom: '-7px',
                      left: '6.5px',
                      position: 'absolute',
                      top: '19px',
                      width: '1px',
                    }}
                  />
                </Show>
                <span
                  aria-hidden="true"
                  style={{
                    'align-self': 'start',
                    'background-color': 'var(--a0)',
                    border: '1px solid var(--a0)',
                    'border-radius': '999px',
                    'box-sizing': 'border-box',
                    height: '9px',
                    'margin-left': '2.5px',
                    'margin-top': '10px',
                    opacity: step.state === 'done' ? 0.55 : 1,
                    width: '9px',
                  }}
                />
                <span
                  style={{
                    color: step.state === 'active' ? 'var(--c1)' : 'var(--c4)',
                    'font-family': appFont,
                    'font-size': compact() ? '13px' : '14px',
                    'line-height': 1.4,
                    padding: '7px 0',
                  }}
                >
                  {step.label}
                </span>
                <span
                  style={{
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': '12px',
                    opacity: 0.65,
                    padding: '8px 0',
                    'white-space': 'nowrap',
                  }}
                >
                  {step.meta}
                </span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
