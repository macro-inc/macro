/**
 * Playing a prototype, as Figma's presentation view does: which frame a
 * presentation starts at, the order the arrow keys step through, which
 * hotspot a click lands on, and what each action does to the screen and
 * overlay stack. Pure functions over the engine's `PrototypeInfo`.
 */

import type {
  PrototypeAction,
  PrototypeFrame,
  PrototypeHotspot,
  PrototypeInfo,
  PrototypeInteraction,
} from '@core/fig-engine/prototype-types';
import type { Rect } from '@core/fig-engine/types';

/** A flow: its name and the frame it starts at. */
export interface Flow {
  name: string;
  frame: string;
}

/**
 * The page's flows: its flow starting points, or the start frame of a file
 * from before flows. Empty when neither is set.
 */
export function flowsOf(info: PrototypeInfo): Flow[] {
  const screens = new Set(info.frames.map((f) => f.id));
  const flows = info.flows
    .filter((f) => screens.has(f.frame))
    .map((f) => ({ name: f.name, frame: f.frame }));
  if (flows.length === 0 && info.start && screens.has(info.start))
    return [{ name: 'Flow 1', frame: info.start }];
  return flows;
}

/** Frames `frame`'s hotspots navigate to, in the order they are drawn. */
function linksFrom(info: PrototypeInfo, frame: string): string[] {
  const out: string[] = [];
  for (const h of info.hotspots) {
    if (h.frame !== frame) continue;
    for (const i of h.interactions)
      for (const a of i.actions)
        if (
          a.connection === 'INTERNAL_NODE' &&
          a.navigation === 'NAVIGATE' &&
          a.destination
        )
          out.push(a.destination);
  }
  return out;
}

/**
 * The frames the arrow keys step through from `start`: with flows, the
 * frames the flow reaches (its start, then what it navigates to, breadth
 * first); without, every screen in page order.
 */
export function flowOrder(info: PrototypeInfo, start: string): string[] {
  const screens = info.frames.map((f) => f.id);
  const flows = flowsOf(info);
  const flow =
    flows.find((f) => f.frame === start) ??
    flows.find((f) => reachable(info, f.frame).includes(start));
  if (!flow) return screens;
  return reachable(info, flow.frame);
}

function reachable(info: PrototypeInfo, from: string): string[] {
  const screens = new Set(info.frames.map((f) => f.id));
  const order = [from];
  for (let k = 0; k < order.length; k++)
    for (const next of linksFrom(info, order[k]))
      if (screens.has(next) && !order.includes(next)) order.push(next);
  return order;
}

/**
 * Where presenting starts: the selected screen (or the screen holding the
 * selected layer), else the first flow's start, else the first screen.
 */
export function presentStart(
  info: PrototypeInfo,
  selected: string | undefined
): string | undefined {
  if (selected) {
    if (info.frames.some((f) => f.id === selected)) return selected;
    const hotspot = info.hotspots.find((h) => h.id === selected);
    if (hotspot) return hotspot.frame;
  }
  return flowsOf(info)[0]?.frame ?? info.frames[0]?.id;
}

/** The next (or previous) frame in the flow, wrapping around. */
export function stepFlow(
  order: string[],
  current: string,
  step: 1 | -1
): string | undefined {
  if (order.length === 0) return undefined;
  const at = order.indexOf(current);
  if (at < 0) return order[0];
  return order[(at + step + order.length) % order.length];
}

const contains = (r: Rect, x: number, y: number) =>
  x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;

/** Triggers a click (or a press) runs. */
const CLICK_TRIGGERS = new Set([
  'ON_CLICK',
  'ON_PRESS',
  'MOUSE_DOWN',
  'MOUSE_UP',
]);
/** Triggers a pointer over the hotspot runs. */
const HOVER_TRIGGERS = new Set(['ON_HOVER', 'MOUSE_ENTER']);

export type Gesture = 'click' | 'hover';

/** Whether an interaction does anything the player can show. */
export function playable(i: PrototypeInteraction): boolean {
  return i.actions.some(
    (a) =>
      (a.connection === 'INTERNAL_NODE' &&
        !!a.destination &&
        a.navigation !== 'SWAP_STATE') ||
      a.connection === 'BACK' ||
      a.connection === 'CLOSE' ||
      (a.connection === 'URL' && !!a.url)
  );
}

