/** Scroll only enough to expose a picker without losing its triggering row. */
export function revealWhenPicker(
  scroll: HTMLElement | undefined,
  row: HTMLElement,
  picker: HTMLElement,
  footerSpace = 24
) {
  if (!scroll) return;
  const viewport = scroll.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();
  const pickerBox = picker.getBoundingClientRect();
  const needed = Math.max(
    0,
    pickerBox.bottom - (viewport.bottom - footerSpace)
  );
  const allowed = Math.max(0, rowBox.top - viewport.top);
  scroll.scrollTop += Math.min(needed, allowed);
}
