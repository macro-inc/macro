import { mergeRefs } from '@solid-primitives/refs';
import { createDroppable } from '@thisbeyond/solid-dnd';
import { cn } from '@ui';
import { type JSX, Show, splitProps, useContext } from 'solid-js';
import { SectionDropIndicator } from './SectionDropIndicator';
import {
  SidebarSectionContext,
  SidebarSectionsContext,
} from './sidebar-section-context';

/** An identity-bearing section; navigation rows outside sections keep their slots. */
export function SidebarSection(
  props: JSX.HTMLAttributes<HTMLDivElement> & {
    id: string;
    label: string;
  }
) {
  const [local, rest] = splitProps(props, [
    'id',
    'label',
    'class',
    'classList',
    'children',
    'ref',
  ]);
  const parent = useContext(SidebarSectionsContext);
  const droppable =
    parent &&
    createDroppable(`${parent.reorder.scope}:${local.id}`, {
      dndScope: parent.reorder.scope,
      section: local.id,
    });
  const content = () => (
    <div
      {...rest}
      ref={mergeRefs(local.ref, (element) => droppable?.ref(element))}
      data-sidebar-section={local.id}
      class={cn('relative min-w-0 shrink-0', local.class)}
      classList={{
        ...local.classList,
        'opacity-40': parent?.reorder.isDragging(local.id),
      }}
    >
      <SidebarSectionsContext.Provider value={undefined}>
        {local.children}
      </SidebarSectionsContext.Provider>
      <SectionDropIndicator edge={parent?.reorder.dropEdge(local.id)} />
    </div>
  );
  return (
    <Show
      when={parent}
      fallback={
        <SidebarSectionContext.Provider value={undefined}>
          {content()}
        </SidebarSectionContext.Provider>
      }
    >
      {(context) => (
        <SidebarSectionContext.Provider
          value={{
            get id() {
              return local.id;
            },
            get label() {
              return local.label;
            },
            reorder: context().reorder,
          }}
        >
          {content()}
        </SidebarSectionContext.Provider>
      )}
    </Show>
  );
}
