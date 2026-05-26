import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Match, Switch } from 'solid-js';
import { useProperty } from '../core/context';
import { InlineEditor } from './inline/InlineEditor';
import { PopoverEditor } from './popover/PopoverEditor';

type PropertyEditorProps = {
  /**
   * Forwarded to entity popover editor. Has no effect for non-entity types.
   */
  entitySelfFilter?: { entityType: EntityType; blockId?: string };
};

/**
 * Auto-dispatch editor — picks inline vs popover by valueType.
 *
 * Inline types (STRING, NUMBER, BOOLEAN, LINK) render their own display + edit
 * surface in place of any sibling display extractors. Popover types (DATE,
 * SELECT_*, ENTITY) render nothing until opened (via a sibling
 * <Property.EditTrigger>) — pair them with display extractors.
 */
export function PropertyEditor(props: PropertyEditorProps) {
  const ctx = useProperty();
  const type = () => ctx.property().valueType;

  const isInline = () =>
    type() === 'STRING' ||
    type() === 'NUMBER' ||
    type() === 'BOOLEAN' ||
    type() === 'LINK';

  return (
    <Switch>
      <Match when={isInline()}>
        <InlineEditor />
      </Match>
      <Match when={!isInline()}>
        <PopoverEditor entitySelfFilter={props.entitySelfFilter} />
      </Match>
    </Switch>
  );
}