function matches(i: PrototypeInteraction, gesture: Gesture) {
  const triggers = gesture === 'click' ? CLICK_TRIGGERS : HOVER_TRIGGERS;
  return triggers.has(i.trigger) && playable(i);
}

/**
 * The top-most hotspot of `frame` at page point (`x`, `y`) with an
 * interaction `gesture` runs, and that interaction.
 */
export function hotspotAt(
  info: PrototypeInfo,
  frame: string,
  x: number,
  y: number,
  gesture: Gesture
):
  | { hotspot: PrototypeHotspot; interaction: PrototypeInteraction }
  | undefined {
  for (let k = info.hotspots.length - 1; k >= 0; k--) {
    const h = info.hotspots[k];
    if (h.frame !== frame || !contains(h.bounds, x, y)) continue;
    const interaction = h.interactions.find((i) => matches(i, gesture));
    if (interaction) return { hotspot: h, interaction };
  }
  return undefined;
}

/** The hotspots of `frame` a click would run (for flashing hints). */
export function clickableHotspots(
  info: PrototypeInfo,
  frame: string
): PrototypeHotspot[] {
  return info.hotspots.filter(
    (h) => h.frame === frame && h.interactions.some((i) => matches(i, 'click'))
  );
}

/** An overlay open over the screen. */
export interface OpenOverlay {
  frame: string;
  /** Page position of the hotspot that opened it (manual placement). */
  from?: Rect;
  /** A manually placed overlay's offset from that hotspot's frame. */
  offset?: { x: number; y: number };
}

/** Where the presentation is. */
export interface PlayerState {
  screen: string;
  /** Screens navigated away from, most recent last (for Back). */
  history: string[];
  overlays: OpenOverlay[];
}

export type Effect =
  | { kind: 'none' }
  | { kind: 'open-url'; url: string; newTab: boolean }
  | { kind: 'scroll-to'; node: string };

export interface Step {
  state: PlayerState;
  /** The action's transition, for the change it makes. */
  transition: Transition;
  effect: Effect;
}

export const startState = (screen: string): PlayerState => ({
  screen,
  history: [],
  overlays: [],
});

/** Runs one action. */
export function runAction(
  state: PlayerState,
  action: PrototypeAction,
  from?: PrototypeHotspot
): Step {
  const transition = transitionOf(action);
  const none: Step = {
    state,
    transition: INSTANT,
    effect: { kind: 'none' },
  };
  const dest = action.destination;
  switch (action.connection) {
    case 'BACK': {
      if (state.overlays.length > 0)
        return {
          state: { ...state, overlays: state.overlays.slice(0, -1) },
          transition,
          effect: { kind: 'none' },
        };
      const previous = state.history.at(-1);
      if (!previous) return none;
      return {
        state: {
          screen: previous,
          history: state.history.slice(0, -1),
          overlays: [],
        },
        transition: { ...transition, reverse: true },
        effect: { kind: 'none' },
      };
    }
    case 'CLOSE':
      return state.overlays.length > 0
        ? {
            state: { ...state, overlays: state.overlays.slice(0, -1) },
            transition,
            effect: { kind: 'none' },
          }
        : none;
    case 'URL':
      return action.url
        ? {
            state,
            transition: INSTANT,
            effect: {
              kind: 'open-url',
              url: action.url,
              newTab: action.openInNewTab ?? true,
            },
          }
        : none;
    case 'INTERNAL_NODE':
      break;
    default:
      return none;
  }
  if (!dest) return none;
  const overlay: OpenOverlay = {
    frame: dest,
    from: from?.bounds,
    offset: action.overlayOffset ?? undefined,
  };
  switch (action.navigation) {
    case 'OVERLAY':
      return {
        state: { ...state, overlays: [...state.overlays, overlay] },
        transition,
        effect: { kind: 'none' },
      };
    case 'SWAP':
      if (state.overlays.length > 0)
        return {
          state: {
            ...state,
            overlays: [...state.overlays.slice(0, -1), overlay],
          },
          transition,
          effect: { kind: 'none' },
        };
      return navigate(state, dest, transition);
    case 'SCROLL_TO':
      return {
        state,
        transition: INSTANT,
        effect: { kind: 'scroll-to', node: dest },
      };
    case 'SWAP_STATE':
      return none;
    default:
      return navigate(state, dest, transition);
  }
}

