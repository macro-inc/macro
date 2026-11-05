import { useQuickAccess } from '@core/context/quickAccess';
import { Property } from '@property';
import type { EntityProperty, PropertyApiValues } from '@property/types';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { createMemo } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  customerContactReferences,
  customerContactSelection,
  customerContactValues,
} from '../core/customer-contact';

const ENTITY_TYPES: EntityType[] = ['COMPANY', 'CONTACT'];

/**
 * One dropdown over the Companies and Contacts properties. It edits a single
 * pick, shown as the contact when there is one, and writes both properties.
 */
export function CustomerContactPill(props: {
  values: Record<string, PropertyApiValues>;
  onChange: (values: Record<string, PropertyApiValues>) => void;
  /** The editor the pill opens; `Property.SheetEditor` inside a touch sheet. */
  editor: typeof Property.PopoverEditor;
}) {
  const contacts = useQuickAccess().useList('crm_contact').items;

  const property = createMemo(
    (): EntityProperty => ({
      propertyId: 'compose-customer-contact',
      propertyDefinitionId: 'customer-contact',
      displayName: 'Customer / Contact',
      isMultiSelect: false,
      owner: { scope: 'system' },
      updatedAt: new Date(0),
      createdAt: new Date(0),
      valueType: 'ENTITY',
      value: customerContactSelection(props.values),
    })
  );

  const save = async (_: unknown, value: PropertyApiValues) => {
    const picked = value.valueType === 'ENTITY' ? value.refs?.[0] : undefined;
    const contact = contacts().find((item) => item.id === picked?.entity_id);
    props.onChange(customerContactValues(picked, contact?.data.companyId));
  };

  return (
    <Property.Root property={property()} canEdit onSave={save}>
      {(shown) => (
        <>
          {/* The hover card names both records, as the pill shows only one. */}
          <Property.Tooltip
            property={{
              ...property(),
              isMultiSelect: true,
              value: customerContactReferences(props.values),
            }}
          >
            <Property.Pill variant="secondary" size="xs">
              <Property.Text
                property={shown()}
                resolveSingleEntity
                class="min-w-0 max-w-60"
                fallback={
                  <Property.Empty
                    propertyDefinitionId={shown().propertyDefinitionId}
                    label={shown().displayName}
                    iconClass="size-3 touch:size-4 shrink-0"
                  />
                }
              />
              <Property.Caret />
            </Property.Pill>
          </Property.Tooltip>
          <Dynamic component={props.editor} entityTypes={ENTITY_TYPES} />
        </>
      )}
    </Property.Root>
  );
}
