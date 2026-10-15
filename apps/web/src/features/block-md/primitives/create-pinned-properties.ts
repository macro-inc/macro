import {
  $getStoredPinnedProperties,
  UPDATE_PINNED_PROPERTIES_COMMAND,
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
    current.dispatchCommand(UPDATE_PINNED_PROPERTIES_COMMAND, (storedIds) => {
      const selected = resolvePinnedPropertyIds(
        properties,
        storedIds,
        defaults
      );
      return pin
        ? selected.includes(id)
          ? [...selected]
          : [...selected, id]
        : selected.filter(
            (selectedId) =>
              selectedId !== id && selectedId !== `pending:${definitionId}`
          );
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
