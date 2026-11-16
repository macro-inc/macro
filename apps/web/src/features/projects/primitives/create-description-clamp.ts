import { createStore } from 'solid-js/store';

/** Track natural content overflow without remounting the expanded editor. */
export function createDescriptionClamp() {
  const [state, setState] = createStore({
    expanded: false,
    overflowing: false,
  });
  const measure = (scrollHeight: number, collapsedHeight: number) => {
    setState('overflowing', scrollHeight > collapsedHeight + 1);
  };
  return {
    expanded: () => state.expanded,
    overflowing: () => state.overflowing,
    toggle: () => setState('expanded', !state.expanded),
    expand: () => setState('expanded', true),
    measure,
  };
}
