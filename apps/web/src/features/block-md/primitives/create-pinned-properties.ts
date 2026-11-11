import {
  $getStoredPinnedProperties,
  ADD_PINNED_PROPERTY_COMMAND,
  REMOVE_PINNED_PROPERTY_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/pinned-properties/pinnedPropertiesPlugin';
import { resolvePinnedPropertyIds } from '@property/core/pinned-property-ids';
import type { Property } from '@property/types';
import type { LexicalEditor } from 'lexical';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

/** Observe and update the pins persisted in the collaborative document. */
export function createPinnedProperties(
  editor: Accessor<LexicalEditor | undefined>,
  defaultDefinitionIds: Accessor<readonly string[]> = () => []
) {
  const [ids, setIds] = createSignal<string[] | undefined>();
  createEffect(() => {
    const current = editor();
    if (!current) {
      setIds(undefined);
      return;
    }
    current.getEditorState().read(() => setIds($getStoredPinnedProperties()));
    onCleanup(
      current.registerUpdateListener(({ editorState }) => {
        editorState.read(() => setIds($getStoredPinnedProperties()));
      })
    );
  });
  const update = (
    id: string,
    properties: readonly Property[],
    pin: boolean,
    propertyDefinitionId?: string
  ) => {
    const current = editor();
    if (!current) return;
    const defaults = defaultDefinitionIds();
    const definitionId =
      propertyDefinitionId ??
      properties.find((property) => property.propertyId === id)
        ?.propertyDefinitionId;
    current.update(() => {
      const storedIds = $getStoredPinnedProperties();
      const selected = resolvePinnedPropertyIds(
        properties,
        storedIds,
        defaults
      );
      // Materialize defaults and resolve placeholder IDs using the existing commands.
      for (const propertyId of selected) {
        if (!storedIds?.includes(propertyId)) {
          current.dispatchCommand(ADD_PINNED_PROPERTY_COMMAND, propertyId);
        }
      }
      for (const propertyId of storedIds ?? []) {
        if (!selected.includes(propertyId)) {
          current.dispatchCommand(REMOVE_PINNED_PROPERTY_COMMAND, propertyId);
        }
      }
      current.dispatchCommand(
        pin ? ADD_PINNED_PROPERTY_COMMAND : REMOVE_PINNED_PROPERTY_COMMAND,
        id
      );
      if (!pin && definitionId) {
        current.dispatchCommand(
          REMOVE_PINNED_PROPERTY_COMMAND,
          `pending:${definitionId}`
        );
      }
    });
  };
  return {
    ids,
    pin: (id: string, properties: readonly Property[] = []) =>
      update(id, properties, true),
    unpin: (
      id: string,
      properties: readonly Property[] = [],
      definitionId?: string
    ) => update(id, properties, false, definitionId),
  };
}
