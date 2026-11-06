export function t(key: string, args?: Record<string, string | number>): string {
  if (key === 'agentWork.recentlyShared') return 'Recently shared';
  if (key === 'agentWork.newActivity') return `${args?.count} new`;
  if (key === 'agentWork.loadMoreActivity') return 'Load more';
  if (key === 'agentWork.entityType') return String(args?.type);
  if (key === 'agentWork.verbCount') return `${args?.verb} (x${args?.count})`;
  if (key === 'agentWork.showEntityActivity')
    return `Show activity for ${args?.name}`;
  return key;
}
