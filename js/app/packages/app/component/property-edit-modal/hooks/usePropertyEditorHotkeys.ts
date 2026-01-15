import { registerHotkey } from 'core/hotkey/hotkeys';
import { onCleanup, onMount, type Accessor } from 'solid-js';
import { openPropertyEditor } from '../state/propertyEditor';
import type { Property } from '@core/component/Properties/types';
import type { EntityData } from '@macro-entity';

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
    console.log('[PropertyEditor] Selected entities:', entities);
    if (entities && entities.length > 0) {
      openPropertyEditor(entities, mode, property);
    } else {
      console.warn('[PropertyEditor] No entities selected for property editor');
    }
  };

  onMount(() => {
    console.log('[PropertyEditor] Registering hotkeys for scope:', scopeId);
    const disposers: Array<{ dispose: () => void }> = [];

    // Register main property selector hotkey
    disposers.push(
      registerHotkey({
        hotkey: ['i'],
        description: 'Edit properties',
        keyDownHandler: () => {
          console.log('[PropertyEditor] p hotkey triggered');
          openIfSelected('selector');
          return true;
        },
        scopeId,
      })
    );

    disposers.push(
      registerHotkey({
        hotkey: ['opt+s'],
        description: 'Edit status',
        keyDownHandler: () => {
          return true;
        },
        scopeId,
      })
    );
    // Cleanup on unmount
    onCleanup(() => {
      disposers.forEach((disposer) => disposer.dispose());
    });
  });

  return {
    openPropertyEditor: openIfSelected,
  };
}
