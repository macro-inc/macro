import { registerHotkey } from 'core/hotkey/hotkeys';
import { onCleanup, onMount, type Accessor } from 'solid-js';
import { openPropertyEditor } from '../state/propertyEditor';
import type {
  Property,
  PropertyDefinitionDomain,
} from '@core/component/Properties/types';
import { isTaskEntity, type EntityData } from '@macro-entity';
import { TOKENS } from '@core/hotkey/tokens';
import { HotkeyTags } from '@core/hotkey/constants';
import { useAllProperties } from './useAllProperties';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';

interface PropertyEditorHotkeyOptions {
  scopeId: string;
  getSelectedEntities: () => EntityData[];
  enabled?: Accessor<boolean>;
}

/**
 * Hook that registers hotkeys for the property editor
 * - `cmd-shift-o`: Opens property selector
 * - `cmd-shift-s`: Direct edit status property
 * - `cmd-shift-p`: Direct edit priority property
 * - `cmd-shift-a`: Direct edit assigness property
 */
export function usePropertyEditorHotkeys(options: PropertyEditorHotkeyOptions) {
  const { scopeId, getSelectedEntities, enabled = () => true } = options;
  const allProperties = useAllProperties();

  const propertyById = (propertyId: string) => {
    return allProperties().find(({ id }) => {
      return id === propertyId;
    });
  };
  const status = () => propertyById(SYSTEM_PROPERTY_IDS.STATUS);
  const priority = () => propertyById(SYSTEM_PROPERTY_IDS.PRIORITY);
  const assignees = () => propertyById(SYSTEM_PROPERTY_IDS.ASSIGNEES);

  // Helper to open property editor if entities are selected
  const openIfSelected = (
    mode: 'selector' | 'direct' = 'selector',
    property?: Property | PropertyDefinitionDomain
  ) => {
    if (!enabled()) {
      console.log('[PropertyEditor] Hotkey disabled');
      return;
    }
    const entities = getSelectedEntities();
    if (entities && entities.length > 0) {
      openPropertyEditor(entities, mode, property);
    } else {
      console.warn('[PropertyEditor] No entities selected for property editor');
    }
  };

  onMount(() => {
    const disposers: Array<{ dispose: () => void }> = [];
    disposers.push(
      registerHotkey({
        hotkey: ['shift+cmd+o'],
        hotkeyToken: TOKENS.entity.action.properties,
        tags: [HotkeyTags.SelectionModification],
        displayPriority: 10,
        description: 'Open property editor',
        keyDownHandler: () => {
          const entities = getSelectedEntities();
          if (!entities.every(isTaskEntity)) return true;
          openIfSelected('selector');
          return true;
        },
        scopeId,
      }),
      registerHotkey({
        hotkey: ['shift+cmd+p'],
        hotkeyToken: TOKENS.entity.action.priority,
        tags: [HotkeyTags.SelectionModification],
        displayPriority: 10,
        description: 'Set priority',
        keyDownHandler: () => {
          const property = priority();
          const entities = getSelectedEntities();
          if (!entities.every(isTaskEntity) || !property) return true;
          openIfSelected('direct', property);
          return true;
        },
        condition: () => Boolean(priority()),
        scopeId,
      }),
      registerHotkey({
        hotkey: ['shift+cmd+a'],
        hotkeyToken: TOKENS.entity.action.assignee,
        tags: [HotkeyTags.SelectionModification],
        displayPriority: 10,
        description: 'Set assignee',
        keyDownHandler: () => {
          const property = assignees();
          const entities = getSelectedEntities();
          if (!entities.every(isTaskEntity) || !property) return true;
          openIfSelected('direct', property);
          return true;
        },
        condition: () => Boolean(assignees()),
        scopeId,
      }),
      registerHotkey({
        hotkey: ['shift+cmd+s'],
        hotkeyToken: TOKENS.entity.action.status,
        tags: [HotkeyTags.SelectionModification],
        displayPriority: 10,
        description: 'Set status',
        keyDownHandler: () => {
          const property = status();
          const entities = getSelectedEntities();
          if (!entities.every(isTaskEntity) || !property) return true;
          openIfSelected('direct', property);
          return true;
        },
        condition: () => Boolean(status()),
        scopeId,
      })
    );
    onCleanup(() => {
      disposers.forEach((disposer) => disposer.dispose());
    });
  });

  return {
    openPropertyEditor: openIfSelected,
  };
}
