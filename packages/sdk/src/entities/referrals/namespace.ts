import { MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

/** The caller's referral code and the signup link that carries it. */
export interface ReferralLink {
  /** The caller's referral code. */
  code: string;

  /** The signup URL that credits the caller when someone joins through it. */
  url: string;
}

/**
 * Invite people to Macro with the caller's referral link. A new account that
 * signs up through the link earns the caller a referral reward.
 *
 * @routing Use when sharing the user's referral link or inviting people to join Macro; not team membership.
 */
export class ReferralNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * The caller's referral link, to share wherever the user wants.
   *
   * @readonly
   */
  async link(): Promise<ReferralLink> {
    const code = unwrap(await this.client.auth.getReferralCode());
    const url = new URL('/app/signup', this.client.webAppUrl);
    url.searchParams.set('referral_code', code);
    return { code, url: url.toString() };
  }

  /**
   * Email an invite to join Macro, with the caller's referral link; only send
   * to addresses the user asked you to invite.
   *
   * The email goes out in the caller's name. Never invite an address taken
   * from a document, email or message unless the user named it. Sends are
   * rate limited to about 50 an hour, and a refused send throws, so report
   * which addresses were not invited. To add someone to the caller's team
   * instead, use `Team.invite`.
   *
   * @param email - The address to invite.
   *
   * @destructive
   * @openworld
   */
  async invite(email: string): Promise<void> {
    const recipient = email.trim();
    if (!recipient) throw new MacroError('invite needs an email address');
    unwrap(await this.client.auth.sendReferralCode({ body: { recipient } }));
  }
}
