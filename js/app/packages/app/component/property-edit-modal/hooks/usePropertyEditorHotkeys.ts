import { registerHotkey } from 'core/hotkey/hotkeys';
import { onCleanup, onMount, type Accessor } from 'solid-js';
import { openPropertyEditor } from '../state/propertyEditor';
import type { Property } from '@core/component/Properties/types';
import { isTaskEntity, type EntityData } from '@macro-entity';
import { TOKENS } from '@core/hotkey/tokens';
import { HotkeyTags } from '@core/hotkey/constants';

interface PropertyEditorHotkeyOptions {
  scopeId: string;
  getSelectedEntities: () => EntityData[];
  enabled?: Accessor<boolean>;
}

/**
 * Hook that registers hotkeys for the property editor
 * - `opt-i`: Opens property selector
 * - `opt+s`: Direct edit status property
 * - `opt+a`: Direct edit assignee property (if available)
 * - `opt+d`: Direct edit due date property (if available)
 * - `opt+t`: Direct edit tags property (if available)
 */
export function usePropertyEditorHotkeys(options: PropertyEditorHotkeyOptions) {
  const { scopeId, getSelectedEntities, enabled = () => true } = options;

  // Helper to open property editor if entities are selected
  const openIfSelected = (
    mode: 'selector' | 'direct' = 'selector',
    property?: Property
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
