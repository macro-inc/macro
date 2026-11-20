import { createStore } from 'solid-js/store';

/** Keep the largest readable preview that leaves room for the task-list peek. */
export function descriptionLineLimit(
  availableHeight: number | undefined,
  lineHeight: number
) {
  if (
    availableHeight === undefined ||
    !Number.isFinite(lineHeight) ||
    lineHeight <= 0
  )
    return 8;
  return Math.max(5, Math.min(8, Math.floor(availableHeight / lineHeight)));
}

/** Track natural content overflow without remounting the expanded editor. */
export function createDescriptionClamp() {
  const [state, setState] = createStore({
    expanded: false,
    overflowing: false,
    lines: 8,
  });
  const measure = (
    scrollHeight: number,
    lineHeight: number,
    availableHeight?: number
  ) => {
    const lines = descriptionLineLimit(availableHeight, lineHeight);
    setState({ lines, overflowing: scrollHeight > lineHeight * lines + 1 });
  };
  return {
    expanded: () => state.expanded,
    overflowing: () => state.overflowing,
    lines: () => state.lines,
    toggle: () => setState('expanded', !state.expanded),
    expand: () => setState('expanded', true),
    measure,
  };
}
