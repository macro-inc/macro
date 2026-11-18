import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';
import { nextReviewsHeaderSteps } from '../core/reviews-header-fit';

type HeaderStep = 'tabs' | 'scope';

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
  const [steps, setSteps] = createSignal(0);
  const available = (): HeaderStep[] =>
    elements.tabs() ? ['tabs', 'scope'] : ['scope'];
  const applied = (step: HeaderStep) =>
    available().slice(0, steps()).includes(step);

  const freed: Partial<Record<HeaderStep, number>> = {};
  let labelledTabsWidth: number | undefined;
  let lastAvailable = available().join();

  const measure = () => {
    const actions = elements.actions();
    if (!actions) return;
    const list = available();
    // A step means something else once the tabs come or go (the board).
    if (list.join() !== lastAvailable) {
      lastAvailable = list.join();
      setSteps(0);
    }
    const tabs = elements.tabs();
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
    setSteps(
      nextReviewsHeaderSteps(
        { steps: steps(), freed: list.map((step) => freed[step]) },
        list.length,
        {
          overflow: actions.scrollWidth - actions.clientWidth,
          slack: slackBefore(actions),
        }
      )
    );
  };

  createEffect(() => {
    const actions = elements.actions();
    if (!actions) return;
    const watched = [actions, elements.tabs(), elements.scope()];
    let pending: ReturnType<typeof setTimeout> | undefined;
    // Measured after the observer's turn: changing the header from inside it
    // would resize what it is still reporting on.
    const schedule = () => {
      pending ??= setTimeout(() => {
        pending = undefined;
        measure();
      });
    };
    const resizes = new ResizeObserver(schedule);
    const observeAll = () => {
      resizes.disconnect();
      for (const element of [...watched, ...actions.children]) {
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
  });

  return {
    iconTabs: () => applied('tabs'),
    hideScope: () => applied('scope'),
  };
}

function gapAfter(element: HTMLElement) {
  const parent = element.parentElement;
  return parent
    ? Number.parseFloat(getComputedStyle(parent).columnGap) || 0
    : 0;
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
