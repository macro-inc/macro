import { useMaybeBlockId } from '@core/block';
import { Property, type PropertyApiValues, useProperty } from '@property';
import { createEffect, onMount } from 'solid-js';
import { usePropertiesContext } from '../../context/PropertiesContext';
import type { PropertyEditorProps } from '../../types';

/**
 * Bridge from the legacy PropertiesContext modal stack to the new
 * @property primitives. Mounts <Property.Root> with the saved property,
 * forwards saves through PropertiesContext's saveHandler, and auto-opens the
 * popover editor against the click anchor. When the local editor closes
 * (ESC / click-out / save-on-close), notifies the legacy stack to clear its
 * modal state.
 *
 * Inline-edit-only types (STRING / NUMBER / BOOLEAN / LINK) never route here
 * — they edit in place. This bridge therefore only renders the popover
 * editors (DATE / SELECT_* / ENTITY).
 */
export function EditPropertyValueModal(props: PropertyEditorProps) {
  const { saveHandler, entityType } = usePropertiesContext();
  const blockId = useMaybeBlockId();

  const onSave = (
    p: Parameters<typeof saveHandler.saveProperty>[0],
    v: PropertyApiValues
  ) => saveHandler.saveProperty(p, v);

  return (
    <Property.Root
      property={props.property}
      canEdit
      onSave={onSave}
      onRefresh={props.onSaved}
    >
      <LegacyEditorBridge anchor={props.anchorRef} onExit={props.onClose} />
      <Property.PopoverEditor entitySelfFilter={{ entityType, blockId }} />
    </Property.Root>
  );
}

function LegacyEditorBridge(props: {
  anchor?: HTMLElement;
  onExit: () => void;
}) {
  const ctx = useProperty();
  let hasOpened = false;

  onMount(() => {
    ctx.openEditor(props.anchor);
  });

  createEffect(() => {
    if (ctx.editorOpen()) {
      hasOpened = true;
    } else if (hasOpened) {
      props.onExit();
    }
  });

  return null;
}
