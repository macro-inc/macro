/**
 * Outside presses on open event details.
 *
 * The details popover is non-modal, so the press that dismisses it also lands
 * on the grid. FullCalendar starts a date selection on mousedown and reports
 * it on mouseup — after the popover has already closed on pointerdown — which
 * opens a new event. Google Calendar consumes that press: the details close,
 * and a later press is what creates.
 */

const DATE_SELECTION_BLOCKERS = [
  '.fc-event:not(.fc-bg-event)',
  '.fc-more-link',
  'a[data-navlink]',
  '.fc-popover',
].join(', ');

export type OpenEventOutsidePress =
  | 'keep-open'
  | 'close'
  | 'close-without-creating';

/** Whether this grid press is one FullCalendar would turn into a new event. */
export function pointerDownStartsCalendarDateSelection(
  target: EventTarget | null
): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('.calendar-view .fc') === null) return false;
  return target.closest(DATE_SELECTION_BLOCKERS) === null;
}

/**
 * How an outside press on open event details should resolve.
 *
 * Event chips and explicit event targets keep the details up so the click can
 * switch selection. A primary mouse/pen press on empty grid time closes the
 * details and must not start a new event. Touch closes only — phones do not
 * create from a grid press, and canceling the pointer would swallow the tap
 * that dismisses the sheet.
 */
export function classifyOpenEventOutsidePress(
  event: Event
): OpenEventOutsidePress {
  const target = event.target;
  if (!(target instanceof Element)) return 'close';
  if (
    target.closest('.fc-event') !== null ||
    target.closest('[data-calendar-event-target-navigation]') !== null
  ) {
    return 'keep-open';
  }
  if (
    event instanceof PointerEvent &&
    event.button === 0 &&
    event.pointerType !== 'touch' &&
    pointerDownStartsCalendarDateSelection(target)
  ) {
    return 'close-without-creating';
  }
  return 'close';
}

let suppressCalendarCreate = false;
let clearSuppressTimer: ReturnType<typeof setTimeout> | undefined;
let removePointerEndListener: (() => void) | undefined;

/**
 * Ignore the date selection this gesture is about to report.
 *
 * Cleared on the timer after pointerup, which is dispatched before mouseup, so
 * the selection callback still observes the flag and a later press does not.
 */
export function armSuppressedCalendarDateSelection() {
  suppressCalendarCreate = true;
  removePointerEndListener?.();
  const onPointerEnd = () => {
    removePointerEndListener?.();
    clearTimeout(clearSuppressTimer);
    clearSuppressTimer = setTimeout(() => {
      suppressCalendarCreate = false;
      clearSuppressTimer = undefined;
    }, 0);
  };
  document.addEventListener('pointerup', onPointerEnd, true);
  document.addEventListener('pointercancel', onPointerEnd, true);
  removePointerEndListener = () => {
    document.removeEventListener('pointerup', onPointerEnd, true);
    document.removeEventListener('pointercancel', onPointerEnd, true);
    removePointerEndListener = undefined;
  };
}

/** Whether the in-flight outside press should not open the event composer. */
export function consumeSuppressedCalendarDateSelection() {
  if (!suppressCalendarCreate) return false;
  suppressCalendarCreate = false;
  clearTimeout(clearSuppressTimer);
  clearSuppressTimer = undefined;
  return true;
}

/** Applies {@link classifyOpenEventOutsidePress} to a popover outside event. */
export function handleOpenEventOutsidePress(event: {
  preventDefault: () => void;
  detail: { originalEvent: Event };
}) {
  const action = classifyOpenEventOutsidePress(event.detail.originalEvent);
  if (action === 'keep-open') {
    // FullCalendar and external calendar target controls select on click
    // (pointer release), so dismissing on pointer down would briefly close
    // the popover before navigation finishes.
    event.preventDefault();
    return;
  }
  if (action === 'close-without-creating') {
    // Cancelling the pointerdown drops the compatibility mousedown, so
    // FullCalendar never starts a date selection on this press.
    event.detail.originalEvent.preventDefault();
    armSuppressedCalendarDateSelection();
  }
}
