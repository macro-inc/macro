import { PropertyTooltip as CorePropertyTooltip } from '@property/component/propertyValue/PropertyTooltip';
import { HoverCard } from '@ui';
import { children, type JSX, Show, useContext } from 'solid-js';
import { PropertyRootContext } from '../core/context';
import type { Property } from '../types';

type Props = {
  property: Property;
  children: JSX.Element;
  trailingAction?: JSX.Element;
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
 *
 * An editable property's control is inside the trigger, which is then no tab
 * stop of its own: focus there looks like it is on the value, but neither Enter
 * nor Space reaches the editor. A read-only row can have no control inside, so
 * its trigger stays the keyboard's way to this content.
 */
export function PropertyTooltip(props: Props) {
  const ctx = useContext(PropertyRootContext);
  const actions = children(() => props.actions);
  const trailingAction = children(() => props.trailingAction);
  const hasActions = () =>
    actions.toArray().length > 0 || trailingAction.toArray().length > 0;
  const isEditable = () => ctx?.canEdit() && !ctx.property().isMetadata;
  return (
    <HoverCard
      triggerClass="min-w-0 max-w-full"
      triggerTabIndex={isEditable() ? -1 : undefined}
      content={
        <div class="min-w-0">
          <CorePropertyTooltip
            property={props.property}
            trailingAction={trailingAction()}
          />
          <Show when={actions.toArray().length > 0}>
            <div class="mt-2 border-t border-edge-muted pt-1.5">
              {actions()}
            </div>
          </Show>
        </div>
      }
      disabled={ctx?.editorOpen() ?? false}
      placement={hasActions() ? 'bottom-start' : 'bottom'}
      contentClass={hasActions() ? undefined : 'menu-surface p-1.5 px-3'}
    >
      {props.children}
    </HoverCard>
  );
}
