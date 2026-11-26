/** Scroll only the menu viewport; scrollIntoView can also move the composer and its anchor. */
export function revealTimeOption(
  list: HTMLElement | undefined,
  center: boolean,
  viewport: HTMLElement | undefined = list?.parentElement ?? undefined
) {
  const option = list?.querySelector<HTMLElement>('[data-highlighted]');
  if (!viewport || !option) return;
  const bounds = viewport.getBoundingClientRect();
  const item = option.getBoundingClientRect();
  // Menu enter animations scale the bounding rect, but scrollTop stays in layout pixels.
  const scale = bounds.height / viewport.offsetHeight || 1;
  const top = (item.top - bounds.top) / scale;
  const bottom = top + option.offsetHeight;
  if (center)
    viewport.scrollTop +=
      top - (viewport.clientHeight - option.offsetHeight) / 2;
  else if (top < 0) viewport.scrollTop += top;
  else if (bottom > viewport.clientHeight)
    viewport.scrollTop += bottom - viewport.clientHeight;
}

/** Recenter after the popper computes its available height or the keyboard resizes it. */
export function observeTimeOptionViewport(list: HTMLElement) {
  const observer = new ResizeObserver(() => {
    const viewport = list.parentElement;
    if (!list.isConnected || !viewport) return;
    const option = list.querySelector<HTMLElement>('[role="option"]');
    const padding = Math.max(
      0,
      (viewport.clientHeight - (option?.offsetHeight ?? 32)) / 2
    );
    list.style.paddingBlock = `${padding}px`;
    revealTimeOption(list, true);
  });
  if (list.parentElement) observer.observe(list.parentElement);
  return () => observer.disconnect();
}
