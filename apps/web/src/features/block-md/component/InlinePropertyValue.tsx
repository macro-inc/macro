import { PropertyValuePill } from '@property/component/PropertyValuePill';
import { usePropertiesContext } from '@property/context/PropertiesContext';
import type { Property as PropertyT } from '@property/types';
import type { Component, JSX } from 'solid-js';

type InlinePropertyValueProps = {
  property: PropertyT;
  /** Owning entity ID, when the pill is rendered outside its entity block. */
  entityId?: string;
  /** Label rendered when the property is empty. Defaults to "None". */
  emptyLabel?: JSX.Element;
  class?: string;
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

  return (
    <PropertyValuePill
      property={props.property}
      canEdit={ctx.canEdit}
      onSave={ctx.saveHandler.saveProperty}
      onRefresh={ctx.onRefresh}
      class={props.class}
      emptyLabel={props.emptyLabel}
      entitySelfFilter={{ entityType: ctx.entityType, blockId: props.entityId }}
    />
  );
};
