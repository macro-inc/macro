import { Match, Switch } from 'solid-js';
import { useProperty } from '../../core/context';
import { InlineBooleanEditor } from './InlineBooleanEditor';
import { InlineLinkEditor } from './InlineLinkEditor';
import { InlineNumberEditor } from './InlineNumberEditor';
import { InlineTextEditor } from './InlineTextEditor';

/**
 * Dispatches to the right inline editor based on property.valueType. Renders
 * nothing for popover-only types (DATE / SELECT_* / ENTITY) — those need an
 * <EditTrigger> + <PopoverEditor> pair instead.
 */
export function InlineEditor() {
  const ctx = useProperty();
  const type = () => ctx.property().valueType;

  return (
    <Switch>
      <Match when={type() === 'STRING'}>
        <InlineTextEditor />
      </Match>
      <Match when={type() === 'NUMBER'}>
        <InlineNumberEditor />
      </Match>
      <Match when={type() === 'BOOLEAN'}>
        <InlineBooleanEditor />
      </Match>
      <Match when={type() === 'LINK'}>
        <InlineLinkEditor />
      </Match>
    </Switch>
  );
}
