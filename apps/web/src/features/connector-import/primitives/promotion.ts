import { hidePromotion } from '@app/features/sidebar-promotion/primitives/promotion';
import type { ImportCategory } from '../core/providers';

export function importPromotionId(category: ImportCategory): string {
  return `import:${category}`;
}

/** Used by a confirmed import; dismissal goes through the card itself. */
export function hideImportPromotion(
  userId: string | undefined,
  category: ImportCategory
): void {
  hidePromotion(userId, importPromotionId(category));
}
