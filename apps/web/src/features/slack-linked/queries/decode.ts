import { ThrownResultError } from '@core/util/result';
import type {
  SlackLogin,
  SlackAccount as WireAccount,
  SlackConversation as WireConversation,
} from '@service-storage/slack-linked-wire';
import { match } from 'ts-pattern';
import type { SlackAccount } from '../core/account';
import type { AddFailure, SlackConversation } from '../core/conversation';
import type { LoginRead, LoginRequestFailure } from '../core/login';

export function decodeAccount(account: WireAccount): SlackAccount {
  return {
    id: account.id,
    teamId: account.teamId,
    teamName: account.teamName,
    teamDomain: account.teamDomain,
    teamIconUrl: account.teamIconUrl ?? undefined,
    enterprise: account.enterpriseId !== null,
    displayName: account.displayName ?? undefined,
    state: account.state,
    endedReason: account.endedReason ?? undefined,
    generation: account.authorizationGeneration,
  };
}

/** `ownerName` resolves a Macro user id; production reads the shared name cache. */
export function decodeConversation(
  conversation: WireConversation,
  ownerName: (ownerId: string) => string
): SlackConversation {
  const orgs = conversation.directPerson?.team
    ? [conversation.directPerson.team]
    : conversation.connectedTeams;
  return {
    remoteId: conversation.remoteId,
    kind: conversation.kind,
    name: conversation.name,
    isPrivate: conversation.isPrivate,
    isArchived: conversation.isArchived,
    frozen: conversation.frozen,
    orgs: orgs.map((team) => ({ teamId: team.teamId, name: team.name })),
    accountIds: conversation.accounts,
    lastActivityAt: conversation.lastActivityAt ?? undefined,
    inMacro: conversation.added
      ? { kind: 'own', chatId: conversation.added.id }
      : conversation.shared
        ? {
            kind: 'shared',
            chatId: conversation.shared.id,
            ownerId: conversation.shared.ownerId,
            ownerName: ownerName(conversation.shared.ownerId),
          }
        : undefined,
    canAdd: conversation.canAdd,
    cannotAddReason: conversation.cannotAddReason ?? undefined,
  };
}

export function decodeLogin(login: SlackLogin): LoginRead {
  return { loginId: login.id, step: login.step, expiresAt: login.expiresAt };
}

/** The first error code of a failed request, or undefined when it never got one. */
function errorCode(error: unknown): string | undefined | null {
  if (!(error instanceof ThrownResultError)) return null;
  return error.errors[0]?.code;
}

/** DSS's error code (or the transport's) in the dialog's words. */
export function decodeLoginRequestFailure(error: unknown): LoginRequestFailure {
  const code = errorCode(error);
  const reason = match(code)
    .returnType<LoginRequestFailure['reason']>()
    .with(null, 'NETWORK_ERROR', () => 'unreachable')
    .with('conflict', 'CONFLICT', () => 'wrong-step')
    .with('GONE', () => 'expired')
    .with('rate_limited', () => 'rate-limited')
    .with('invalid_input', () => 'invalid-input')
    .with('UNAUTHORIZED', () => 'signed-out')
    .otherwise(() => 'unavailable');
  return { kind: 'login-request-failed', reason };
}

/** DSS's add refusal (or the transport's) in the page's words. */
export function decodeAddFailure(error: unknown): AddFailure {
  const code = errorCode(error);
  return match(code)
    .returnType<AddFailure>()
    .with(null, 'NETWORK_ERROR', () => ({
      kind: 'add-failed',
      reason: 'unreachable',
    }))
    .with('forbidden', 'FORBIDDEN', () => ({
      kind: 'add-failed',
      reason: 'not-allowed',
    }))
    .with('not_found', 'NOT_FOUND', 'GONE', () => ({
      kind: 'add-failed',
      reason: 'gone',
    }))
    .with('conflict', 'CONFLICT', () => ({
      kind: 'add-failed',
      reason: 'already-added',
    }))
    .with('disconnected', () => ({
      kind: 'add-failed',
      reason: 'disconnected',
    }))
    .with('rate_limited', () => ({
      kind: 'add-failed',
      reason: 'rate-limited',
    }))
    .with('cannot_add_archived', () => ({
      kind: 'add-failed',
      reason: 'cannot-add',
      why: 'archived',
    }))
    .with('cannot_add_frozen', () => ({
      kind: 'add-failed',
      reason: 'cannot-add',
      why: 'frozen',
    }))
    .with('cannot_add_not_member', () => ({
      kind: 'add-failed',
      reason: 'cannot-add',
      why: 'not_member',
    }))
    .with('UNAUTHORIZED', () => ({ kind: 'add-failed', reason: 'signed-out' }))
    .with('internal_error', 'SERVER_ERROR', () => ({
      kind: 'add-failed',
      reason: 'server-error',
    }))
    .otherwise(() => ({ kind: 'add-failed', reason: 'unavailable' }));
}
