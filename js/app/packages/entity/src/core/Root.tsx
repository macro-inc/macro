import { entityIdAttribute } from '@core/dom-selectors';
import { cn } from '@ui';
import { type JSX, splitProps } from 'solid-js';
import type { EntityData } from '../types/entity';

export function Root(
  props: JSX.HTMLAttributes<HTMLDivElement> & { entity: EntityData }
) {
  const [local, rest] = splitProps(props, ['children', 'class', 'entity']);

  return (
    <div
      class={cn('entity-root group/entity', local.class)}
      data-entity
      {...entityIdAttribute(local.entity.id)}
      {...rest}
    >
      {local.children}
    </div>
  );
}
