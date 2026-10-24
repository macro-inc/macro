import { ThrownResultError } from '@core/util/result';
import type { LinkedAccount } from '@service-storage/generated/schemas/linkedAccount';
import type { LinkedChat } from '@service-storage/generated/schemas/linkedChat';
import type { LinkedChats } from '@service-storage/generated/schemas/linkedChats';
import type { LinkedPairState } from '@service-storage/generated/schemas/linkedPairState';
import { match } from 'ts-pattern';
import { phoneFromJid, type WhatsAppAccount } from '../core/account';
import type { AdoptRefusal } from '../core/adopt';
import type { WhatsAppChat } from '../core/chat';
import { type PairingStep, pairingStep } from '../core/pairing';

export function decodeAccount(
  account: LinkedAccount | null | undefined
): WhatsAppAccount | null {
  if (!account) return null;
  return {
    generation: account.authorization_generation,
    phone: account.identity_jid
      ? phoneFromJid(account.identity_jid)
      : undefined,
    health: account.state,
  };
}

/** `ownerName` resolves a Macro user id; production reads the shared name cache. */
export function decodeChat(
  chat: LinkedChat,
  ownerName: (ownerId: string) => string
): WhatsAppChat {
  return {
    jid: chat.jid,
    kind: chat.kind,
    name: chat.name,
    lastActivityAt: chat.last_activity_at ?? undefined,
    archived: chat.archived,
    inMacro: chat.group
      ? { kind: 'own', groupId: chat.group.id }
      : chat.shared
        ? {
            kind: 'shared',
            groupId: chat.shared.id,
            ownerId: chat.shared.owner_id,
            ownerName: ownerName(chat.shared.owner_id),
          }
        : undefined,
    canAdd: chat.can_add,
    cannotAddReason: chat.cannot_add_reason ?? undefined,
  };
}

/** DSS's `LinkedError` code (or the transport's) in the page's words. */
export function decodeAdoptRefusal(error: unknown): AdoptRefusal {
  if (!(error instanceof ThrownResultError)) return { reason: 'unreachable' };
  const [first] = error.errors;
  if (!first) return { reason: 'unavailable' };
  return match(first.code)
    .returnType<AdoptRefusal>()
    .with('forbidden', 'FORBIDDEN', () => ({ reason: 'not-allowed' }))
    .with('not_found', 'NOT_FOUND', 'GONE', () => ({ reason: 'gone' }))
    .with('conflict', 'CONFLICT', () => ({ reason: 'already-added' }))
    .with('disconnected', 'identity_conflict', () => ({
      reason: 'disconnected',
    }))
    .with('configuration_required', () => ({ reason: 'turned-off' }))
    .with('rate_limited', () => ({ reason: 'rate-limited' }))
    .with('invalid_input', () => ({
      reason: 'rejected',
      detail: first.message,
    }))
    .with('UNAUTHORIZED', () => ({ reason: 'signed-out' }))
    .with('NETWORK_ERROR', () => ({ reason: 'unreachable' }))
    .otherwise(() => ({ reason: 'unavailable' }));
}

/** DSS's order (newest activity first) is kept. */
export function decodeChats(
  chats: LinkedChats,
  ownerName: (ownerId: string) => string
): WhatsAppChat[] {
  return chats.chats.map((chat) => decodeChat(chat, ownerName));
}

export function decodePairing(state: LinkedPairState): {
  step: PairingStep;
  expiresAt: string;
} {
  return { step: pairingStep(state), expiresAt: state.expiresAt };
}
