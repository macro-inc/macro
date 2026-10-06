/** Observe actual answer DOM; raw fold text may still be Markdown scaffolding. */

function readableText(element: HTMLElement): boolean {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (
      !parent ||
      parent.closest('button, input, select, [aria-hidden="true"]') ||
      (parent.closest('.md-static-code-container') && !parent.closest('pre')) ||
      !visible(parent)
    )
      continue;
    text += node.textContent ?? '';
  }
  // Keep real numeric answers, but not a streaming list marker such as `1. **`.
  return /[\p{L}\p{N}]/u.test(text) && !/^\s*\d+[.)][\s*_`~]*$/u.test(text);
}

function visible(element: HTMLElement): boolean {
  if (!element.isConnected || document.visibilityState === 'hidden')
    return false;
  const rect = element.getBoundingClientRect();
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.bottom <= 0 ||
    rect.right <= 0 ||
    rect.top >= window.innerHeight ||
    rect.left >= window.innerWidth
  )
    return false;
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.opacity === '0'
    )
      return false;
  }
  return true;
}

/** No content leaves the renderer; callbacks report only lifecycle milestones. */
export function observeRenderedAnswer(
  element: HTMLElement,
  callbacks: { readable: () => void; painted: () => void; hidden: () => void }
): () => void {
  let stopped = false;
  let readable = false;
  let intersecting = typeof IntersectionObserver === 'undefined';
  let frame: number | undefined;
  const cancelFrame = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  };
  const ready = () => intersecting && visible(element) && readableText(element);
  const check = () => {
    if (stopped) return;
    if (document.visibilityState === 'hidden') {
      callbacks.hidden();
      return;
    }
    if (frame !== undefined || !ready()) return;
    if (!readable) {
      readable = true;
      callbacks.readable();
    }
    // Validate the same DOM across a paint boundary. Navigation, unmounting,
    // hidden tabs, and CSS-hidden transcripts must not become visible successes.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (stopped) return;
        if (document.visibilityState === 'hidden') callbacks.hidden();
        else if (ready()) callbacks.painted();
      });
    });
  };
  const mutations = new MutationObserver(check);
  mutations.observe(element, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
  const intersection =
    typeof IntersectionObserver === 'undefined'
      ? undefined
      : new IntersectionObserver((entries) => {
          intersecting = entries.some(
            (entry) => entry.target === element && entry.isIntersecting
          );
          check();
        });
  intersection?.observe(element);
  document.addEventListener('visibilitychange', check);
  check();

  return () => {
    stopped = true;
    cancelFrame();
    mutations.disconnect();
    intersection?.disconnect();
    document.removeEventListener('visibilitychange', check);
  };
}
