import {
  NOOP_SPAN,
  type Span,
  type TraceContext,
} from '@macro-inc/observability';
import {
  type Accessor,
  createContext,
  createEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
  untrack,
  useContext,
} from 'solid-js';
import type { SamplingClass } from './sampling';
import {
  currentRoute,
  type FlowKind,
  setActiveRoute,
  startUiOperation,
  type UiOperationOptions,
} from './ui-operation';

type Attributes = Record<string, string | number | boolean>;
type Outcome = 'success' | 'cancelled';

/**
 * What every node of one perf trace shares: the root's name, stamped on each
 * phase so Datadog can aggregate phases per root without trace queries, and
 * how many phases it opened versus found already loaded.
 */
interface FlowRoot {
  readonly span: Span;
  readonly name: string;
  phaseCount: number;
  readyPhases: number;
}

const ROUTE_ID = 'route.id';

/**
 * One span in a loading flow. It stays open while anything under it holds it
 * and settles the first time the holds reach zero.
 */
interface FlowNode {
  readonly span: Span;
  readonly root: FlowRoot;
  /** The route of the nearest view at or above this node. */
  readonly route: string | undefined;
  readonly settled: boolean;
  /** Keep the node open until the returned release runs. Idempotent. */
  hold(): () => void;
  /** Settle now as cancelled, for a view that unmounted while loading. */
  abandon(): void;
}

function createNode(
  span: Span,
  root: FlowRoot,
  route: string | undefined,
  finish: (outcome: Outcome) => void,
  expired: () => boolean = () => false
): FlowNode {
  let count = 0;
  let settled = false;
  return {
    span,
    root,
    route,
    get settled() {
      return settled || expired();
    },
    hold() {
      if (settled) return () => {};
      count++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        count--;
        if (count === 0 && !settled) {
          settled = true;
          finish('success');
        }
      };
    },
    abandon() {
      if (settled) return;
      settled = true;
      finish('cancelled');
    },
  };
}

/** A root node finishes its UI operation one paint after it settles. */
function rootNode(
  name: string,
  kind: FlowKind,
  options: UiOperationOptions = {}
): FlowNode {
  const operation = startUiOperation(name, { ...options, kind });
  const own = options.attributes?.[ROUTE_ID];
  if (typeof own === 'string') setActiveRoute(own);
  // Mirrors startUiOperation: a navigation's route comes from its views.
  const route =
    typeof own === 'string'
      ? own
      : kind === 'boot' || kind === 'navigation'
        ? undefined
        : currentRoute();
  const root: FlowRoot = {
    span: operation.span,
    name,
    phaseCount: 0,
    readyPhases: 0,
  };
  return createNode(
    operation.span,
    root,
    route,
    (outcome) => {
      operation.span.setAttr('flow.phase_count', root.phaseCount);
      operation.span.setAttr('flow.ready_phase_count', root.readyPhases);
      if (outcome === 'success') operation.afterPaint();
      else operation.cancel();
    },
    // A timed-out or hidden operation takes no more phases.
    () => operation.ended
  );
}

function childNode(
  parent: FlowNode,
  name: string,
  attributes?: Attributes,
  onSettle?: (outcome: Outcome) => void
): FlowNode {
  const release = parent.hold();
  const span = parent.span.span(name);
  const root = parent.root;
  const own = attributes?.[ROUTE_ID];
  if (typeof own === 'string') {
    setActiveRoute(own);
    // The root is about the most specific view it opened: the last to join,
    // which for nested routes is the innermost.
    root.span.setAttr(ROUTE_ID, own);
  }
  const route = typeof own === 'string' ? own : parent.route;
  span.setAttr('flow.root', root.name);
  if (route !== undefined) span.setAttr(ROUTE_ID, route);
  for (const [key, value] of Object.entries(attributes ?? {}))
    span.setAttr(key, value);
  root.phaseCount++;
  return createNode(span, root, route, (outcome) => {
    span.setAttr('flow.outcome', outcome);
    span.end();
    onSettle?.(outcome);
    // Solid disposes children before parents: when the parent is unmounting
    // too, it must abandon before this release can settle it as a success.
    if (outcome === 'cancelled') queueMicrotask(release);
    else release();
  });
}

/** The nearest flow; a keyed flow replaces its node when the key changes. */
interface FlowScope {
  /** The current node, read without tracking. */
  readonly node: FlowNode;
  /** The current node, tracked, for phases that move to a restarted flow. */
  current: Accessor<FlowNode>;
}

const FlowContext = createContext<FlowScope>();

