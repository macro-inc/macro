import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import type { EntityData } from '@entity';
import type { Property, PropertyDefinitionDomain } from '@property/types';
import { createStore, reconcile } from 'solid-js/store';

type PropertyEditorMode = 'selector' | 'direct' | 'tag';

export const [propertyEditorOpen, setPropertyEditorOpen] =
  createControlledOpenSignal(false, { id: 'property-edit' });

interface PropertyEditorState {
  mode: PropertyEditorMode;
  selectedEntities: EntityData[];
  targetProperty?: Property | PropertyDefinitionDomain;
}

type PropertyEditorOpenOptions = {
  restoreFocus?: () => void | Promise<void>;
};

const [state, setState] = createStore<PropertyEditorState>({
  mode: 'selector',
  selectedEntities: [],
  targetProperty: undefined,
});

let restoreFocusAfterClose: PropertyEditorOpenOptions['restoreFocus'];

export function openPropertyEditor(
  entities: EntityData[],
  mode: PropertyEditorMode = 'selector',
  targetProperty?: Property | PropertyDefinitionDomain,
  options?: PropertyEditorOpenOptions
) {
  if (!entities || entities.length === 0) {
    console.warn('Cannot open property editor without entities');
    return;
  }
  restoreFocusAfterClose = options?.restoreFocus;
  setState(
    reconcile({
      mode,
      selectedEntities: entities,
      targetProperty,
    })
  );
  setPropertyEditorOpen(true);
}

export function closePropertyEditor() {
  const restoreFocus = restoreFocusAfterClose;
  restoreFocusAfterClose = undefined;
  setPropertyEditorOpen(false);
  setState(
    reconcile({
      mode: 'selector',
      selectedEntities: [],
      targetProperty: undefined,
      targetPropertyDefinition: undefined,
    })
  );
  void restoreFocus?.();
}

export function togglePropertyEditor(force?: boolean) {
  const next = force ?? !propertyEditorOpen();
  if (next) setPropertyEditorOpen(true);
  else closePropertyEditor();
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
