/**
 * Hosts allowed to send the production Meta pixel and to attach its click
 * ids to a signup. Dev, preview, and staging builds must not.
 */
export const isProductionMetaHost = (hostname: string): boolean =>
  hostname === 'macro.com' || hostname === 'www.macro.com';