interface OpenInteraction {
  readonly node: FlowNode;
  readonly closeOnJoin: boolean;
  /** The interaction that was open when this one began. */
  readonly enclosing: OpenInteraction | undefined;
  readonly closed: boolean;
  close(): void;
  /** Open the window again, while the interaction itself is still open. */
  reopen(): void;
}

let openInteraction: OpenInteraction | undefined;

function activeInteraction(): OpenInteraction | undefined {
  let open = openInteraction;
  while (open && (open.closed || open.node.settled)) open = open.enclosing;
  return open;
}

export interface Interaction {
  readonly span: Span;
  /** Close the window in which new views join this interaction. */
  end(): void;
}

export type InteractionOptions = Omit<UiOperationOptions, 'kind'> & {
  /** `boot` or `navigation` for the app's own roots; defaults to `interaction`. */
  kind?: Extract<FlowKind, 'boot' | 'navigation' | 'interaction'>;
  /** Close the window as soon as one flow joins, such as the first view. */
  closeOnJoin?: boolean;
};

/**
 * Start a user interaction, such as a click or a navigation. Every
 * `<TraceFlow>` created before `end()` that has no open parent joins it, so
 * one trace runs from the input event until the views it opened have loaded
 * and painted. Without such a view it ends one paint after `end()`. An
 * interaction begun while another is open is a phase of that one.
 */
export function beginInteraction(
  name: string,
  options: InteractionOptions = {}
): Interaction {
  const enclosing = activeInteraction();
  // A nested interaction is not the view a closeOnJoin interaction waits for:
  // the router's first navigation must leave app.boot open for its view.
  const node = enclosing
    ? childNode(enclosing.node, name, options.attributes)
    : rootNode(name, options.kind ?? 'interaction', options);
  let release = node.hold();
  let closed = false;
  const interaction: OpenInteraction = {
    node,
    closeOnJoin: options.closeOnJoin ?? false,
    enclosing,
    get closed() {
      return closed;
    },
    close() {
      if (closed) return;
      closed = true;
      if (openInteraction === interaction) openInteraction = enclosing;
      release();
    },
    reopen() {
      if (!closed || node.settled) return;
      closed = false;
      release = node.hold();
      if (!activeInteraction()) openInteraction = interaction;
    },
  };
  openInteraction = interaction;
  return { span: node.span, end: interaction.close };
}

function joinInteraction(
  interaction: OpenInteraction,
  name: string,
  attributes: Attributes | undefined
): FlowNode {
  const waiting: OpenInteraction[] = [];
  for (
    let open: OpenInteraction | undefined = interaction;
    open;
    open = open.enclosing
  )
    if (open.closeOnJoin && !open.closed) waiting.push(open);
  const node = childNode(interaction.node, name, attributes, (outcome) => {
    // A view that unmounted before loading (a redirect) is not the view they
    // waited for: the next view joins instead.
    if (outcome === 'cancelled') for (const open of waiting) open.reopen();
  });
  // The first view closes every interaction waiting for one, at any depth.
  for (const open of waiting) open.close();
  return node;
}

/** Joins the nearest open flow, else an open interaction, else starts one. */
function openNode(
  parent: FlowScope | undefined,
  name: string,
  attributes: Attributes | undefined,
  sampling: SamplingClass | undefined
): FlowNode {
  if (parent && !parent.node.settled)
    return childNode(parent.node, name, attributes);
  const interaction = activeInteraction();
  if (interaction) return joinInteraction(interaction, name, attributes);
  return rootNode(name, 'view', { attributes, sampling });
}

/**
 * Times a view from mount until everything under it has loaded and painted.
 *
 * The flow stays open while any nested `<TraceFlow>`, `usePending`, or
 * `useFlow().task` holds it. Nested flows
 * become child phases. A flow with no open parent joins the interaction that
 * opened it (see {@link beginInteraction}) or starts its own trace, of class
 * `sampling` (`perf` by default).
 * When `key` changes, such as a view showing a different entity in place, the
 * flow starts again. Unmounting before it settles records it as cancelled.
 *
 * Names and attributes are static categories, ids, and counts; never user
 * content.
 */
/**
 * The scope a flow hands its subtree. Built outside the component so its
 * getter closes over the node alone: requests carry the scope in their
 * context and can outlive the view (a cached query another view still
 * reads), and a closure sharing the component's scope would keep its props,
 * and with them the view's whole tree, alive.
 */
function flowScope(current: Accessor<FlowNode>): FlowScope {
  return {
    get node() {
      return untrack(current);
    },
    current,
  };
}

