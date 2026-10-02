import { PropertyTooltip as CorePropertyTooltip } from '@property/component/propertyValue/PropertyTooltip';
import { HoverCard } from '@ui';
import { children, type JSX, Show, useContext } from 'solid-js';
import { PropertyRootContext } from '../core/context';
import type { Property } from '../types';

type Props = {
  property: Property;
  children: JSX.Element;
  actions?: JSX.Element;
};

/**
 * Wraps children in a HoverCard showing the property's tooltip content.
 * The tooltip body is delegated to the existing CorePropertyTooltip so
 * consumers see the same content across migrations.
 *
 * Suppresses the hover card while the editor popover is open (clicking the
 * pill opens the popover anchored to the same trigger) so a click dismisses
 * the hover card instead of stacking both surfaces. Reads the optional
 * <Property.Root> context directly so it still works when used standalone.
 */
export function PropertyTooltip(props: Props) {
  const ctx = useContext(PropertyRootContext);
  const actions = children(() => props.actions);
  const hasActions = () => actions.toArray().length > 0;
  return (
    <HoverCard
      content={
        <div class="min-w-0">
          <CorePropertyTooltip property={props.property} />
          <Show when={hasActions()}>
            <div class="mt-2 border-t border-edge-muted pt-1.5">
              {actions()}
            </div>
          </Show>
        </div>
      }
      disabled={ctx?.editorOpen() ?? false}
      placement={hasActions() ? 'bottom-start' : 'bottom'}
      contentClass={
        hasActions() ? undefined : 'rounded-xl p-1.5 px-3 glass bg-menu-glass'
      }
    >
      {props.children}
    </HoverCard>
  );
}
