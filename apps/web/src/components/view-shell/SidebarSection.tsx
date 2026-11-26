import { mergeRefs } from '@solid-primitives/refs';
import { createDroppable } from '@thisbeyond/solid-dnd';
import { cn } from '@ui';
import { type JSX, Show, splitProps, useContext } from 'solid-js';
import type { SectionReorder } from './primitives/create-section-reorder';
import { SectionDropIndicator } from './SectionDropIndicator';
import {
  SidebarSectionContext,
  SidebarSectionsContext,
} from './sidebar-section-context';

/** A section identity and drop target, or a pinned, non-droppable slot. */
export function SidebarSection(
  props: JSX.HTMLAttributes<HTMLElement> & {
    id: string;
    label: string;
    headerless?: boolean;
    pinned?: boolean;
  }
) {
  const [local, rest] = splitProps(props, [
    'id',
    'label',
    'headerless',
    'pinned',
    'class',
    'classList',
    'children',
    'ref',
  ]);
  const parent = useContext(SidebarSectionsContext);
  const render = (reorder?: SectionReorder) => {
    const droppable = reorder
      ? createDroppable(`${reorder.scope}:${local.id}`, {
          dndScope: reorder.scope,
          section: local.id,
        })
      : undefined;
    const content = () => (
      <SidebarSectionsContext.Provider value={undefined}>
        {local.children}
      </SidebarSectionsContext.Provider>
    );
    return (
      <SidebarSectionContext.Provider
        value={
          reorder && !local.headerless
            ? {
                get id() {
                  return local.id;
                },
                get label() {
                  return local.label;
                },
                reorder,
              }
            : undefined
        }
      >
        <section
          aria-label={local.label}
          {...rest}
          ref={mergeRefs(local.ref, (element) => droppable?.ref(element))}
          data-sidebar-section={local.id}
          data-sidebar-section-pinned={local.pinned ? 'true' : undefined}
          class={cn('relative min-w-0 shrink-0', local.class)}
          classList={{
            ...local.classList,
            'opacity-40': reorder?.isDragging(local.id),
          }}
        >
          {content()}
          <SectionDropIndicator edge={reorder?.dropEdge(local.id)} />
        </section>
      </SidebarSectionContext.Provider>
    );
  };
  return (
    <Show when={!local.pinned && parent} fallback={render()}>
      {(context) => render(context().reorder)}
    </Show>
  );
}
