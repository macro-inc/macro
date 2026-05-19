import { PropertyTooltip as CorePropertyTooltip } from '@core/component/Properties/component/propertyValue/PropertyTooltip';
import { HoverCard } from '@ui';
import type { JSX } from 'solid-js';
import type { Property } from '../types';

type Props = {
  property: Property;
  children: JSX.Element;
};

/**
 * Wraps children in a HoverCard showing the property's tooltip content.
 * The tooltip body is delegated to the existing CorePropertyTooltip so
 * consumers see the same content across migrations.
 */
export function PropertyTooltip(props: Props) {
  return (
    <HoverCard content={<CorePropertyTooltip property={props.property} />}>
      {props.children}
    </HoverCard>
  );
}
