import { isAccessiblePreviewItem, useItemPreview } from '@queries/preview';
import { stringToItemType } from '@service-storage/itemType';
import type { CreatedRoutineItem } from './core/draft';

/**
 * Something AI created while drafting a routine, by its name once its
 * preview loads, or by what kind of item it is.
 */
export function RoutineCreatedItem(props: { item: CreatedRoutineItem }) {
  const type = () => stringToItemType(props.item.entityType) ?? 'document';
  const [preview] = useItemPreview(() => ({
    id: props.item.entityId,
    type: type(),
  }));
  const name = () => {
    const current = preview();
    return isAccessiblePreviewItem(current) && current.name
      ? current.name
      : `a ${props.item.entityType.replace('_', ' ')}`;
  };
  return <span class="font-medium text-ink">{name()}</span>;
}
