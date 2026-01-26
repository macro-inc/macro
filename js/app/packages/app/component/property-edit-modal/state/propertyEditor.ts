import type { EntityData } from '@macro-entity';
import type {
  Property,
  PropertyDefinitionDomain,
} from '@core/component/Properties/types';
import { createStore, reconcile } from 'solid-js/store';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';

export type PropertyEditorMode = 'selector' | 'direct';

export const [propertyEditorOpen, setPropertyEditorOpen] =
  createControlledOpenSignal();

interface PropertyEditorState {
  mode: PropertyEditorMode;
  selectedEntities: EntityData[];
  targetProperty?: Property | PropertyDefinitionDomain;
}

const [state, setState] = createStore<PropertyEditorState>({
  mode: 'selector',
  selectedEntities: [],
  targetProperty: undefined,
});

export function openPropertyEditor(
  entities: EntityData[],
  mode: PropertyEditorMode = 'selector',
  targetProperty?: Property | PropertyDefinitionDomain
) {
  if (!entities || entities.length === 0) {
    console.warn('Cannot open property editor without entities');
    return;
  }
  setPropertyEditorOpen(true);
  setState(
    reconcile({
      mode,
      selectedEntities: entities,
      targetProperty,
    })
  );
}

export function closePropertyEditor() {
  setPropertyEditorOpen(false);
  setState(
    reconcile({
      mode: 'selector',
      selectedEntities: [],
      targetProperty: undefined,
      targetPropertyDefinition: undefined,
    })
  );
}

export function togglePropertyEditor(force?: boolean) {
  setPropertyEditorOpen(force ?? !propertyEditorOpen());
}

export function setPropertyEditorMode(mode: PropertyEditorMode) {
  setState('mode', mode);
}

export function setPropertyEditorTarget(
  property: Property | PropertyDefinitionDomain
) {
  setState('targetProperty', property);
}

export const propertyEditorState = state;
