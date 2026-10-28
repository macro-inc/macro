import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity/types/entity';
import { Telemetry } from '@macro-inc/observability';
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
  const settle = () =>
    Telemetry.span('tag.drop_apply', async (span) => {
      span.setAttr('tag.id', props.tag.id);
      const applications = props.entities.flatMap((entity) => {
        const entityType = tagEntityType(entity);
        if (!entityType) return [];
        const docTags = useSoupDocTags(entity.id, entityType, () =>
          'properties' in entity ? entity.properties : undefined
        );
        return [docTags.applyTag(props.tag.scope, props.tag.id)];
      });
      span.setAttr('tag.entity_count', applications.length);
      const results = await Promise.allSettled(applications);
      let failures = 0;
      for (const result of results) {
        if (result.status === 'rejected') {
          failures++;
          Telemetry.error(result.reason, { surface: 'tag-drop' });
        }
      }
      span.setAttr('tag.failure_count', failures);
      if (failures > 0) span.error('Tag application failed');
      props.onDone();
    });
  fireAndForget(settle(), 'tag-drop');

  return null;
}
