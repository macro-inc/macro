import { registerHotkey } from '@core/hotkey/hotkeys';
import type { RegisterHotkeyReturn, ValidHotkey } from '@core/hotkey/types';
import GridIcon from '@phosphor/dots-nine.svg';
import type { ChromeDestination } from './chrome-destinations';

/** Position keys for the center row, in the order the views are rendered. */
export const VIEW_NUMBER_KEYS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
] as const satisfies readonly ValidHotkey[];

/**
 * Roles whose own keyboard handling owns these keys — a dialog's focus trap,
 * a menu's roving focus — so the bar leaves them alone while focus sits
 * inside one.
 */
const OVERLAY_ROLE_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

const isFocusInsideOverlay = () => {
  const focused = document.activeElement;
  return (
    focused instanceof Element &&
    focused.closest(OVERLAY_ROLE_SELECTOR) !== null
  );
};

export type ChromeViewHotkeyOptions = {
  /** The views in the center row, in the order they are rendered. */
  views: () => readonly ChromeDestination[];
  isActive: (destination: ChromeDestination) => boolean;
  openView: (destination: ChromeDestination) => void;
};

/**
 * A chrome bar's keyboard contract, kept out of the component so it can be
 * exercised against the real hotkey system: Tab and Shift+Tab step through the
 * row, and a digit jumps straight to that position in it — 1 is Activity, 3 is
 * Email. The soup views stand their own bindings on these keys down while the
 * bar is up, so the keys reach here from a focused split.
 *
 * Returns the registrations; the caller disposes them.
 */
export function registerChromeViewHotkeys(
  options: ChromeViewHotkeyOptions
): RegisterHotkeyReturn[] {
  /**
   * Step through the row, wrapping at both ends. With no view active — a
   * document is open, say — forwards lands on the first and backwards on the
   * last.
   */
  const cycle = (step: 1 | -1) => {
    const views = options.views();
    if (views.length === 0) return false;

    const current = views.findIndex(options.isActive);
    const next =
      current === -1
        ? step === 1
          ? 0
          : views.length - 1
        : (current + step + views.length) % views.length;

    options.openView(views[next]!);
    return true;
  };

  const cycleRegistrations = (
    [
      ['tab', 1, 'Next view'],
      ['shift+tab', -1, 'Previous view'],
    ] as const
  ).map(([hotkey, step, description]) =>
    registerHotkey({
      hotkey,
      scopeId: 'global',
      description,
      condition: () => options.views().length > 1 && !isFocusInsideOverlay(),
      keyDownHandler: () => cycle(step),
      icon: GridIcon,
      keywords: ['view', 'views', 'switch', 'cycle', 'app bar'],
    })
  );

  const numberRegistrations = VIEW_NUMBER_KEYS.map((hotkey, index) =>
    registerHotkey({
      hotkey,
      scopeId: 'global',
      description: () => `Go to ${options.views()[index]?.label ?? 'view'}`,
      condition: () =>
        options.views().length > index && !isFocusInsideOverlay(),
      keyDownHandler: () => {
        const destination = options.views()[index];
        if (!destination) return false;
        options.openView(destination);
        return true;
      },
      hide: () => options.views().length <= index,
      icon: GridIcon,
      keywords: ['view', 'views', 'switch', 'go to', 'app bar'],
    })
  );

  return [...cycleRegistrations, ...numberRegistrations];
}
