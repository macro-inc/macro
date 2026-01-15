import type { EntityData } from '@macro-entity';
import type { Property } from '@core/component/Properties/types';
import { createStore, reconcile } from 'solid-js/store';

export type PropertyEditorMode = 'selector' | 'direct';

interface PropertyEditorState {
  isOpen: boolean;
  mode: PropertyEditorMode;
  selectedEntities: EntityData[];
  targetProperty?: Property;
}

const [state, setState] = createStore<PropertyEditorState>({
  isOpen: false,
  mode: 'selector',
  selectedEntities: [],
  targetProperty: undefined,
});

export function openPropertyEditor(
  entities: EntityData[],
  mode: PropertyEditorMode = 'selector',
  targetProperty?: Property
) {
  if (!entities || entities.length === 0) {
    console.warn('Cannot open property editor without entities');
    return;
  }
  setState(
    reconcile({
      isOpen: true,
      mode,
      selectedEntities: entities,
      targetProperty,
    })
  );
}

export function closePropertyEditor() {
  setState(
    reconcile({
      isOpen: false,
      mode: 'selector',
      selectedEntities: [],
      targetProperty: undefined,
      targetPropertyDefinition: undefined,
    })
  );
}

export function togglePropertyEditor(force?: boolean) {
  setState('isOpen', force ?? !state.isOpen);
}

export function setPropertyEditorMode(mode: PropertyEditorMode) {
  setState('mode', mode);
}

export function setPropertyEditorTarget(property: Property) {
  setState('targetProperty', property);
}

export const propertyEditorState = state;
