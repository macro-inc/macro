import { type JSX, splitProps } from 'solid-js';
import { cn } from '@ui/utils/classname';
import type { EntityData } from '../types/entity';

export function Root(
  props: JSX.HTMLAttributes<HTMLDivElement> & { entity: EntityData }
) {
  const [local, rest] = splitProps(props, ['children', 'class', 'entity']);

  return (
    <div
      class={cn('entity-root group/entity', local.class)}
      data-entity
      data-entity-id={local.entity.id}
      {...rest}
    >
      {local.children}
    </div>
  );
}
