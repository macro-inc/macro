/** Public demos render app views without opening authenticated transports. */
export const isPublicSurface =
  typeof document !== 'undefined' &&
  document.documentElement.hasAttribute('data-public-site');
