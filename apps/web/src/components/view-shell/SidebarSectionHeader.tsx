import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type JSX, Show, useContext } from 'solid-js';
import { SidebarSectionDragHandle } from './SidebarSectionDragHandle';
import { SidebarSectionContext } from './sidebar-section-context';

/** Share Chat's mouse and keyboard handle without changing the header's controls. */
export function SidebarSectionHeader(props: { children: JSX.Element }) {
  const section = useContext(SidebarSectionContext);
  return (
    <Show when={section} fallback={props.children}>
      {(context) => (
        <SidebarSectionDragHandle
          section={context().id}
          label={context().label}
          reorder={context().reorder}
          disabled={isTouchDevice()}
        >
          {props.children}
        </SidebarSectionDragHandle>
      )}
    </Show>
  );
}