function navigate(
  state: PlayerState,
  dest: string,
  transition: Transition
): Step {
  if (dest === state.screen && state.overlays.length === 0)
    return { state, transition: INSTANT, effect: { kind: 'none' } };
  return {
    state: {
      screen: dest,
      history: [...state.history, state.screen],
      overlays: [],
    },
    transition,
    effect: { kind: 'none' },
  };
}

/** Goes to another screen directly (the arrow keys). */
export function goTo(state: PlayerState, screen: string): PlayerState {
  if (screen === state.screen && state.overlays.length === 0) return state;
  return {
    screen,
    history: [...state.history, state.screen],
    overlays: [],
  };
}

// ---- transitions ------------------------------------------------------------

export type Side = 'left' | 'right' | 'top' | 'bottom';

/**
 * How a change animates. `slide`: the new screen slides in over the old;
 * `push`: it pushes the old one out; `move-in` and `move-out` move a screen
 * without fading; Smart Animate is approximated as a dissolve.
 */
export interface Transition {
  kind: 'instant' | 'dissolve' | 'slide' | 'push' | 'move-in' | 'move-out';
  /** The side the new screen comes from (or the old one leaves to). */
  side?: Side;
  /** Seconds. */
  duration: number;
  /** Going back plays the transition in reverse. */
  reverse?: boolean;
}

const INSTANT: Transition = { kind: 'instant', duration: 0 };

const SIDES: Record<string, Side> = {
  LEFT: 'left',
  RIGHT: 'right',
  TOP: 'top',
  BOTTOM: 'bottom',
};

/** The transition of an action, from Figma's `TransitionType`. */
export function transitionOf(action: PrototypeAction): Transition {
  const t = action.transition;
  const duration = Math.max(0, Math.min(10, action.duration || 0.3));
  if (t === 'INSTANT_TRANSITION') return INSTANT;
  if (
    t === 'DISSOLVE' ||
    t === 'FADE' ||
    t === 'SMART_ANIMATE' ||
    t === 'MAGIC_MOVE'
  )
    return { kind: 'dissolve', duration };
  const m =
    /^(SLIDE_FROM|PUSH_FROM|MOVE_FROM|SLIDE_OUT_TO|MOVE_OUT_TO)_(LEFT|RIGHT|TOP|BOTTOM)$/.exec(
      t
    );
  if (!m) return { kind: 'dissolve', duration };
  const side = SIDES[m[2]];
  const kind = {
    SLIDE_FROM: 'slide',
    PUSH_FROM: 'push',
    MOVE_FROM: 'move-in',
    SLIDE_OUT_TO: 'move-out',
    MOVE_OUT_TO: 'move-out',
  }[m[1]] as Transition['kind'];
  return { kind, side, duration };
}

// ---- overlays ----------------------------------------------------------------

/**
 * Where an overlay goes on the screen (screen-frame coordinates), as Figma
 * places it: by its overlay position, or at a manual offset from the
 * hotspot's frame.
 */
export function overlayPosition(
  overlay: PrototypeFrame,
  screen: PrototypeFrame,
  open: OpenOverlay
): { x: number; y: number } {
  const sw = screen.bounds.w;
  const sh = screen.bounds.h;
  const w = overlay.bounds.w;
  const h = overlay.bounds.h;
  const position = overlay.overlay?.position ?? 'CENTER';
  if (position === 'MANUAL' && open.offset) return open.offset;
  const x = position.endsWith('LEFT')
    ? 0
    : position.endsWith('RIGHT')
      ? sw - w
      : (sw - w) / 2;
  const y = position.startsWith('TOP')
    ? 0
    : position.startsWith('BOTTOM')
      ? sh - h
      : (sh - h) / 2;
  return { x, y };
}

