import type { LinkedAccount } from '@service-storage/generated/schemas/linkedAccount';
import type { LinkedGroupInfo } from '@service-storage/generated/schemas/linkedGroupInfo';
import type { LinkedPairState } from '@service-storage/generated/schemas/linkedPairState';
import { phoneFromJid, type WhatsAppAccount } from '../core/account';
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

export function decodeGroup(group: LinkedGroupInfo): WhatsAppGroup {
  return {
    jid: group.jid,
    name: group.name,
    memberCount: group.participants.length,
    group: group.group
      ? { id: group.group.id, name: group.group.name }
      : undefined,
    unsupported: group.community
      ? 'community'
      : group.disappearing
        ? 'disappearing'
        : undefined,
  };
}

/** By name, so adding a group or a refetch never moves a row. */
export function decodeGroups(groups: LinkedGroupInfo[]): WhatsAppGroup[] {
  return groups.map(decodeGroup).sort((a, b) => a.name.localeCompare(b.name));
}

export function decodePairing(state: LinkedPairState): {
  step: PairingStep;
  expiresAt: string;
} {
  return { step: pairingStep(state), expiresAt: state.expiresAt };
}
