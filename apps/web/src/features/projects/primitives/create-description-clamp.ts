import { createStore } from 'solid-js/store';

/** Keep the disclosure available while expanded, even though overflow disappears. */
export function createDescriptionClamp() {
  const [state, setState] = createStore({
    expanded: false,
    overflowing: false,
  });
  const measure = (scrollHeight: number, collapsedHeight: number) => {
    if (state.expanded) return;
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