export function TraceFlow(props: {
  name: string;
  attributes?: Attributes;
  key?: Accessor<unknown>;
  /** The sampling class of the trace it starts as a root. Defaults to `perf`. */
  sampling?: SamplingClass;
  children: JSX.Element;
}): JSX.Element {
  const parent = useContext(FlowContext);
  const start = () =>
    openNode(
      parent,
      untrack(() => props.name),
      untrack(() => props.attributes),
      untrack(() => props.sampling)
    );
  const [current, setCurrent] = createSignal(start());
  const scope = flowScope(current);
  const releaseMount = scope.node.hold();
  // Effects of this subtree run in the same flush; let them hold first.
  onMount(() => queueMicrotask(releaseMount));
  const key = props.key;
  if (key)
    createEffect(
      on(
        key,
        () => {
          scope.node.abandon();
          const next = start();
          setCurrent(next);
          // Loads the new key starts in this flush hold the node first.
          queueMicrotask(next.hold());
        },
        { defer: true }
      )
    );
  onCleanup(() => scope.node.abandon());
  return (
    <FlowContext.Provider value={scope}>{props.children}</FlowContext.Provider>
  );
}

/**
 * Times a loading phase of the enclosing flow: a child span runs while
 * `pending()` is true and holds the flow open, each time it starts loading
 * while the flow is open, and moves to a keyed flow that restarts mid-load. If it is already loaded when the flow reaches it (a
 * cache hit) the flow records a `<name>.ready` event instead.
 */
export function usePending(
  name: string,
  pending: Accessor<boolean>,
  attributes?: Attributes
): void {
  const scope = useContext(FlowContext);
  if (!scope) return;
  let phase: FlowNode | undefined;
  let release: (() => void) | undefined;
  let attached = scope.node;
  const begin = () => {
    if (phase || scope.node.settled) return;
    scope.node.span.setAttr(`${name}.waited`, true);
    phase = childNode(scope.node, name, attributes);
    release = phase.hold();
  };
  const finish = () => {
    release?.();
    phase = undefined;
    release = undefined;
  };
  if (untrack(pending)) begin();
  else if (!scope.node.settled) {
    // Already loaded when the flow reached it: usually a cache or a load an
    // earlier view started. `waited` is queryable where the event is not.
    scope.node.span.event(`${name}.ready`, attributes);
    scope.node.span.setAttr(`${name}.waited`, false);
    scope.node.root.readyPhases++;
  }
  createEffect(
    on(
      [pending, scope.current],
      ([isPending, node]) => {
        // A keyed flow restarted while loading: the phase moves to it.
        if (node !== attached) {
          attached = node;
          phase?.abandon();
          phase = undefined;
          release = undefined;
        }
        if (isPending) begin();
        else finish();
      },
      { defer: true }
    )
  );
  onCleanup(() => phase?.abandon());
}

export interface Flow {
  /**
   * The enclosing flow's span, or a no-op span outside one. Use it for work
   * that belongs to the load; a settled flow's span has already ended.
   */
  readonly span: Span;
  /** Run async work as a child phase that holds the flow open until done. */
  task<T>(name: string, operation: (span: Span) => Promise<T>): Promise<T>;
  /**
   * Run work in the flow's trace while it is loading, so requests it starts
   * become the flow's descendants. Once the flow settles, work runs in the
   * caller's context: a background refresh never joins a finished view.
   */
  run<T>(work: () => T): T;
}

const NO_FLOW: Flow = {
  span: NOOP_SPAN,
  task: (_name, operation) => operation(NOOP_SPAN),
  run: (work) => work(),
};

/** The enclosing flow, for imperative phases and attributes. */
export function useFlow(): Flow {
  const scope = useContext(FlowContext);
  if (!scope) return NO_FLOW;
  return {
    get span() {
      return scope.node.span;
    },
    run: (work) => (scope.node.settled ? work() : scope.node.span.run(work)),
    task: async (name, operation) => {
      if (scope.node.settled) return operation(NOOP_SPAN);
      const phase = childNode(scope.node, name);
      const release = phase.hold();
      try {
        return await phase.span.run(() => operation(phase.span));
      } catch (error) {
        phase.span.error(error);
        throw error;
      } finally {
        release();
      }
    },
  };
}

/**
 * The nearest flow as a parent for requests a component starts (see
 * {@link Flow.run}), or undefined outside any flow. Transports that send
 * later, such as urql's exchange chain, carry it to the send.
 */
export function useFlowTrace(): TraceContext | undefined {
  const scope = useContext(FlowContext);
  if (!scope) return;
  const flow = useFlow();
  return { run: flow.run };
}
