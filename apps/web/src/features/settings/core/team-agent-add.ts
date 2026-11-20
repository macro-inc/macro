import { ThrownResultError } from '@core/util/result';
import type { ComputerSize } from '@service-auth/computers';
import type { TeamAgent } from '@service-auth/team-agents';
import { match } from 'ts-pattern';
import { purchaseRefusalOf } from '../computers/core/purchase-refusal';
import { PURCHASE_WAIT_MS } from '../computers/core/purchase-wait';

/** Names offered while the name field is empty. */
export const AGENT_NAME_SUGGESTIONS = ['Ada', 'Bo', 'Kim', 'Nova'] as const;

/**
 * How long Add waits in its dialog. Past it, the dialog closes to the DM and
 * the agent's setup carries on there.
 */
export const ADD_AGENT_WAIT_MS = PURCHASE_WAIT_MS;

/**
 * What ends Add's wait: `online`, the agent reported itself online (its
 * greeting follows in the DM), or `computer_up`, its computer is up and the
 * agent is still starting. A switch for the online-wait experiment: flip to
 * `computer_up` if measurements show waiting for online is too slow.
 */
export type AddAgentWaitsFor = 'online' | 'computer_up';

export const ADD_AGENT_WAITS_FOR: AddAgentWaitsFor = 'online';

/**
 * Where a just-added agent is, for the dialog that waits on it: still
 * coming up, online, its computer failed to start, or gone (taken back with
 * its charge undone).
 */
export type AddedAgentProgress = 'waiting' | 'online' | 'failed' | 'gone';

/**
 * The progress of the agent `userId` names in the team's list. An agent
 * missing from the list, or whose computer was released, was taken back.
 */
export function addedAgentProgress(
  agents: readonly Pick<TeamAgent, 'userId' | 'status'>[],
  userId: string,
  waitsFor: AddAgentWaitsFor = ADD_AGENT_WAITS_FOR
): AddedAgentProgress {
  const agent = agents.find((item) => item.userId === userId);
  if (!agent) return 'gone';
  return (
    match(agent.status)
      .returnType<AddedAgentProgress>()
      .with('provisioning', () => 'waiting')
      .with('starting', () =>
        waitsFor === 'computer_up' ? 'online' : 'waiting'
      )
      .with('running', () => 'online')
      .with('released', () => 'gone')
      // Not answering yet, but coming back by itself.
      .with('unhealthy', () => 'waiting')
      .with('failed', 'paused', () => 'failed')
      // A status a newer server sends keeps waiting, into the slow path.
      .exhaustive(() => 'waiting')
  );
}

/** What the Add dialog ends in once the wait is over. */
export type AddAgentEnding = Exclude<AddedAgentProgress, 'waiting'> | 'slow';

/**
 * Where the Add dialog is. Every failure keeps the dialog open with the name
 * and size, and says what happened to the money:
 * - `declined`: the card was refused; nothing was bought or kept.
 * - `no_room`: no host has room for `size`; nothing was charged.
 * - `not_started`: the computer or agent failed to start; Retry starts it
 *   again on the same computer, without a new charge.
 * - `refunded`: it failed again; the charge was undone and the computer
 *   released, so Retry buys afresh.
 * - `refused`: any other refusal, in the server's words.
 */
export type AddAgentState =
  | { kind: 'editing' }
  | { kind: 'adding' }
  | { kind: 'declined' }
  | { kind: 'no_room'; size: ComputerSize }
  | { kind: 'not_started'; agent: TeamAgent }
  | { kind: 'refunded' }
  | { kind: 'refused'; reason: AddRefusal };

/** Refusals that are neither a decline nor a full host. */
export type AddRefusal =
  | 'invalid'
  | 'not_enabled'
  | 'on_trial'
  | 'unavailable'
  | 'in_progress'
  | 'repository'
  | 'unknown';

/** How a refused invite reads in the dialog. */
export type Refusal =
  | { kind: 'declined' }
  | { kind: 'no_room' }
  | { kind: 'refused'; reason: AddRefusal };

/**
 * The dialog's reading of a refused invite: the purchase refusals the buy
 * dialog shares, then the invite's own.
 */
export function addRefusal(error: unknown): Refusal {
  const shared = purchaseRefusalOf(error);
  if (shared)
    return match(shared)
      .returnType<Refusal>()
      .with('PAYMENT_DECLINED', () => ({ kind: 'declined' }))
      .with('NO_ROOM', () => ({ kind: 'no_room' }))
      .with('TEAM_ON_TRIAL', () => ({ kind: 'refused', reason: 'on_trial' }))
      .with('INVITE_IN_PROGRESS', () => ({
        kind: 'refused',
        reason: 'in_progress',
      }))
      .exhaustive();
  if (!(error instanceof ThrownResultError))
    return { kind: 'refused', reason: 'unknown' };
  return match(error.errors[0]?.code)
    .returnType<Refusal>()
    .with('INVALID_AGENT', () => ({ kind: 'refused', reason: 'invalid' }))
    .with('AGENTS_NOT_ENABLED', () => ({
      kind: 'refused',
      reason: 'not_enabled',
    }))
    .with('COMPUTER_UNAVAILABLE', () => ({
      kind: 'refused',
      reason: 'unavailable',
    }))
    .with('REPOSITORY_FAILED', () => ({
      kind: 'refused',
      reason: 'repository',
    }))
    .otherwise(() => ({ kind: 'refused', reason: 'unknown' }));
}
