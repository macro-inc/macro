import type { Component, JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import IconChannel from '../../../assets/icons/icon-channels.svg';
import IconGithub from '../../../assets/icons/icon-github.svg';
import IconCheck from '../../../assets/icons/phosphor/check.svg';
import IconPullRequest from '../../../assets/icons/phosphor/git-pull-request.svg';
import IconLink from '../../../assets/icons/phosphor/link.svg';
import IconShare from '../../../assets/icons/phosphor/share.svg';
import StatusCreated from '../../../assets/icons/square-task-created-circle.svg';
import StatusDone from '../../../assets/icons/square-task-done-circle.svg';
import StatusInProgress from '../../../assets/icons/square-task-in-progress-circle.svg';
import StatusInReview from '../../../assets/icons/square-task-in-review-circle.svg';
import PriorityHigh from '../../../assets/icons/wide-priority-high.svg';
import PriorityLow from '../../../assets/icons/wide-priority-low.svg';
import PriorityMedium from '../../../assets/icons/wide-priority-medium.svg';
import PriorityUrgent from '../../../assets/icons/wide-priority-urgent.svg';
import IconTask from '../../../assets/icons/wide-task.svg';
import { MacroMarkIcon } from './MacroMarkIcon';

// ---------------------------------------------------------------------------
// A single task, drawn as the product draws it — the same panel the lifecycle
// section's third phase shows, minus the clock.
//
// It exists because TasksLifecycleScene's version of this panel is welded to
// that section's animation: every value in it is a function of `t`, the panel
// is `zoom`ed into a fixed 880x402 artboard, and its markup carries cursor
// targets and measurement hooks. None of that survives being used as a plain
// graphic. So this is the static sibling rather than a refactor of that one:
// the visual language (the #0d0e10 face, the 0.5px rgba(206,206,206,.4) edge,
// the glint, the chip and activity treatments) is shared by construction, the
// mechanics are not. If the lifecycle panel is ever un-animated enough to sit
// on top of this, that is the merge — it is not worth forcing today.
//
// Laid out at a fixed CARD_W and scaled by the caller with `zoom`, which
// reflows: text is laid out at its final size and stays crisp, unlike a
// transform. Colours and metrics come from the same Figma file the lifecycle
// panel was built from (IOH8EtjS7V8rmxnbJzFZ2A, node 906:15311), sized up from
// its 10px body to suit a card that is shown at roughly 1:1 rather than
// through two nested zooms.
// ---------------------------------------------------------------------------

const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** The design width every number below is stated against. */
export const CARD_W = 490;
/** Fixed so a row of cards shares one silhouette however much copy each holds.
    The body distributes the slack with space-between, so height above what the
    content needs lands in one place: the gap between the checklist and the
    activity list. That is the knob for how much air the card has. */
export const CARD_H = 300;

export type TaskStatusId = 'created' | 'in-progress' | 'in-review' | 'done';
export type TaskPriorityId = 'urgent' | 'high' | 'medium' | 'low';

/** Status colours are the product's: green when a task is opened or finished,
    amber while it is moving, periwinkle in review — the same three the
    lifecycle scene uses. */
const STATUS: Record<
  TaskStatusId,
  { icon: Component<any>; color: string; label: string }
> = {
  created: { icon: StatusCreated, color: '#15da43', label: 'Created' },
  'in-progress': {
    icon: StatusInProgress,
    color: '#ffae00',
    label: 'In Progress',
  },
  'in-review': { icon: StatusInReview, color: '#a2b2ff', label: 'In Review' },
  done: { icon: StatusDone, color: '#15da43', label: 'Completed' },
};

/** The priority glyphs are drawn on an 18x12 viewBox — bars, not a square —
    so they are sized by width with the height following that ratio. */
const PRIORITY: Record<
  TaskPriorityId,
  { icon: Component<any>; label: string }
> = {
  urgent: { icon: PriorityUrgent, label: 'Urgent' },
  high: { icon: PriorityHigh, label: 'High' },
  medium: { icon: PriorityMedium, label: 'Medium' },
  low: { icon: PriorityLow, label: 'Low' },
};

export type TaskActivity = {
  /** A face for a person, the Macro mark for the agent, or a PR disc for work
      the agent did on a branch. */
  who: { kind: 'person'; src: string } | { kind: 'agent' } | { kind: 'pr' };
  body: JSX.Element;
  time: string;
};

export type TaskCardData = {
  title: string;
  status: TaskStatusId;
  priority: TaskPriorityId;
  assignee: { src: string; name: string };
  /** Plain text, with `#channel` and `@name` marked up by the card. */
  desc: JSX.Element;
  checks: { label: string; done: boolean }[];
  activity: TaskActivity[];
};

const Ic = (p: {
  icon: Component<any>;
  w: number;
  h?: number;
  color?: string;
  style?: JSX.CSSProperties;
}) => (
  <Dynamic
    component={p.icon}
    aria-hidden="true"
    // overflow visible because several of these glyphs are drawn to the edge
    // of their viewBox and an SVG root clips to it by default.
    style={{
      color: p.color,
      display: 'block',
      flex: 'none',
      height: `${p.h ?? p.w}px`,
      overflow: 'visible',
      width: `${p.w}px`,
      ...p.style,
    }}
  />
);

const Face = (p: { src: string; size: number }) => (
  <img
    alt=""
    class="tcp-face"
    src={p.src}
    width={p.size}
    height={p.size}
    style={{ height: `${p.size}px`, width: `${p.size}px` }}
  />
);

/** Macro's face wherever it acts as a participant: the brand mark in orange on
    a black disc. The mark's viewBox is 182x119, so it is sized by width with
    its height following — forcing it square squashes the three strokes. */
const AgentFace = (p: { size: number }) => (
  <span
    aria-hidden="true"
    class="tcp-disc"
    style={{ background: '#000', height: `${p.size}px`, width: `${p.size}px` }}
  >
    <MacroMarkIcon
      style={{
        color: 'var(--a0)',
        display: 'block',
        fill: 'currentColor',
        flex: 'none',
        height: `${((p.size * 0.58) / (182 / 119)).toFixed(2)}px`,
        overflow: 'visible',
        width: `${(p.size * 0.58).toFixed(2)}px`,
      }}
    />
  </span>
);

/** Same footprint as a face, so the connector line down the left of the
    activity list stays on one axis whatever wrote the row. */
const PrFace = (p: { size: number }) => (
  <span
    aria-hidden="true"
    class="tcp-disc"
    style={{
      background: '#16191f',
      border: '0.5px solid #353535',
      height: `${p.size}px`,
      width: `${p.size}px`,
    }}
  >
    <Ic icon={IconPullRequest} w={p.size * 0.86} color="#ff8f00" />
  </span>
);

/** How far the icon box drops below the baseline, which is not the same number
    for every glyph: what wants to sit ON the baseline is the ink, and each icon
    carries a different amount of its own padding inside its viewBox. The
    channel hash is drawn on `0 -4 24 24` with the mark 15 units tall, so at
    10px it has 1.875px of air under it and needs that much extra drop or it
    floats above the text and reads as clipped. The github mark fills its
    viewBox edge to edge, so a plain 1px optical drop is right. */
const MENTION_DY = { channel: -2, mark: -1 };

/** Channel-style inline mention: a small icon, then underlined text. The glyph
    inherits the surrounding ink unless a colour is asked for -- inside a
    description the hash reads as part of the sentence, not as a second
    accent competing with the orange @names. */
export const Mention = (p: {
  children: JSX.Element;
  icon?: Component<any>;
  w?: number;
  color?: string;
  dy?: number;
}) => (
  <span class="tcp-mention">
    <Ic
      icon={p.icon ?? IconChannel}
      w={p.w ?? 10}
      color={p.color}
      style={{
        display: 'inline-block',
        'margin-right': '3px',
        'vertical-align': `${p.dy ?? MENTION_DY.channel}px`,
      }}
    />
    <span class="tcp-u">{p.children}</span>
  </span>
);

/** A github-marked PR reference, for the agent's activity rows. */
export const PrRef = (p: { children: JSX.Element }) => (
  <Mention icon={IconGithub} w={9} color="#fff" dy={MENTION_DY.mark}>
    {p.children}
  </Mention>
);

/** An @name, in the orange every mention on this site uses. */
export const At = (p: { children: JSX.Element }) => (
  <span class="tcp-at">{p.children}</span>
);

/** Render once per page, not once per card — three identical <style> blocks is
    three copies of the same rules in the document. */
export function TaskCardStyles() {
  return (
    <style>{`
      .tcp-card {
        background: #0d0e10;
        border: 0.5px solid rgba(206,206,206,0.4);
        border-radius: 12px;
        /* Deep and wide on purpose: the page ground is --b0 (oklch .14) and the
           card face is darker still, so a timid shadow has nothing to darken.
           Three layers -- a tight contact edge, a mid body, and a broad haze
           with real spread -- which is also what separates each card in the
           stair from the one it lands on. */
        box-shadow: 0 2px 12px rgb(0 0 0 / 1), 0 22px 48px 14px rgb(0 0 0 / 0.95), 0 60px 130px 40px rgb(0 0 0 / 0.85);
        box-sizing: border-box;
        color: #fff;
        display: flex;
        flex-direction: column;
        font-family: ${appFont};
        height: ${CARD_H}px;
        overflow: hidden;
        padding: 10px;
        position: relative;
        width: ${CARD_W}px;
        /* The lifecycle panel's, and load-bearing: left on the default
           subpixel antialiasing this copy renders a visible weight heavier
           than the same 400 does in that panel. */
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      /* The panel glint, at the strength the lifecycle's task panel settled on:
         a 0.4-alpha white ramp at 0.09 opacity, so its effective peak is the
         same 0.036 white the channel panel's solid ramp reaches at 0.06. */
      .tcp-card::before {
        background: linear-gradient(131.84deg, rgba(255,255,255,0.4) 14.6%, rgba(255,255,255,0) 37.6%);
        border-radius: 12px;
        content: '';
        height: 62%;
        left: -0.5px;
        opacity: 0.09;
        pointer-events: none;
        position: absolute;
        top: -0.5px;
        width: 58%;
      }

      .tcp-head { align-items: center; display: flex; gap: 10px; justify-content: space-between; padding: 2px 0 9px 4px; }
      .tcp-title { align-items: center; display: flex; font-size: 12px; font-weight: 600; gap: 5px; line-height: 14px; min-width: 0; }
      .tcp-title > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tcp-right { align-items: center; display: flex; flex: none; gap: 7px; }
      .tcp-count { align-items: center; display: flex; font-size: 11px; gap: 5px; line-height: 13px; }
      /* A rounded track that CLIPS its fill, so the bar is a proper pill at
         0/3 and 3/3 alike rather than the export's two interlocking halves. */
      .tcp-bar { background: #353535; border-radius: 999px; height: 4px; overflow: hidden; width: 52px; }
      .tcp-bar-fill { background: #15da43; display: block; height: 4px; }
      /* Share | Link, evenly divided: the divider lives inside the second
         half's box, so its padding gives back the 0.5px it costs. */
      .tcp-btns { align-items: stretch; background: #16191f; border: 0.5px solid #353535; border-radius: 5px; color: #8b8b8b; display: flex; padding: 0.5px; }
      .tcp-btns > span { align-items: center; display: flex; justify-content: center; padding: 3.5px; }
      .tcp-btns > span + span { border-left: 0.5px solid #353535; padding-left: 3px; }

      .tcp-chips { align-items: center; display: flex; gap: 6px; padding: 0 0 2px 4px; }
      .tcp-chip { align-items: center; background: #16191f; border: 0.5px solid #353535; border-radius: 999px; display: inline-flex; font-size: 10px; gap: 5px; line-height: 12px; padding: 4px 7px; white-space: nowrap; }
      .tcp-chip.pad-face { padding-left: 4px; }

      .tcp-body { display: flex; flex: 1 1 0; flex-direction: column; justify-content: space-between; min-height: 0; padding-top: 9px; }
      .tcp-desc { color: #fff; font-size: 11px; line-height: 14px; padding-left: 4px; }
      .tcp-checks { display: flex; flex-direction: column; gap: 7px; margin-top: 11px; }
      .tcp-check { align-items: center; display: flex; font-size: 11px; gap: 8px; line-height: 13px; padding-left: 4px; }
      .tcp-box { border-radius: 3px; display: grid; flex: none; height: 11px; place-items: center; width: 11px; }

      .tcp-acthead { align-items: center; color: #bfbfbf; display: flex; font-size: 9px; gap: 5px; line-height: 11px; padding: 4px 0; }
      .tcp-hair { background: #353535; height: 0.5px; }
      .tcp-acts { display: flex; flex-direction: column; gap: 8px; padding-left: 12px; position: relative; }
      /* Centred on the 11px face: 12 of padding + half the face, less half the
         hairline's own width. */
      .tcp-actline { background: #353535; bottom: 5px; left: 17.25px; position: absolute; top: 5px; width: 0.5px; }
      /* position: relative so the row paints AFTER .tcp-actline and its face
         masks the connector. The line is absolutely positioned, which puts
         it in a later paint step than a static sibling however far up the
         DOM it sits -- left static, the hairline draws over every avatar. */
      .tcp-act { align-items: center; display: flex; font-size: 9px; gap: 8px; justify-content: space-between; line-height: 11px; position: relative; }
      .tcp-act-l { align-items: center; display: flex; gap: 5px; min-width: 0; }
      .tcp-act-l > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tcp-act-t { color: #8b8b8b; flex: none; white-space: nowrap; }

      .tcp-at { color: #ff8f00; font-weight: 500; }
      .tcp-face { border-radius: 999px; display: block; flex: none; object-fit: cover; }
      .tcp-disc { align-items: center; border-radius: 999px; box-sizing: border-box; display: inline-flex; flex: none; justify-content: center; }
      .tcp-u { text-decoration: underline; text-decoration-thickness: from-font; text-underline-offset: 1px; }
      .tcp-mention { white-space: nowrap; }
    `}</style>
  );
}

export function TaskCard(p: { task: TaskCardData }) {
  const done = () => p.task.checks.filter((c) => c.done).length;
  const status = () => STATUS[p.task.status];
  const priority = () => PRIORITY[p.task.priority];

  return (
    <div aria-hidden="true" class="tcp-card">
      <div class="tcp-head">
        <span class="tcp-title">
          <Ic icon={IconTask} w={13} color="#15da43" />
          <span>{p.task.title}</span>
        </span>
        <span class="tcp-right">
          <span class="tcp-count">
            <span class="tcp-bar">
              <span
                class="tcp-bar-fill"
                style={{
                  width: `${((done() / p.task.checks.length) * 52).toFixed(1)}px`,
                }}
              />
            </span>
            {done()}/{p.task.checks.length}
          </span>
          <span class="tcp-btns">
            <span>
              <Ic icon={IconShare} w={11} />
            </span>
            <span>
              <Ic icon={IconLink} w={11} />
            </span>
          </span>
        </span>
      </div>

      <div class="tcp-chips">
        <span class="tcp-chip">
          <Ic icon={status().icon} w={11} color={status().color} />
          {status().label}
        </span>
        <span class="tcp-chip">
          <Ic icon={priority().icon} w={13} h={9} color="#bfbfbf" />
          {priority().label}
        </span>
        <span class="tcp-chip pad-face">
          <Face src={p.task.assignee.src} size={13} />
          {p.task.assignee.name}
        </span>
      </div>

      <div class="tcp-body">
        <div>
          <div class="tcp-desc">{p.task.desc}</div>
          <div class="tcp-checks">
            <For each={p.task.checks}>
              {(c) => (
                <div class="tcp-check">
                  <span
                    class="tcp-box"
                    style={{
                      background: c.done ? '#15da43' : 'transparent',
                      border: c.done ? 'none' : '0.5px solid #8b8b8b',
                    }}
                  >
                    <Show when={c.done}>
                      <Ic icon={IconCheck} w={9} color="#292b2f" />
                    </Show>
                  </span>
                  <span
                    style={{
                      'text-decoration': c.done ? 'line-through' : 'none',
                      'text-decoration-thickness': 'from-font',
                    }}
                  >
                    {c.label}
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>

        <div>
          <div class="tcp-acthead">
            <span class="tcp-hair" style={{ width: '9px' }} />
            Activity
            <span class="tcp-hair" style={{ flex: '1 1 0' }} />
          </div>
          <div class="tcp-acts">
            <span aria-hidden="true" class="tcp-actline" />
            <For each={p.task.activity}>
              {(row) => (
                <div class="tcp-act">
                  <span class="tcp-act-l">
                    {row.who.kind === 'person' ? (
                      <Face src={row.who.src} size={11} />
                    ) : row.who.kind === 'agent' ? (
                      <AgentFace size={11} />
                    ) : (
                      <PrFace size={11} />
                    )}
                    <span>{row.body}</span>
                  </span>
                  <span class="tcp-act-t">{row.time}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}
