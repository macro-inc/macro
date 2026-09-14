import type { ListFilterGroup } from '@app/components/view-shell';
import { TAG_FACET_ID } from '@app/features/soup';
import { type Accessor, createMemo } from 'solid-js';
import { TagDot } from './TagDot';
import { useTagOptions } from './tag-options';

export type TagFilterGroup = ListFilterGroup<typeof TAG_FACET_ID, string>;

/**
 * The Tags group of a list view's filter menu. Option ids are tag option ids,
 * so the selection can be stored directly under the shared tags facet.
 */
export function useTagFilterGroup(): Accessor<TagFilterGroup> {
  const tagOptions = useTagOptions();

  return createMemo(
    (): TagFilterGroup => ({
      id: TAG_FACET_ID,
      label: 'Tags',
      options: tagOptions().map((tag) => ({
        id: tag.id,
        label: tag.label,
        icon: () => <TagDot color={tag.color} />,
      })),
    })
  );
}
