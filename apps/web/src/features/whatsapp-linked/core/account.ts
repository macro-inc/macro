import { match } from 'ts-pattern';

/** Connection health of the person's own linked account. */
export type WhatsAppHealth =
  | 'pairing'
  | 'connected'
  | 'logged_out'
  | 'disconnected';

/** The signed-in person's linked WhatsApp account. */
export type WhatsAppAccount = {
  /** Consent generation; fences a disconnect against a later re-pairing. */
  generation: number;
  /** Verified phone number, once pairing finished. */
  phone: string | undefined;
  health: WhatsAppHealth;
};

/** What the WhatsApp page shows for an account. */
export type AccountStatus =
  | { kind: 'not-connected'; reconnect: boolean }
  | { kind: 'connected'; account: WhatsAppAccount };

export function accountStatus(account: WhatsAppAccount | null): AccountStatus {
  if (!account) return { kind: 'not-connected', reconnect: false };
  return match(account.health)
    .with('connected', () => ({ kind: 'connected' as const, account }))
    .with('logged_out', () => ({
      kind: 'not-connected' as const,
      reconnect: true,
    }))
    .with('pairing', 'disconnected', () => ({
      kind: 'not-connected' as const,
      reconnect: false,
    }))
    .exhaustive();
}

/**
 * The phone number in a WhatsApp user JID (`15551230142:7@s.whatsapp.net`),
 * as `+15551230142`. Other JID kinds (LID, groups) carry no phone number.
 */
export function phoneFromJid(jid: string): string | undefined {
  const [user, server] = jid.split('@');
  if (server !== 's.whatsapp.net' || !user) return undefined;
  const number = user.split(':')[0];
  return number && /^\d+$/.test(number) ? `+${number}` : undefined;
}
