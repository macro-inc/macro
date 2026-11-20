/**
 * Which rate limits a request counts against. A browser is limited by its
 * client IP. A Macro computer names itself in `x-macro-computer-id` (macrod
 * and its agent send it), so computers that share an egress IP don't share
 * one budget: each is limited on its own, and all requests naming a computer
 * from one IP share a wider fleet ceiling. The header is not authenticated,
 * so a client that rotates ids gets at most that ceiling.
 */

/** The header a Macro computer names itself in. */
export const COMPUTER_HEADER = 'x-macro-computer-id';

/** A computer id as macrod writes it: letters, digits and dashes. */
const COMPUTER_ID = /^[A-Za-z0-9-]{1,64}$/;

/** A rate-limit binding, by its name in wrangler.jsonc. */
export type Limiter =
  | 'RATE_LIMITER'
  | 'COMPUTER_RATE_LIMITER'
  | 'COMPUTER_FLEET_RATE_LIMITER';

export type Limit = { readonly limiter: Limiter; readonly key: string };

/** The limits a request from `clientIp`, naming `computer` if any, counts against. */
export function limitsFor(
  clientIp: string,
  computer: string | undefined
): readonly Limit[] {
  if (computer === undefined || !COMPUTER_ID.test(computer))
    return [{ limiter: 'RATE_LIMITER', key: clientIp }];
  return [
    { limiter: 'COMPUTER_RATE_LIMITER', key: computer },
    { limiter: 'COMPUTER_FLEET_RATE_LIMITER', key: clientIp },
  ];
}
