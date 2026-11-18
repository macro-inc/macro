import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { nextReviewsHeaderSteps } from '../core/reviews-header-fit';

type HeaderStep = 'tabs' | 'scope';

/** Steps that settle one change; each takes at most one per pass. */
const SETTLE_PASSES = 4;

/**
 * Decides, from the header as it is laid out, whether the status tabs show
 * only their icons and whether the scope name hides, so the actions beside
 * them (Search and New included) stay on screen. Nothing is given up while
 * the actions fit.
 */
export function createReviewsHeaderFit(elements: {
  actions: Accessor<HTMLElement | undefined>;
  tabs: Accessor<HTMLElement | undefined>;
  scope: Accessor<HTMLElement | undefined>;
}) {
  // By name, so the board (no tabs) and the list keep what each gave up.
  const [given, setGiven] = createSignal<HeaderStep[]>([]);
  const available = (): HeaderStep[] =>
    elements.tabs() ? ['tabs', 'scope'] : ['scope'];
  // Hiding the scope implies the tabs were already short of room.
  const count = () =>
    Math.max(0, ...given().map((step) => available().indexOf(step) + 1));
  const applied = (step: HeaderStep) => {
    const index = available().indexOf(step);
    return index !== -1 && index < count();
  };

  const freed: Partial<Record<HeaderStep, number>> = {};
  let labelledTabsWidth: number | undefined;

  const measure = () => {
    const actions = elements.actions();
    if (!actions) return false;
    const list = available();
    const tabs = elements.tabs();
    // Tabs that arrive already short of room (from the board, or a status
    // preset after a custom filter) were never measured with their labels,
    // so nothing could tell when the labels fit again: start them over.
    if (tabs && applied('tabs') && labelledTabsWidth === undefined) {
      keepTabFocus(tabs, () =>
        setGiven((current) => current.filter((step) => !list.includes(step)))
      );
      return true;
    }
    if (tabs) {
      const width = tabs.getBoundingClientRect().width;
      if (!applied('tabs')) labelledTabsWidth = width;
      else if (labelledTabsWidth !== undefined)
        freed.tabs = labelledTabsWidth - width;
    }
    const scope = elements.scope();
    if (scope && !applied('scope')) {
      freed.scope = scope.getBoundingClientRect().width + gapAfter(scope);
    }
    const next = nextReviewsHeaderSteps(
      { steps: count(), freed: list.map((step) => freed[step]) },
      list.length,
      {
        overflow: actions.scrollWidth - actions.clientWidth,
        slack: slackBefore(actions),
      }
    );
    if (next === count()) return false;
    keepTabFocus(tabs, () =>
      setGiven((current) => [
        ...current.filter((step) => !list.includes(step)),
        ...list.slice(0, next),
      ])
    );
    return true;
  };

  createEffect(
    on(
      [elements.actions, elements.tabs, elements.scope],
      ([actions, tabs, scope]) => {
        if (!actions) return;
        let pending: ReturnType<typeof setTimeout> | undefined;
        // Measured after the observer's turn: changing the header from
        // inside it would resize what it is still reporting on. Each pass
        // lays the header out again, so a change settles in one go rather
        // than one step per frame.
        const schedule = () => {
          pending ??= setTimeout(() => {
            pending = undefined;
            let pass = 0;
            while (pass < SETTLE_PASSES && measure()) pass++;
          });
        };
        const resizes = new ResizeObserver(schedule);
        const observeAll = () => {
          resizes.disconnect();
          for (const element of [actions, tabs, scope, ...actions.children]) {
            if (element) resizes.observe(element);
          }
        };
        const children = new MutationObserver(() => {
          observeAll();
          schedule();
        });
        observeAll();
        children.observe(actions, { childList: true });
        onCleanup(() => {
          clearTimeout(pending);
          resizes.disconnect();
          children.disconnect();
        });
      }
    )
  );

  return {
    iconTabs: () => applied('tabs'),
    hideScope: () => applied('scope'),
  };
}

/**
 * Tabs render their options anew when they switch to icons, which would drop
 * a keyboard user's focus on a status; it moves to the same status instead.
 */
function keepTabFocus(tabs: HTMLElement | undefined, change: () => void) {
  const focused = document.activeElement;
  const value =
    tabs && focused instanceof HTMLInputElement && tabs.contains(focused)
      ? focused.value
      : undefined;
  change();
  if (value === undefined || tabs?.contains(document.activeElement)) return;
  tabs
    ?.querySelector<HTMLInputElement>(`input[value="${CSS.escape(value)}"]`)
    ?.focus();
}

/** The gap before the status tabs goes with the scope; the board has none. */
function gapAfter(element: HTMLElement) {
  const next = element.nextElementSibling;
  const parent = element.parentElement;
  if (!parent || !next || next.getBoundingClientRect().width === 0) return 0;
  return Number.parseFloat(getComputedStyle(parent).columnGap) || 0;
}

/** The row packs its actions at the end, so free room shows before them. */
function slackBefore(actions: HTMLElement) {
  const start =
    actions.getBoundingClientRect().left +
    Number.parseFloat(getComputedStyle(actions).paddingLeft);
  const lefts = [...actions.children]
    .map((child) => child.getBoundingClientRect())
    .filter((box) => box.width > 0)
    .map((box) => box.left);
  if (lefts.length === 0) return actions.clientWidth;
  return Math.max(0, Math.min(...lefts) - start);
}
