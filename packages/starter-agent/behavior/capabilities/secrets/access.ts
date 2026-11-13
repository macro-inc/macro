/**
 * Access requests the agent is waiting on. The vault's event that one was
 * decided is only a hint, so the agent learns by asking: on each wake, and
 * on a schedule while any is pending. What it asks for is kept in the run
 * bucket; deciding what the answers mean is pure.
 */
import { z } from 'zod';
import type { Base } from '../../context/index.ts';
import { logStream, owner, pendingFile } from './config.ts';
import type { SecretsPorts } from './ports.ts';
import type { Answer } from './vault.ts';
import type { AccessRequestState } from './wire.ts';

const Pending = z.array(
  z.object({
    teamId: z.string(),
    itemId: z.string(),
    name: z.string(),
    revision: z.number().int(),
  })
);
export type Pending = z.infer<typeof Pending>[number];

export type Outcome = 'usable' | 'denied' | 'revoked' | 'closed' | 'gone';
export type Resolved = { readonly pending: Pending; readonly outcome: Outcome };

type Files = Pick<Base, 'disk' | 'join' | 'state'>;

const file = ({ join, state }: Pick<Base, 'join' | 'state'>): string =>
  join(state.run(owner), pendingFile);

export const readPending = async (context: Files): Promise<Pending[]> => {
  const text = await context.disk.read(file(context));
  if (text === undefined) return [];
  const parsed = (() => {
    try {
      return Pending.safeParse(JSON.parse(text));
    } catch {
      return undefined;
    }
  })();
  return parsed?.success === true ? parsed.data : [];
};

export const writePending = (
  context: Files,
  pending: readonly Pending[]
): Promise<void> =>
  context.disk.write(file(context), `${JSON.stringify(pending, null, 2)}\n`);

/** Records a request, replacing any earlier one for the same item. */
export const addPending = async (
  context: Files,
  request: Pending
): Promise<void> =>
  writePending(context, [
    ...(await readPending(context)).filter(
      ({ itemId }) => itemId !== request.itemId
    ),
    request,
  ]);

/**
 * What the vault's answers mean for the requests waiting on them. A request
 * the vault couldn't be asked about, or answered about with an older revision
 * than the agent has seen, keeps waiting.
 */
export const settle = (
  pending: readonly Pending[],
  answers: ReadonlyMap<string, Answer<AccessRequestState>>
): { readonly waiting: Pending[]; readonly resolved: Resolved[] } => {
  const waiting: Pending[] = [];
  const resolved: Resolved[] = [];
  for (const request of pending) {
    const answer = answers.get(request.itemId);
    if (answer === undefined) {
      waiting.push(request);
      continue;
    }
    if (answer.kind === 'refused') {
      if (answer.code === 'not_found')
        resolved.push({ pending: request, outcome: 'gone' });
      else waiting.push(request);
      continue;
    }
    const state = answer.value;
    if (state.revision < request.revision) {
      waiting.push(request);
      continue;
    }
    const outcome: Outcome | undefined =
      state.access.status === 'usable'
        ? 'usable'
        : state.status === 'pending'
          ? undefined
          : state.status === 'denied' || state.status === 'revoked'
            ? state.status
            : 'closed';
    if (outcome === undefined)
      waiting.push({ ...request, revision: state.revision });
    else resolved.push({ pending: request, outcome });
  }
  return { waiting, resolved };
};

const outcomeText: Record<Outcome, string> = {
  usable: 'approved: usable now',
  denied: 'denied',
  revoked: 'approved, then revoked',
  closed: 'no longer pending, and not usable',
  gone: 'no longer in the vault',
};

const lines = (resolved: readonly Resolved[]): string =>
  resolved
    .map(
      ({ pending, outcome }) => `- "${pending.name}": ${outcomeText[outcome]}`
    )
    .join('\n');

/** The request a decision wakes the agent with. */
export const decidedWake = (resolved: readonly Resolved[]): string =>
  [
    'Your owner decided on secrets you asked for:',
    lines(resolved),
    'Pick up whatever you needed them for, and tell whoever was waiting on it.',
  ].join('\n\n');

/** What a wake is told about decisions it came across. */
export const decidedNote = (resolved: readonly Resolved[]): string =>
  `## Secrets you asked for\n\n${lines(resolved)}`;

/**
 * Asks the vault about every pending request, keeps the ones still waiting,
 * and polls while there are any. Returns the ones that were decided.
 */
export const checkAccessRequests = async (
  context: Files & Pick<Base, 'log'> & { readonly secrets: SecretsPorts }
): Promise<Resolved[]> => {
  const { vault, polling } = context.secrets;
  const pending = await readPending(context);
  if (pending.length === 0) {
    await polling.stop();
    return [];
  }
  const answers = new Map(
    await Promise.all(
      pending.map(
        async ({ teamId, itemId }) =>
          [itemId, await vault.mine(teamId, itemId)] as const
      )
    )
  );
  const { waiting, resolved } = settle(pending, answers);
  await writePending(context, waiting);
  await (waiting.length === 0 ? polling.stop() : polling.ensure());
  for (const { pending: request, outcome } of resolved)
    await context.log.event(logStream, {
      op: 'access',
      item: request.itemId,
      wake: answers.get(request.itemId)?.wake,
      outcome,
    });
  return resolved;
};
