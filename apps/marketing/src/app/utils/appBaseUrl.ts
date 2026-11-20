/** Shared by the website and standalone dev/preview app navigation. */
export function resolveAppBaseUrl(configuredUrl: string | undefined): string {
  return configuredUrl || 'https://macro.com';
}