/** CSS color for an `RRGGBBAA` hex. */
export function hexColor(hex: string): string {
  const n = (k: number) => Number.parseInt(hex.slice(k, k + 2), 16);
  const a = hex.length >= 8 ? n(6) / 255 : 1;
  return `rgba(${n(0)}, ${n(2)}, ${n(4)}, ${a})`;
}

// ---- editing -----------------------------------------------------------------

/** The Prototype tab's actions. */
export type ActionKind = 'navigate' | 'overlay' | 'back';

/** The editable action of an interaction (its first), as the tab shows it. */
export function actionKind(
  a: PrototypeAction | undefined
): ActionKind | undefined {
  if (!a) return undefined;
  if (a.connection === 'BACK') return 'back';
  if (a.connection === 'INTERNAL_NODE' && a.navigation === 'OVERLAY')
    return 'overlay';
  if (a.connection === 'INTERNAL_NODE' && a.navigation === 'NAVIGATE')
    return 'navigate';
  return undefined;
}

/** The transitions the tab offers, by Figma's names. */
export const TRANSITIONS: { value: string; label: string }[] = [
  { value: 'INSTANT_TRANSITION', label: 'Instant' },
  { value: 'DISSOLVE', label: 'Dissolve' },
  { value: 'SMART_ANIMATE', label: 'Smart animate' },
  { value: 'MOVE_FROM_RIGHT', label: 'Move in' },
  { value: 'MOVE_OUT_TO_LEFT', label: 'Move out' },
  { value: 'PUSH_FROM_RIGHT', label: 'Push' },
  { value: 'SLIDE_FROM_RIGHT', label: 'Slide in' },
  { value: 'SLIDE_OUT_TO_LEFT', label: 'Slide out' },
];

/** The engine's `InteractionSpec` for one click interaction. */
export interface InteractionSpec {
  id?: string;
  trigger?: string;
  actions: {
    connection?: string;
    navigation?: string;
    destination?: string;
    transition?: string;
    duration?: number;
    url?: string;
  }[];
}

/** A click interaction as the tab edits it. */
export interface ClickInteraction {
  id?: string;
  kind: ActionKind;
  destination?: string;
  transition: string;
  /** Seconds. */
  duration: number;
}

export function clickSpec(c: ClickInteraction): InteractionSpec {
  const action =
    c.kind === 'back'
      ? { connection: 'BACK', transition: c.transition, duration: c.duration }
      : {
          connection: 'INTERNAL_NODE',
          navigation: c.kind === 'overlay' ? 'OVERLAY' : 'NAVIGATE',
          destination: c.destination,
          transition: c.transition,
          duration: c.duration,
        };
  return { id: c.id, trigger: 'ON_CLICK', actions: [action] };
}

/**
 * The specs that keep a layer's other interactions as they are and put
 * `edited` in place of the interaction at `index` (appended when absent;
 * `null` removes it).
 */
export function replaceInteraction(
  existing: PrototypeInteraction[],
  index: number,
  edited: ClickInteraction | null
): InteractionSpec[] {
  const next = existing.map(specOf);
  const replacing = index < existing.length;
  const at = replacing ? index : next.length;
  if (edited) {
    const spec = clickSpec(edited);
    // An edit keeps the interaction's id (and so what the tab does not show).
    if (replacing) spec.id = existing[index].id ?? undefined;
    next.splice(at, replacing ? 1 : 0, spec);
  } else if (replacing) next.splice(at, 1);
  return next;
}

/**
 * An interaction left as it is: by id (the engine keeps the rest), or, for
 * a connection from a file's legacy fields (no id), spelled out.
 */
function specOf(i: PrototypeInteraction): InteractionSpec {
  if (i.id) return { id: i.id, actions: i.actions.map(() => ({})) };
  return {
    trigger: i.trigger,
    actions: i.actions.map((a) => ({
      connection: a.connection,
      navigation: a.navigation,
      destination: a.destination ?? undefined,
      transition: a.transition,
      duration: a.duration,
      ...(a.url ? { url: a.url } : {}),
    })),
  };
}
