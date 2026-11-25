/**
 * The harness's CAPTCHA route (`POST /brain/captcha/solve`), reached
 * through the agent's relay, which swaps the relay's capability for the
 * agent's key. The CapSolver key never leaves the harness; this side sends
 * only the challenge's parameters and the page's origin and path.
 */
import { z } from 'zod';
import type { Challenge } from './detect.ts';

/** The relay's path to the route. */
export const solveRoute = 'brain/captcha/solve';
/** The relay's path to the route that starts a solver run. */
export const runsRoute = 'brain/captcha/runs';
/**
 * The header every model call and solve of a run carries: the harness
 * accepts them only for a live run of the calling agent.
 */
export const runHeader = 'x-macro-solver-run';

const vendorErrorKinds = [
  'rateLimited',
  'outOfBalance',
  'unavailable',
  'keyBlocked',
  'invalidTask',
  'unsupported',
] as const;

const solveResult = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('solved'),
    token: z.string().min(1),
    userAgent: z.string().nullable(),
    taskId: z.string(),
  }),
  z.object({ outcome: z.literal('unsolvable') }),
  z.object({ outcome: z.literal('timeout') }),
  z.object({
    outcome: z.literal('budgetExceeded'),
    limit: z.enum(['concurrent', 'hourly', 'daily']),
  }),
  z.object({
    outcome: z.literal('vendorError'),
    kind: z.enum(vendorErrorKinds),
  }),
  z.object({ outcome: z.literal('notConfigured') }),
]);

/** What the harness decided about one solve. */
export type SolveResult = z.infer<typeof solveResult>;

/** A refusal before anything reached CapSolver: the relay or the harness said no. */
export type Refused = {
  readonly outcome: 'refused';
  /** HTTP status: 401/403 not allowed, 409 solve id taken, 5xx unreachable or held. */
  readonly status: number;
};

const runResult = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('started'),
    runId: z.string().uuid(),
    expiresAt: z.string(),
    modelCalls: z.number().int(),
    solves: z.number().int(),
  }),
  z.object({
    outcome: z.literal('budgetExceeded'),
    limit: z.enum(['concurrent', 'hourly', 'daily']),
  }),
  z.object({ outcome: z.literal('notConfigured') }),
]);

/** What the harness decided about starting a run: its id and allowance, or why not. */
export type RunResult = z.infer<typeof runResult>;

type Relay = {
  readonly relay: { readonly url: string; readonly token: string };
  readonly fetch: (request: Request) => Promise<Response>;
};

/** POSTs `body` to a relay route and parses the answer with `schema`; a refusal is a value, never a throw. */
const post = async <Value>(
  { relay, fetch: send }: Relay,
  route: string,
  headers: Readonly<Record<string, string>>,
  body: unknown,
  schema: z.ZodType<Value>
): Promise<Value | Refused> => {
  let response: Response;
  try {
    response = await send(
      new Request(`${relay.url.replace(/\/+$/, '')}/${route}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${relay.token}`,
          'content-type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
      })
    );
  } catch {
    // The relay or the harness unreachable.
    return { outcome: 'refused', status: 502 };
  }
  if (!response.ok) return { outcome: 'refused', status: response.status };
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { outcome: 'refused', status: 502 };
  }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : { outcome: 'refused', status: 502 };
};

const runEnded = z.object({ outcome: z.literal('ended') });

/**
 * Ends the run, so the agent may start the next one at once (the harness
 * also ends it after its last solve; expiry is the backstop).
 */
export const endRun = (
  relay: Relay,
  runId: string
): Promise<z.infer<typeof runEnded> | Refused> =>
  post(relay, `${runsRoute}/${runId}/end`, {}, {}, runEnded);

/** Starts a solver run for the calling agent: one at a time, with a fixed allowance of model calls and solves. */
export const startRun = (relay: Relay): Promise<RunResult | Refused> =>
  post(relay, runsRoute, {}, {}, runResult);

export type SolveRequest = {
  /** The span the solve runs in, so the harness's span joins the trace. */
  readonly traceparent?: string;
  /** The live run this solve belongs to. */
  readonly runId: string;
  readonly solveId: string;
  readonly pageUrl: string;
  readonly challenge: Challenge;
};

/** The request body the route takes. */
export const solveBody = ({ solveId, pageUrl, challenge }: SolveRequest) => ({
  solveId,
  challenge: { ...challenge, pageUrl },
});

/** Asks the harness to solve one challenge. A refusal is a value, never a throw. */
export const requestSolve = (
  relay: Relay,
  request: SolveRequest
): Promise<SolveResult | Refused> =>
  post(
    relay,
    solveRoute,
    {
      [runHeader]: request.runId,
      ...(request.traceparent === undefined
        ? {}
        : { traceparent: request.traceparent }),
    },
    solveBody(request),
    solveResult
  );
