import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Match, Switch } from 'solid-js';
import { useProperty } from '../../core/context';
import { DateEditor } from './DateEditor';
import { EntityEditor } from './EntityEditor';
import { SelectEditor } from './SelectEditor';

export type PopoverEditorProps = {
  /**
   * Forwarded to EntityEditor to filter the owning entity out of the picker.
   * Has no effect for non-entity properties.
   */
  entitySelfFilter?: { entityType: EntityType; blockId?: string };
};

/**
 * Dispatches to the right popover editor based on property.valueType. Renders
 * nothing for inline types (STRING / NUMBER / BOOLEAN / LINK) — those use
 * <Property.InlineEditor /> in place of a display.
 */
export function PopoverEditor(props: PopoverEditorProps) {
  const ctx = useProperty();
  const type = () => ctx.property().valueType;

  return (
    <Switch>
      <Match when={type() === 'DATE'}>
        <DateEditor />
      </Match>
      <Match when={type() === 'SELECT_STRING' || type() === 'SELECT_NUMBER'}>
        <SelectEditor />
      </Match>
      <Match when={type() === 'ENTITY'}>
        <EntityEditor selfFilter={props.entitySelfFilter} />
      </Match>
    </Switch>
  );
}
