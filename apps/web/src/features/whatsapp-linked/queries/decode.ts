import { ThrownResultError } from '@core/util/result';
import type { LinkedAccount } from '@service-storage/generated/schemas/linkedAccount';
import type { LinkedGroupInfo } from '@service-storage/generated/schemas/linkedGroupInfo';
import type { LinkedPairState } from '@service-storage/generated/schemas/linkedPairState';
import { match } from 'ts-pattern';
import { phoneFromJid, type WhatsAppAccount } from '../core/account';
import type { AdoptRefusal } from '../core/adopt';
import type { WhatsAppGroup } from '../core/group';
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
export function decodeGroup(
  group: LinkedGroupInfo,
  ownerName: (ownerId: string) => string
): WhatsAppGroup {
  return {
    jid: group.jid,
    name: group.name,
    memberCount: group.participants.length,
    inMacro: group.group
      ? { kind: 'own', groupId: group.group.id }
      : group.shared
        ? {
            kind: 'shared',
            groupId: group.shared.id,
            ownerId: group.shared.owner_id,
            ownerName: ownerName(group.shared.owner_id),
          }
        : undefined,
    unsupported: group.community
      ? 'community'
      : group.disappearing
        ? 'disappearing'
        : undefined,
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

/** By name, so adding a group or a refetch never moves a row. */
export function decodeGroups(
  groups: LinkedGroupInfo[],
  ownerName: (ownerId: string) => string
): WhatsAppGroup[] {
  return groups
    .map((group) => decodeGroup(group, ownerName))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function decodePairing(state: LinkedPairState): {
  step: PairingStep;
  expiresAt: string;
} {
  return { step: pairingStep(state), expiresAt: state.expiresAt };
}
