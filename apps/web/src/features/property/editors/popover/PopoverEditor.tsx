import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Match, Switch } from 'solid-js';
import { useProperty } from '../../core/context';
import { DateEditor, DateSheetEditor } from './DateEditor';
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
 * projects) and dates pick in a `PickerSheet` stacked over it; selects keep
 * their popovers, which fit above the keyboard.
 */
export function SheetEditor(props: PopoverEditorProps) {
  const ctx = useProperty();
  const type = () => ctx.property().valueType;
  return (
    <Switch
      fallback={<PopoverEditor entitySelfFilter={props.entitySelfFilter} />}
    >
      <Match when={type() === 'ENTITY'}>
        <EntitySheetEditor selfFilter={props.entitySelfFilter} />
      </Match>
      <Match when={type() === 'DATE'}>
        <DateSheetEditor />
      </Match>
    </Switch>
  );
}
