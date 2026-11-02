import { NOOP_SPAN, type Span } from '@macro-inc/observability';
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
import {
  startUiOperation,
  type UiOperation,
  type UiOperationOptions,
} from './ui-operation';

type Attributes = Record<string, string | number | boolean>;
type Outcome = 'success' | 'cancelled';

/**
 * One span in a loading flow. It stays open while anything under it holds it
 * and settles the first time the holds reach zero.
 */
interface FlowNode {
  readonly span: Span;
  readonly settled: boolean;
  /** Keep the node open until the returned release runs. Idempotent. */
  hold(): () => void;
  /** Settle now as cancelled, for a view that unmounted while loading. */
  abandon(): void;
}

function createNode(
  span: Span,
  finish: (outcome: Outcome) => void,
  expired: () => boolean = () => false
): FlowNode {
  let count = 0;
  let settled = false;
  return {
    span,
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
function rootNode(operation: UiOperation): FlowNode {
  return createNode(
    operation.span,
    (outcome) => {
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
  attributes?: Attributes
): FlowNode {
  const release = parent.hold();
  const span = parent.span.span(name);
  for (const [key, value] of Object.entries(attributes ?? {}))
    span.setAttr(key, value);
  return createNode(span, (outcome) => {
    span.setAttr('flow.outcome', outcome);
    span.end();
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
  close(): void;
}

let openInteraction: OpenInteraction | undefined;

function activeInteraction(): OpenInteraction | undefined {
  if (openInteraction && !openInteraction.node.settled) return openInteraction;
}

export interface Interaction {
  readonly span: Span;
  /** Close the window in which new views join this interaction. */
  end(): void;
}

export type InteractionOptions = UiOperationOptions & {
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
  const node = enclosing
    ? joinInteraction(enclosing, name, options.attributes)
    : rootNode(startUiOperation(name, options));
  const release = node.hold();
  let closed = false;
  const interaction: OpenInteraction = {
    node,
    closeOnJoin: options.closeOnJoin ?? false,
    close() {
      if (closed) return;
      closed = true;
      if (openInteraction === interaction) openInteraction = enclosing;
      release();
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
  const node = childNode(interaction.node, name, attributes);
  if (interaction.closeOnJoin) interaction.close();
  return node;
}

/** Joins the nearest open flow, else an open interaction, else starts one. */
function openNode(
  parent: FlowScope | undefined,
  name: string,
  attributes: Attributes | undefined
): FlowNode {
  if (parent && !parent.node.settled)
    return childNode(parent.node, name, attributes);
  const interaction = activeInteraction();
  if (interaction) return joinInteraction(interaction, name, attributes);
  return rootNode(startUiOperation(name, { attributes }));
}

/**
 * Times a view from mount until everything under it has loaded and painted.
 *
 * The flow stays open while any nested `<TraceFlow>`, `usePending`, or
 * `useFlow().task` holds it. Nested flows
 * become child phases. A flow with no open parent joins the interaction that
 * opened it (see {@link beginInteraction}) or starts its own perf trace.
 * When `key` changes, such as a view showing a different entity in place, the
 * flow starts again. Unmounting before it settles records it as cancelled.
 *
 * Names and attributes are static categories, ids, and counts; never user
 * content.
 */
export function TraceFlow(props: {
  name: string;
  attributes?: Attributes;
  key?: Accessor<unknown>;
  children: JSX.Element;
}): JSX.Element {
  const parent = useContext(FlowContext);
  const start = () =>
    openNode(
      parent,
      untrack(() => props.name),
      untrack(() => props.attributes)
    );
  const [current, setCurrent] = createSignal(start());
  const scope: FlowScope = {
    get node() {
      return untrack(current);
    },
    current,
  };
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
    phase = childNode(scope.node, name, attributes);
    release = phase.hold();
  };
  const finish = () => {
    release?.();
    phase = undefined;
    release = undefined;
  };
  if (untrack(pending)) begin();
  else if (!scope.node.settled)
    scope.node.span.event(`${name}.ready`, attributes);
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
}

const NO_FLOW: Flow = {
  span: NOOP_SPAN,
  task: (_name, operation) => operation(NOOP_SPAN),
};

/** The enclosing flow, for imperative phases and attributes. */
export function useFlow(): Flow {
  const scope = useContext(FlowContext);
  if (!scope) return NO_FLOW;
  return {
    get span() {
      return scope.node.span;
    },
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
