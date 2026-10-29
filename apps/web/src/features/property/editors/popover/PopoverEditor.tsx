import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Match, Show, Switch } from 'solid-js';
import { useProperty } from '../../core/context';
import { DateEditor } from './DateEditor';
import { DateRangeEditor } from './DateRangeEditor';
import { EntityEditor, EntitySheetEditor } from './EntityEditor';
import { SelectEditor } from './SelectEditor';

type PopoverEditorProps = {
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
      <Match when={type() === 'DATE_RANGE'}>
        <DateRangeEditor />
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

/**
 * `PopoverEditor` for pills inside a touch sheet: ENTITY properties (people,
 * projects) pick in a `PickerSheet` stacked over it; dates and selects keep
 * their popovers.
 */
export function SheetEditor(props: PopoverEditorProps) {
  const ctx = useProperty();
  return (
    <Show
      when={ctx.property().valueType === 'ENTITY'}
      fallback={<PopoverEditor entitySelfFilter={props.entitySelfFilter} />}
    >
      <EntitySheetEditor selfFilter={props.entitySelfFilter} />
    </Show>
  );
}
