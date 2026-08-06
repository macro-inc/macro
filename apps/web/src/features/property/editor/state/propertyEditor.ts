import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import type { EntityData } from '@entity';
import type { Property, PropertyDefinitionDomain } from '@property/types';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { createStore, reconcile } from 'solid-js/store';

type PropertyEditorMode = 'selector' | 'direct' | 'tag';

export type PropertyEditorEntity =
  | EntityData
  | {
      id: string;
      name: string;
      entityType: EntityType;
    };

export const [propertyEditorOpen, setPropertyEditorOpen] =
  createControlledOpenSignal(false, { id: 'property-edit' });

interface PropertyEditorState {
  mode: PropertyEditorMode;
  selectedEntities: PropertyEditorEntity[];
  targetProperty?: Property | PropertyDefinitionDomain;
}

type PropertyEditorOpenOptions = {
  restoreFocus?: () => void | Promise<void>;
  onPropertyAdded?: (addedDefinitionIds?: string[]) => void | Promise<void>;
};

const [state, setState] = createStore<PropertyEditorState>({
  mode: 'selector',
  selectedEntities: [],
  targetProperty: undefined,
});

let restoreFocusAfterClose: PropertyEditorOpenOptions['restoreFocus'];
let onPropertyAddedForOpenEditor: PropertyEditorOpenOptions['onPropertyAdded'];

export function openPropertyEditor(
  entities: PropertyEditorEntity[],
  mode: PropertyEditorMode = 'selector',
  targetProperty?: Property | PropertyDefinitionDomain,
  options?: PropertyEditorOpenOptions
) {
  if (!entities || entities.length === 0) {
    console.warn('Cannot open property editor without entities');
    return;
  }
  restoreFocusAfterClose = options?.restoreFocus;
  onPropertyAddedForOpenEditor = options?.onPropertyAdded;
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
  onPropertyAddedForOpenEditor = undefined;
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

export async function notifyPropertyEditorPropertyAdded(
  addedDefinitionIds?: string[]
) {
  await onPropertyAddedForOpenEditor?.(addedDefinitionIds);
}

export function hasPropertyEditorPropertyAddedHandler() {
  return Boolean(onPropertyAddedForOpenEditor);
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
