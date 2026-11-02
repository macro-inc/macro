import { entityIdAttribute } from '@core/dom-selectors';
import { mergeRefs } from '@solid-primitives/refs';
import { cn } from '@ui';
import { type JSX, splitProps } from 'solid-js';
import type { EntityData } from '../types/entity';

const ENTITY_DATA = Symbol('entity-data');
type EntityElement = HTMLDivElement & { readonly [ENTITY_DATA]: EntityData };

function hasEntity(element: Element): element is EntityElement {
  return ENTITY_DATA in element;
}

/** Read the row's current model at a delegated DOM event boundary. */
export function entityFromElement(element: Element): EntityData | undefined {
  return hasEntity(element) ? element[ENTITY_DATA] : undefined;
}

export function Root(
  props: JSX.HTMLAttributes<HTMLDivElement> & { entity: EntityData }
) {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'entity',
    'ref',
  ]);
  return (
    <div
      class={cn('entity-root group/entity', local.class)}
      data-entity
      ref={mergeRefs(local.ref, (element: HTMLDivElement) => {
        Object.defineProperty(element, ENTITY_DATA, {
          get: () => local.entity,
        });
      })}
      {...entityIdAttribute(local.entity.id)}
      {...rest}
    >
      {local.children}
    </div>
  );
}
