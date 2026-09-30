import type { EntityData } from '@entity/types/entity';
import type { TreeTag } from './core/tag-tree';
import { tagEntityType } from './entityTagging';
import { useSoupDocTags } from './useDocTags';

/**
 * Applies a dropped tag to each entity, keeping their existing tags, then
 * calls `onDone`. Mount it for the lifetime of one drop.
 */
export function DroppedTagApplier(props: {
  tag: TreeTag;
  entities: EntityData[];
  onDone: () => void;
}) {
  const applications = props.entities.flatMap((entity) => {
    const entityType = tagEntityType(entity);
    if (!entityType) return [];
    const docTags = useSoupDocTags(entity.id, entityType, () =>
      'properties' in entity ? entity.properties : undefined
    );
    return [docTags.applyTag(props.tag.scope, props.tag.id)];
  });

  const settle = async () => {
    const results = await Promise.allSettled(applications);
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Failed to apply dropped tag', result.reason);
      }
    }
    props.onDone();
  };
  void settle();

  return null;
}
