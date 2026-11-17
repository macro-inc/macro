import type { CapturedSpan } from './otlp';
import type { PageRequest, Session } from './session';

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
    /** Native HTTP requests made over Tauri IPC while it ran. */
    nativeHttp: number;
    /** Network requests the WebView made itself (analytics excluded). */
    webview: number;
  };
  /** Soup reads answered from the local cache vs. the network. */
  soup: { local: number; network: number };
  longAnimationFrameBlockingMs: number | undefined;
};

/** What finishes an action: the root span, and spans that must also end. */
export type Readiness = {
  root: (span: CapturedSpan) => boolean;
  /** Later roots (such as `doc.editor`) the content waits for. */
  also?: ((span: CapturedSpan) => boolean)[];
};

const IGNORED_REQUESTS = [
  /^https:\/\/tauri\.localhost\/app\//,
  /__benchmark\/otlp/,
  /\/i\/ph\//,
  /google|doubleclick/,
];

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
    nativeHttp: window.filter((request) => request.nativeUrl).length,
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
  extra: CapturedSpan[]
): Sample {
  const ready = Math.max(root.end, ...extra.map((span) => span.end));
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
    spanMs: numberAttribute(root, 'ui.elapsed_ms'),
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
  };
}
