import { useMaybeBlockId } from '@core/block';
import { Property } from '@property';
import type { Component } from 'solid-js';
import { usePropertiesContext } from '../../context/PropertiesContext';
import type { Property as PropertyT } from '../../types';
import { PropertyLabel } from './PropertyLabel';

interface PropertyRowProps {
  property: PropertyT;
  withDelete?: boolean;
  withPin?: boolean;
}

/**
 * Panel row: label + value. Value uses Property.Display, which composes
 * display + inline/popover editing entirely from primitives — the legacy
 * PropertiesContext modal stack is bypassed here. Saves still route through
 * the panel's saveHandler (bulk-save mutation).
 */
export const PropertyRow: Component<PropertyRowProps> = (props) => {
  const { saveHandler, entityType, onRefresh } = usePropertiesContext();
  const blockId = useMaybeBlockId();

  return (
    <>
      <div class="flex items-start min-w-0">
        <PropertyLabel
          property={props.property}
          withDelete={props.withDelete}
          withPin={props.withPin}
        />
      </div>
      <div class="ph-no-capture flex items-start min-w-0">
        <Property.Root
          property={props.property}
          canEdit
          onSave={(p, v) => saveHandler.saveProperty(p, v)}
          onRefresh={onRefresh}
        >
          <Property.Display entitySelfFilter={{ entityType, blockId }} />
        </Property.Root>
      </div>
    </>
  );
};
