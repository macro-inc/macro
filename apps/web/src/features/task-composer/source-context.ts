import {
  enableTaskSourceProperty,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { TaskComposerContext } from './core/context';
import { DEFAULT_TASK_COMPOSER_PROPERTY_IDS } from './property-defaults';

/** Capture the source at the originating action, not after the composer mounts. */
export function taskSourceComposerContext(
  source: EntityReference
): TaskComposerContext | undefined {
  if (!isFeatureEnabled(enableTaskSourceProperty)) return;

  return {
    key: `source:${source.entity_type}:${source.entity_id}:${source.specific_message_id ?? ''}`,
    visiblePropertyIds: [
      ...DEFAULT_TASK_COMPOSER_PROPERTY_IDS,
      SYSTEM_PROPERTY_IDS.SOURCE,
    ],
    initialPropertyValues: {
      [SYSTEM_PROPERTY_IDS.SOURCE]: {
        valueType: 'ENTITY',
        refs: [{ ...source }],
      },
    },
  };
}
