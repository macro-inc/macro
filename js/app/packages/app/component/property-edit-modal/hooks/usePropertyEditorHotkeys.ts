import { registerHotkey } from 'core/hotkey/hotkeys';
import { openPropertyEditor } from '../state/propertyEditor';
import type {
  Property,
  PropertyDefinitionDomain,
} from '@core/component/Properties/types';
import { isTaskEntity, type EntityData } from '@entity';
import { TOKENS } from '@core/hotkey/tokens';
import { HotkeyTags } from '@core/hotkey/constants';
import { useAllProperties } from './useAllProperties';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import type { SoupState } from '@app/component/next-soup/create-soup-state';

interface PropertyEditorHotkeyOptions {
  scopeId: string;
  soup: SoupState;
}

/**
 * Hook that registers hotkeys for the property editor
 * - `cmd-shift-o`: Opens property selector
 * - `cmd-shift-s`: Direct edit status property
 * - `cmd-shift-p`: Direct edit priority property
 * - `cmd-shift-a`: Direct edit assignees property
 */
export function usePropertyEditorHotkeys(options: PropertyEditorHotkeyOptions) {
  const { scopeId, soup } = options;
  const allProperties = useAllProperties();

  const propertyById = (propertyId: string) => {
    return allProperties().find(({ id }) => {
      return id === propertyId;
    });
  };
  const status = () => propertyById(SYSTEM_PROPERTY_IDS.STATUS);
  const priority = () => propertyById(SYSTEM_PROPERTY_IDS.PRIORITY);
  const assignees = () => propertyById(SYSTEM_PROPERTY_IDS.ASSIGNEES);

  const getEntitiesForAction = (): EntityData[] => {
    const selected = soup.selection.selected();
    if (selected.length > 0) return selected;
    const focused = soup.focus.item();
    return focused ? [focused] : [];
  };

  // Helper to open property editor if entities are selected
  const openIfSelected = (
    mode: 'selector' | 'direct' = 'selector',
    property?: Property | PropertyDefinitionDomain
  ) => {
    const entities = getEntitiesForAction();
    if (entities && entities.length > 0) {
      openPropertyEditor(entities, mode, property);
    } else {
      console.warn('[PropertyEditor] No entities selected for property editor');
    }
  };

  // Open property selector - shift+cmd+o
  registerHotkey({
    hotkey: ['shift+cmd+o'],
    hotkeyToken: TOKENS.entity.action.properties,
    tags: [HotkeyTags.SelectionModification],
    displayPriority: 10,
    description: 'Open property editor',
    keyDownHandler: () => {
      openIfSelected('selector');
      return true;
    },
    condition: () => {
      const entities = getEntitiesForAction();
      return entities.length > 0 && entities.every(isTaskEntity);
    },
    scopeId,
  });

  // Set priority - shift+cmd+p
  registerHotkey({
    hotkey: ['shift+cmd+p'],
    hotkeyToken: TOKENS.entity.action.priority,
    tags: [HotkeyTags.SelectionModification],
    displayPriority: 10,
    description: 'Set priority',
    keyDownHandler: () => {
      openIfSelected('direct', priority());
      return true;
    },
    condition: () => {
      const entities = getEntitiesForAction();
      return (
        entities.length > 0 &&
        entities.every(isTaskEntity) &&
        Boolean(priority())
      );
    },
    scopeId,
  });

  // Set assignee - shift+cmd+a
  registerHotkey({
    hotkey: ['shift+cmd+a'],
    hotkeyToken: TOKENS.entity.action.assignee,
    tags: [HotkeyTags.SelectionModification],
    displayPriority: 10,
    description: 'Set assignee',
    keyDownHandler: () => {
      openIfSelected('direct', assignees());
      return true;
    },
    condition: () => {
      const entities = getEntitiesForAction();
      return (
        entities.length > 0 &&
        entities.every(isTaskEntity) &&
        Boolean(assignees())
      );
    },
    scopeId,
  });

  // Set status - shift+cmd+s
  registerHotkey({
    hotkey: ['shift+cmd+s'],
    hotkeyToken: TOKENS.entity.action.status,
    tags: [HotkeyTags.SelectionModification],
    displayPriority: 10,
    description: 'Set status',
    keyDownHandler: () => {
      openIfSelected('direct', status());
      return true;
    },
    condition: () => {
      const entities = getEntitiesForAction();
      return (
        entities.length > 0 && entities.every(isTaskEntity) && Boolean(status())
      );
    },
    scopeId,
  });

  return {
    openPropertyEditor: openIfSelected,
  };
}
