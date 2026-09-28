/** Honor an explicitly declared input instead of the popover's first toolbar button. */
export function focusPopoverInput(event: Event, container: HTMLElement | null) {
  if (event.defaultPrevented) return;
  const input = container?.querySelector<HTMLElement>(
    '[autofocus]:not(:disabled)'
  );
  if (!input) return;
  input.focus({ preventScroll: true });
  if (document.activeElement === input) event.preventDefault();
}
