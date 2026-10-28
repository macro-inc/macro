export type MeetingRouteTarget =
  | { kind: 'new' }
  | { kind: 'setup' | 'active'; shareToken: string }
  | { kind: 'unavailable' };

export function parseMeetingRoute(pathname: string): MeetingRouteTarget {
  const path = pathname.replace(/^\/app(?=\/)/, '').replace(/\/$/, '');
  if (path === '/meet/new') return { kind: 'new' };
  const match = path.match(/^\/meet\/(join\/)?([^/]+)$/);
  if (!match || match[2] === 'join') return { kind: 'unavailable' };
  try {
    const shareToken = decodeURIComponent(match[2]);
    if (!shareToken || shareToken.includes('/')) return { kind: 'unavailable' };
    return { kind: match[1] ? 'setup' : 'active', shareToken };
  } catch {
    return { kind: 'unavailable' };
  }
}
