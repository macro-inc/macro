/** Observe actual answer DOM; raw fold text may still be Markdown scaffolding. */

function readableText(element: HTMLElement): boolean {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (
      !parent ||
      parent.closest('button, input, select, [aria-hidden="true"]') ||
      (parent.closest('.md-static-code-container') && !parent.closest('pre'))
    )
      continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    if (![...range.getClientRects()].some((rect) => visible(parent, rect)))
      continue;
    text += node.textContent ?? '';
  }
  // Keep real numeric answers, but not a streaming list marker such as `1. **`.
  return /[\p{L}\p{N}]/u.test(text) && !/^\s*\d+[.)][\s*_`~]*$/u.test(text);
}

function visible(
  element: HTMLElement,
  rect = element.getBoundingClientRect()
): boolean {
  if (!element.isConnected || document.visibilityState === 'hidden')
    return false;
  let left = Math.max(0, rect.left);
  let top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right);
  let bottom = Math.min(window.innerHeight, rect.bottom);
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
    // A container can intersect while all its text is clipped below a scroll
    // viewport. Intersect the actual glyph rectangles with every overflow clip.
    const clipsX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
    const clipsY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
    if (clipsX || clipsY) {
      const bounds = node.getBoundingClientRect();
      if (clipsX) {
        const start = bounds.left + node.clientLeft;
        left = Math.max(left, start);
        right = Math.min(right, start + node.clientWidth);
      }
      if (clipsY) {
        const start = bounds.top + node.clientTop;
        top = Math.max(top, start);
        bottom = Math.min(bottom, start + node.clientHeight);
      }
    }
    if (left >= right || top >= bottom) return false;
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
  // Scrolling can reveal text without changing whether its outer part intersects.
  document.addEventListener('scroll', check, true);
  check();

  return () => {
    stopped = true;
    cancelFrame();
    mutations.disconnect();
    intersection?.disconnect();
    document.removeEventListener('visibilitychange', check);
    document.removeEventListener('scroll', check, true);
  };
}
