import { getEntityIconType } from '@core/component/EntityIcon';
import type { RecommendedItem } from '@queries/ai/homeRecommendations';

export function recommendedIconType(entityType: RecommendedItem['entityType']) {
  switch (entityType) {
    case 'email_thread':
      return getEntityIconType({ type: 'email' });
    case 'channel':
      return getEntityIconType({ type: 'channel' });
    case 'chat':
      return getEntityIconType({ type: 'chat' });
    case 'document':
      return getEntityIconType({ type: 'document' });
    case 'project':
      return getEntityIconType({ type: 'project' });
    default:
      return 'default' as const;
  }
}
