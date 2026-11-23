/**
 * Hosts allowed to send the production Meta pixel. The same marketing build
 * is served on dev, preview, and staging hosts; those must not initialize
 * pixel 639142540393286. Keep the check in index.html and start.html in step
 * with this function — those scripts run before this module loads.
 */
export const isProductionMetaHost = (hostname: string): boolean =>
  hostname === 'macro.com' || hostname === 'www.macro.com';
