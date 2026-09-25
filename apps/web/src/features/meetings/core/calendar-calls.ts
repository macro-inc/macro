/** Keep invitations to another Macro environment on their original host. */
export function calendarCallNavigation(value: string, webOrigin: string) {
  const url = new URL(value, webOrigin);
  return url.origin === new URL(webOrigin).origin
    ? {
        kind: 'internal' as const,
        path: `${url.pathname.replace(/^\/app(?=\/)/, '')}${url.search}${url.hash}`,
      }
    : { kind: 'external' as const, url: url.toString() };
}
