import {
  lexicalPinnedPropertyStore,
  nativePinnedPropertyStore,
  type PinnedPropertyStore,
} from '@core/component/LexicalMarkdown/plugins/pinned-properties/native';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { resolvePinnedPropertyIds } from '@property/core/pinned-property-ids';
import type { Property } from '@property/types';
import type { LexicalEditor } from 'lexical';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';

/** The pin store of whichever engine mounted the document body. */
export function createDocumentPinnedPropertyStore(body: {
  readonly editor: Accessor<LexicalEditor | undefined>;
  readonly nativeView: Accessor<EditorView | undefined>;
}): Accessor<PinnedPropertyStore | undefined> {
  return createMemo(() => {
    const editor = body.editor();
    if (editor) return lexicalPinnedPropertyStore(editor);
    const view = body.nativeView();
    return view ? nativePinnedPropertyStore(view) : undefined;
  });
}

/** Observe and update the pins persisted in the collaborative document. */
export function createPinnedProperties(
  store: Accessor<PinnedPropertyStore | undefined>,
  defaultDefinitionIds: Accessor<readonly string[]> = () => []
) {
  const [ids, setIds] = createSignal<string[] | undefined>();
  createEffect(() => {
    const current = store();
    if (!current) {
      setIds(undefined);
      return;
    }
    setIds(current.read());
    onCleanup(
      current.subscribe(() => {
        setIds(current.read());
      })
    );
  });
  const update = (
    id: string,
    properties: readonly Property[],
    pin: boolean,
    propertyDefinitionId?: string
  ) => {
    const current = store();
    if (!current) return;
    const defaults = defaultDefinitionIds();
    const definitionId =
      propertyDefinitionId ??
      properties.find((property) => property.propertyId === id)
        ?.propertyDefinitionId;
    current.update((storedIds) => {
      const selected = resolvePinnedPropertyIds(
        properties,
        storedIds,
        defaults
      );
      const operations: { id: string; pin: boolean }[] = [];
      // Materialize defaults and resolve placeholder IDs using the existing commands.
      for (const propertyId of selected) {
        if (!storedIds?.includes(propertyId)) {
          operations.push({ id: propertyId, pin: true });
        }
      }
      for (const propertyId of storedIds ?? []) {
        if (!selected.includes(propertyId)) {
          operations.push({ id: propertyId, pin: false });
        }
      }
      operations.push({ id, pin });
      if (!pin && definitionId) {
        operations.push({ id: `pending:${definitionId}`, pin: false });
      }
      return operations;
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
