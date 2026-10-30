import { focusStandInActive } from '@core/directive/focusInput';
import { isEditableInput } from '@core/util/isEditableInput';

/** Honor an explicitly declared input instead of the popover's first toolbar button. */
export function focusPopoverInput(event: Event, container: HTMLElement | null) {
  if (event.defaultPrevented) return;
  // Leave focus with the opening tap's stand-in, which holds the phone
  // keyboard until the content's own field mounts, or with that field once
  // it has focused itself.
  const active = document.activeElement;
  if (
    focusStandInActive() ||
    (container?.contains(active) && isEditableInput(active))
  ) {
    event.preventDefault();
    return;
  }
  const input = container?.querySelector<HTMLElement>(
    '[autofocus]:not(:disabled)'
  );
  if (!input) return;
  input.focus({ preventScroll: true });
  if (document.activeElement === input) event.preventDefault();
}
