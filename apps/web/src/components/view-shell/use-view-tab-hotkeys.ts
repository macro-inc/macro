import { t } from '@app/lib/i18n';
import { appNavigationSelector } from '@core/dom-selectors';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { getScopeElement } from '@core/hotkey/utils';
import { isEditableInput } from '@core/util/isEditableInput';
import { onCleanup } from 'solid-js';

export type UseViewTabHotkeysOptions<TTab extends string> = {
  /**
   * The split's own hotkey scope (`splitRootScope(panel)`), never an inline
   * preview's: a key pressed on the split itself reaches only that one.
   */
  scopeId: string;
  /**
   * The tabs in the pane's top bar. The keys act only while this element is
   * on screen, so register beside the `Tabs` it names, never with a
   * sidebar's navigation.
   */
  tabs: () => HTMLElement | undefined;
  /** The tabs, left to right as they are drawn. */
  ids: () => readonly TTab[];
  activeId: () => TTab | undefined;
  setActiveId: (id: TTab) => void;
  /** A tab's visible name, for the shortcut sheet. */
  label: (id: TTab) => string;
  enabled?: () => boolean;
};

/**
 * Focus targets that stand for the pane itself rather than for one of its
 * controls: a container that owns keys (the split, a conversation's message
 * list, a list scope), a list whose rows take focus virtually, or a container
 * a view focuses to give its pane the keyboard, marked `data-pane-focus`.
 */
const PANE_FOCUS_SELECTOR =
  '[data-hotkey-scope], [data-pane-focus], [role="grid"], [role="treegrid"], [role="tree"], [role="listbox"], [role="table"]';

/**
 * Data grids and canvases that move by the arrow keys (a database's cells, a
 * slide stage) are content, not a list: a key there is never the pane's.
 */
const OWNS_ITS_KEYS_SELECTOR = '[data-owns-arrow-keys]';

/** The view-shell regions a split lays its list, sidebar and detail in. */
const PANE_REGION_SELECTOR =
  '[data-view-shell-list], [data-view-shell-main], [data-view-shell-aside], [data-view-shell-detail]';

/** A destination in a view sidebar's navigation: a folder, view or scope. */
const SIDEBAR_DESTINATION_SELECTOR =
  '[data-view-sidebar] nav [data-view-sidebar-item]';

/** A view on the app rail, which hands focus back to the split it shows. */
const RAIL_DESTINATION_SELECTOR = `${appNavigationSelector} button`;

/**
 * Destinations, or controls inside one, that open or disclose something (a
 * menu, a dialog, a picker, a folder's children) instead of choosing what a
 * pane shows.
 */
const DISCLOSURE_SELECTOR =
  '[aria-haspopup]:not([aria-haspopup="false"]), [aria-expanded], [data-view-sidebar-control]';

/**
 * Whether a pointer press at `target`, or focus on it, chooses what a pane
 * shows: a sidebar destination or a view on the rail, not a field or a
 * control inside one that opens something.
 */
function choosesDestination(target: Element): boolean {
  const destination = target.closest(
    `${SIDEBAR_DESTINATION_SELECTOR}, ${RAIL_DESTINATION_SELECTOR}`
  );
  if (!destination || isEditableInput(target)) return false;
  const disclosure = target.closest(DISCLOSURE_SELECTOR);
  return !disclosure || !destination.contains(disclosure);
}

/**
 * Whether focus on `focused` during a press at `pressed` that chose a
 * destination is that destination: the sidebar destination pressed, or the
 * one the rail's press leaves or hands focus back to.
 */
function isChosenDestination(focused: Element, pressed: Element): boolean {
  if (!choosesDestination(focused)) return false;
  if (focused.contains(pressed)) return true;
  return (
    !!pressed.closest(RAIL_DESTINATION_SELECTOR) &&
    !!focused.closest(SIDEBAR_DESTINATION_SELECTOR)
  );
}

/** Whether an element is laid out on screen, outside an inert layer. */
function isOnScreen(element: Element | undefined): boolean {
  if (!element?.isConnected) return false;
  if (element.closest('[inert]')) return false;
  return element.getClientRects().length > 0;
}

/**
 * Whether a key pressed at `target` is on the pane the tabs head rather than
 * on a field, an editor or a control. The pane is the view-shell region
 * holding the tabs (a list beside a detail is its own pane), else the whole
 * split. Nothing focused counts as the pane, as the split keeps the keyboard
 * after a load or an item opening, unless the user last put the keyboard in
 * another of the split's panes still on screen (`lastPlace`, that pane: a
 * press on plain text in a detail beside the list focuses the split itself).
 * So does a sidebar destination a pointer press focused (`chosen`): the
 * press chose what the pane shows, and the browser left focus on it.
 */
function keyboardIsOnPane(
  target: EventTarget | null | undefined,
  tabs: Element,
  split: Element | null,
  lastPlace: Element | undefined,
  chosen: Element | undefined
): boolean {
  const pane = tabs.closest(PANE_REGION_SELECTOR) ?? split;
  if (
    !(target instanceof Element) ||
    target === document.body ||
    target === document.documentElement ||
    target === split ||
    target === chosen
  )
    return (
      !lastPlace ||
      !split?.contains(lastPlace) ||
      !isOnScreen(lastPlace) ||
      !!pane?.contains(lastPlace)
    );
  if (!pane?.contains(target)) return false;
  return (
    target.matches(PANE_FOCUS_SELECTOR) &&
    !target.matches(OWNS_ITS_KEYS_SELECTOR) &&
    !isEditableInput(target)
  );
}

