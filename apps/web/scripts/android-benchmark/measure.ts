import type { CapturedSpan } from './otlp';
import type { PageRequest, Session } from './session';
import type { TargetChoice } from './targets';

export type Variant = 'cold' | 'warm';

/** One timed action. Times are milliseconds. */
export type Sample = {
  scenario: string;
  variant: Variant;
  iteration: number;
  /** From the touch (or the launch) to the view's paint opportunity. */
  readyMs: number;
  /** The root span's own `ui.elapsed_ms`, which the field data reports. */
  spanMs: number | undefined;
  /** From the touch to the paint of the content the step also waits for. */
  contentMs?: number;
  /** The targets-file item the step opened, by position, never by name. */
  target?: TargetChoice;
  root: string;
  routeId: string | undefined;
  traceIds: string[];
  phases: { count: number; ready: number } | undefined;
  /** Phases that were already loaded when the flow reached them. */
  warmPhases: string[];
  coldPhases: string[];
  requests: {
    /** HTTP client spans in the flow's traces. */
    http: number;
    /** GraphQL transport spans in the flow's traces. */
    graphql: number;
    /** Native GraphQL cache IPC requests in the flow's traces. */
    cacheIpc: number;
    /** Network requests the WebView made itself (analytics excluded). */
    webview: number;
  };
  /** Soup reads answered from the local cache vs. the network. */
  soup: { local: number; network: number };
  longAnimationFrameBlockingMs: number | undefined;
  /** The WebView's CPU throttle rate while the step ran (1: none). */
  cpuThrottle: number;
  /** The slowdown measured just before and just after the step. */
  cpuThrottleMeasured?: [number, number];
  /** Host one-minute load average when the step ran (emulators share it). */
  hostLoad?: number;
  /** The flow's spans, from the touch: for finding where the time went. */
  spans: {
    name: string;
    startMs: number;
    durationMs: number;
    /** HTTP and GraphQL client spans: headers to the body's first read. */
    bodyMs?: number;
  }[];
};

/** Frequent, tiny spans that the counts above already cover. */
const UNLISTED_SPANS = new Set(['urql.reconcile', 'graphql_cache.ipc.request']);

/** What finishes an action: the root span, and spans that must also end. */
export type Readiness = {
  root: (span: CapturedSpan) => boolean;
  /** Later roots (such as `doc.editor`) the content waits for. */
  also?: ((span: CapturedSpan) => boolean)[];
  /**
   * A selector for content that must also be painted, for a view that
   * reports ready before its content arrives.
   */
  visible?: string;
};

const IGNORED_REQUESTS = [
  /^https:\/\/tauri\.localhost\/app\//,
  /__benchmark\/otlp/,
  /\/i\/ph\//,
  /google|doubleclick/,
];

// A client span ends at the response headers; its body time is an attribute.
function roundedBodyMs(span: CapturedSpan) {
  const bodyMs =
    numberAttribute(span, 'http.body_ms') ??
    numberAttribute(span, 'graphql.body_ms');
  return bodyMs === undefined ? undefined : Math.round(bodyMs);
}

function numberAttribute(span: CapturedSpan, key: string) {
  const value = span.attributes[key];
  return typeof value === 'number' ? value : undefined;
}

function count(spans: CapturedSpan[], match: (name: string) => boolean) {
  return spans.filter((span) => match(span.name)).length;
}

function countRequests(requests: PageRequest[], from: number, to: number) {
  const window = requests.filter((request) => request.time >= from && request.time <= to);
  return {
    webview: window.filter(
      (request) =>
        !request.url.includes('ipc.localhost') &&
        !IGNORED_REQUESTS.some((pattern) => pattern.test(request.url))
    ).length,
  };
}

/** Builds a sample from the spans of an action that began at `start`. */
export function sampleFrom(
  session: Session,
  scenario: string,
  variant: Variant,
  iteration: number,
  start: number,
  root: CapturedSpan,
  extra: CapturedSpan[],
  /** When the content `Readiness.visible` names was painted. */
  contentPainted?: number
): Sample {
  const ready = Math.max(
    root.end,
    ...extra.map((span) => span.end),
    contentPainted ?? Number.NEGATIVE_INFINITY
  );
  const traceIds = [...new Set([root, ...extra].map((span) => span.traceId))];
  const spans = traceIds.flatMap((traceId) => session.trace(traceId));
  const flowRoots = [root, ...extra];
  const waited = flowRoots.flatMap((span) =>
    Object.entries(span.attributes).filter(([key]) => key.endsWith('.waited'))
  );
  return {
    scenario,
    variant,
    iteration,
    readyMs: ready - start,
    cpuThrottle: session.cpuThrottle,
    spanMs: numberAttribute(root, 'ui.elapsed_ms'),
    contentMs:
      contentPainted === undefined ? undefined : contentPainted - start,
    root: root.name,
    routeId:
      typeof root.attributes['route.id'] === 'string'
        ? root.attributes['route.id']
        : undefined,
    traceIds,
    phases:
      numberAttribute(root, 'flow.phase_count') === undefined
        ? undefined
        : {
            count: numberAttribute(root, 'flow.phase_count') ?? 0,
            ready: numberAttribute(root, 'flow.ready_phase_count') ?? 0,
          },
    warmPhases: waited
      .filter(([, value]) => value === false)
      .map(([key]) => key.replace(/\.waited$/, '')),
    coldPhases: waited
      .filter(([, value]) => value === true)
      .map(([key]) => key.replace(/\.waited$/, '')),
    requests: {
      http: count(spans, (name) => name.startsWith('http ')),
      graphql: count(spans, (name) => name === 'graphql.transport'),
      cacheIpc: count(spans, (name) => name === 'graphql_cache.ipc.request'),
      ...countRequests(session.requests, start, ready),
    },
    soup: {
      local: count(spans, (name) => name === 'soup.local'),
      network: count(spans, (name) => name === 'soup.network'),
    },
    longAnimationFrameBlockingMs: numberAttribute(
      root,
      'ui.long_animation_frame_blocking_ms'
    ),
    spans: spans
      .filter((span) => !UNLISTED_SPANS.has(span.name))
      .sort((a, b) => a.start - b.start)
      .map((span) => ({
        name: span.name,
        startMs: Math.round(span.start - start),
        durationMs: Math.round(span.end - span.start),
        bodyMs: roundedBodyMs(span),
      })),
  };
}
