import type { ResultError } from '@core/util/result';
import { type BaseFetchErrorCode, statusError } from '@core/util/safeFetch';
import { z } from 'zod';
import type { BoundHarnessAgent } from './generated/schemas/boundHarnessAgent';

const boundHarnessAgents = z.array(
  z.object({
    bot_id: z.string(),
    name: z.string(),
    handle: z.string(),
    owner: z.discriminatedUnion('type', [
      z.object({ type: z.literal('user'), user_id: z.string() }),
      z.object({ type: z.literal('team'), team_id: z.string() }),
    ]),
  })
) satisfies z.ZodType<BoundHarnessAgent[]>;

/** `HarnessOwnerConflict`, DSS's 409 body for a refused owner change. */
const harnessOwnerConflict = z.object({
  message: z.string(),
  blocking_agents: boundHarnessAgents,
});

const withBlockingAgents = z.object({ blockingAgents: boundHarnessAgents });

/** Keeps a refused owner change's blocking agents; other failures keep the status error. */
export async function harnessPatchErrorResponse(
  response: Response
): Promise<
  ResultError<BaseFetchErrorCode> & { blockingAgents?: BoundHarnessAgent[] }
> {
  if (response.status !== 409) return statusError(response.status);

  try {
    const body = harnessOwnerConflict.safeParse(await response.json());
    if (body.success) {
      return {
        ...statusError(response.status),
        message: body.data.message,
        blockingAgents: body.data.blocking_agents,
      };
    }
  } catch {
    // Not a harness conflict body, such as a gateway error page.
  }
  return statusError(response.status);
}

/** The agents that blocked an owner change, from a `harnessPatchErrorResponse` error. */
export function blockingAgentsOf(error: ResultError): BoundHarnessAgent[] {
  const parsed = withBlockingAgents.safeParse(error);
  return parsed.success ? parsed.data.blockingAgents : [];
}
