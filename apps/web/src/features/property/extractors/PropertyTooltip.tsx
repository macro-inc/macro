import { PropertyTooltip as CorePropertyTooltip } from '@property/component/propertyValue/PropertyTooltip';
import { HoverCard } from '@ui';
import { type JSX, useContext } from 'solid-js';
import { PropertyRootContext } from '../core/context';
import type { Property } from '../types';

type Props = {
  property: Property;
  children: JSX.Element;
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
  return (
    <HoverCard
      content={<CorePropertyTooltip property={props.property} />}
      disabled={ctx?.editorOpen() ?? false}
    >
      {props.children}
    </HoverCard>
  );
}
