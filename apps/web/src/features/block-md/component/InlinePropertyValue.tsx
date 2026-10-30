import PushPinSlashIcon from '@icon/system/regular/push-pin-slash.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import { PropertyValuePill } from '@property/component/PropertyValuePill';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { usePropertiesContext } from '@property/context/PropertiesContext';
import { openPropertyEditor } from '@property/editor/state/propertyEditor';
import type { Property as PropertyT } from '@property/types';
import { Button } from '@ui';
import { type Component, createSignal, type JSX, Show } from 'solid-js';

type InlinePropertyValueProps = {
  property: PropertyT;
  /** Owning entity ID, when the pill is rendered outside its entity block. */
  entityId?: string;
  /** Label rendered when the property is empty. Defaults to "None". */
  emptyLabel?: JSX.Element;
  class?: string;
  canManage?: boolean;
  canRemove?: boolean;
};

/**
 * Inline property pill shown beneath a task title when the side panel is
 * closed. Built from @property primitives — same visual surface as before,
 * but routes through Property.Root / Tooltip / Pill so any property
 * type renders correctly without bespoke per-type components.
 */
export const InlinePropertyValue: Component<InlinePropertyValueProps> = (
  props
) => {
  const ctx = usePropertiesContext();
  const usesInlineEditor = () =>
    ['STRING', 'NUMBER', 'BOOLEAN', 'LINK'].includes(props.property.valueType);
  const canManage = () =>
    props.canManage && ctx.canEdit && !props.property.isMetadata;
  const [removing, setRemoving] = createSignal(false);
  const remove = async () => {
    if (!ctx.removeProperty || removing()) return;
    setRemoving(true);
    try {
      await ctx.removeProperty(props.property.propertyId);
      ctx.onPropertyUnpinned?.(
        props.property.propertyId,
        props.property.propertyDefinitionId
      );
      ctx.onPropertyDeleted();
    } catch {
      // The shared removal mutation reports the failure and keeps the property.
    } finally {
      setRemoving(false);
    }
  };

  return (
    <PropertyValuePill
      property={props.property}
      variant="secondary"
      size="xs"
      showLabel={
        props.property.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.STATUS &&
        props.property.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.PRIORITY &&
        !(
          ctx.entityType === 'TASK' &&
          (props.property.propertyDefinitionId ===
            SYSTEM_PROPERTY_IDS.ASSIGNEES ||
            props.property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PROJECT)
        )
      }
      canEdit={ctx.canEdit}
      onSave={ctx.saveHandler.saveProperty}
      onEdit={
        props.entityId && usesInlineEditor()
          ? (property, anchor) =>
              openPropertyEditor(
                [
                  {
                    id: props.entityId!,
                    name: ctx.documentName ?? 'Document',
                    entityType: ctx.entityType,
                  },
                ],
                'direct',
                property,
                { restoreFocus: () => anchor?.focus() }
              )
          : undefined
      }
      class={props.class}
      emptyLabel={props.emptyLabel}
      hoverTrailingAction={
        <Show when={canManage()}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Unpin"
            disabled={removing()}
            onClick={() =>
              ctx.onPropertyUnpinned?.(
                props.property.propertyId,
                props.property.propertyDefinitionId
              )
            }
          >
            <PushPinSlashIcon class="size-3.5 shrink-0" />
          </Button>
        </Show>
      }
      hoverActions={
        <Show when={canManage() && props.canRemove !== false}>
          <button
            type="button"
            class="flex w-full min-w-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-failure-ink hover:bg-hover disabled:opacity-50"
            disabled={removing()}
            onClick={remove}
          >
            <TrashIcon class="size-3.5 shrink-0" />
            {removing() ? 'Deleting…' : 'Delete from item'}
          </button>
        </Show>
      }
      entitySelfFilter={{ entityType: ctx.entityType, blockId: props.entityId }}
    />
  );
};