/**
 * Tab, Shift+Tab and 1–9 for the tabs in a pane's top bar. They act only
 * while those tabs are on screen and the keyboard is on the pane; anywhere
 * else (a field, an editor, a button, an open item without tabs) Tab is
 * normal focus order. A destination chosen with the pointer in a view's
 * sidebar or on the rail leaves the keyboard on the pane, though the
 * browser may leave focus on it. A split can hold several panes with tabs (a list
 * beside a conversation), so each set registers alongside the others and
 * the first whose pane has the keyboard takes the key.
 */
export function useViewTabHotkeys<TTab extends string>(
  options: UseViewTabHotkeysOptions<TTab>
) {
  const group = createHotkeyGroup();
  // Where the user last put the keyboard: the pane of the last element
  // pressed, or of the last one focused other than the split itself. The
  // pane rather than the element, so content replaced inside it keeps it.
  let lastPlace: WeakRef<Element> | undefined;
  // A press that chose a destination leaves no place. It lasts until the
  // next key, press or focus elsewhere (a menu or dialog it opened), and the
  // destination it left focus on is `chosen` until focus moves on.
  let press: WeakRef<Element> | undefined;
  let chosen: WeakRef<Element> | undefined;
  const remember = (event: Event) => {
    if (event.type === 'keydown') {
      press = undefined;
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (event.type === 'pointerdown') {
      const primary = event instanceof MouseEvent && event.button === 0;
      press =
        primary && choosesDestination(target) ? new WeakRef(target) : undefined;
      if (press) {
        lastPlace = undefined;
        // A press that leaves focus where it was fires no focusin: on the
        // destination pressed, or on one the rail leaves focused.
        const focused = document.activeElement;
        if (focused && isChosenDestination(focused, target))
          chosen = new WeakRef(focused);
        return;
      }
    } else {
      if (target === getScopeElement(options.scopeId)) return;
      // Focus coming back from outside the page lands on it again.
      const returning = event instanceof FocusEvent && !event.relatedTarget;
      if (returning && target === chosen?.deref()) return;
      const pressed = press?.deref();
      if (pressed && isChosenDestination(target, pressed)) {
        chosen = new WeakRef(target);
        return;
      }
      press = undefined;
      chosen = undefined;
    }
    lastPlace = new WeakRef(target.closest(PANE_REGION_SELECTOR) ?? target);
  };
  const listened = ['pointerdown', 'focusin', 'keydown'] as const;
  for (const type of listened)
    document.addEventListener(type, remember, { capture: true });
  onCleanup(() => {
    for (const type of listened)
      document.removeEventListener(type, remember, { capture: true });
  });
  const isEnabled = () =>
    (options.enabled?.() ?? true) && isOnScreen(options.tabs());
  const keyboardOnPane = (event: KeyboardEvent | undefined) => {
    const tabs = options.tabs();
    if (!tabs) return false;
    return (
      !event ||
      keyboardIsOnPane(
        event.target,
        tabs,
        getScopeElement(options.scopeId),
        lastPlace?.deref(),
        chosen?.deref()
      )
    );
  };
  const numberKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

  numberKeys.forEach((key, index) => {
    registerHotkey({
      hotkey: key,
      scopeId: options.scopeId,
      registrationType: 'add',
      description: () => {
        const id = options.ids()[index];
        return t('tabs.viewTabGoTo', { label: id ? options.label(id) : key });
      },
      condition: () => isEnabled() && options.ids().length > index,
      keyDownHandler: (event) => {
        const id = options.ids()[index];
        if (!id || !keyboardOnPane(event)) return false;

        options.setActiveId(id);
        return true;
      },
      hide: true,
    }).withGroup(group);
  });

  const move = (offset: 1 | -1) => {
    const ids = options.ids();
    if (ids.length < 2) return false;

    const active = options.activeId();
    const currentIndex = active === undefined ? -1 : ids.indexOf(active);
    let origin = currentIndex;
    if (origin === -1) {
      origin = offset === 1 ? -1 : 0;
    }

    const nextIndex = (origin + offset + ids.length) % ids.length;
    const next = ids[nextIndex];
    if (!next) return false;

    options.setActiveId(next);
    return true;
  };

  registerHotkey({
    hotkey: 'tab',
    scopeId: options.scopeId,
    registrationType: 'add',
    description: () => t('tabs.viewTabNext'),
    condition: () => isEnabled() && options.ids().length > 1,
    keyDownHandler: (event) => keyboardOnPane(event) && move(1),
  }).withGroup(group);

  registerHotkey({
    hotkey: 'shift+tab',
    scopeId: options.scopeId,
    registrationType: 'add',
    description: () => t('tabs.viewTabPrevious'),
    condition: () => isEnabled() && options.ids().length > 1,
    keyDownHandler: (event) => keyboardOnPane(event) && move(-1),
  }).withGroup(group);

  onCleanup(() => group.dispose());
}
