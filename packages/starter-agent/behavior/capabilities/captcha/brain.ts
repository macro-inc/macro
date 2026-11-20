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

export type SolveRequest = {
  /** The span the solve runs in, so the harness's span joins the trace. */
  readonly traceparent?: string;
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
export const requestSolve = async (
  {
    relay,
    fetch: send,
  }: {
    readonly relay: { readonly url: string; readonly token: string };
    readonly fetch: (request: Request) => Promise<Response>;
  },
  request: SolveRequest
): Promise<SolveResult | Refused> => {
  let response: Response;
  try {
    response = await send(
    new Request(`${relay.url.replace(/\/+$/, '')}/${solveRoute}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${relay.token}`,
        'content-type': 'application/json',
        ...(request.traceparent === undefined
          ? {}
          : { traceparent: request.traceparent }),
      },
      body: JSON.stringify(solveBody(request)),
    })
  );
  } catch {
    // The relay or the harness unreachable.
    return { outcome: 'refused', status: 502 };
  }
  if (!response.ok) return { outcome: 'refused', status: response.status };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { outcome: 'refused', status: 502 };
  }
  const parsed = solveResult.safeParse(body);
  if (!parsed.success) return { outcome: 'refused', status: 502 };
  return parsed.data;
};
