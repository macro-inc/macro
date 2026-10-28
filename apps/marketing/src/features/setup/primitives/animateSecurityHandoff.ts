/** Fade the slide and carry its visual anchors downward into the next proof row. */
export function animateSecurityHandoff(
  content: HTMLElement,
  commit: () => void,
  from: 'intro' | 'features' | 'security' = 'security'
) {
  const sourceSelector =
    from === 'intro'
      ? '.workspace-intro-icon'
      : from === 'features'
        ? '[data-tool-surface]'
        : '[data-security-item]';
  const sources = Array.from(
    content.querySelectorAll<HTMLElement>(sourceSelector)
  );
  const shell =
    content.closest<HTMLElement>('.onboarding-flow') ??
    (from === 'intro' ? document.body : null);
  if (
    !shell ||
    (from === 'features'
      ? sources.length === 0
      : sources.length !== (from === 'intro' ? 1 : 3)) ||
    typeof content.animate !== 'function' ||
    typeof window.matchMedia !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    commit();
    return () => {};
  }

  const bounds = content.getBoundingClientRect();
  const sourceBounds = sources.map((source) => source.getBoundingClientRect());
  const overlay = document.createElement('div');
  overlay.className =
    'pointer-events-none fixed inset-0 z-[1000] font-sans text-ink';
  overlay.dataset.securityTransition = '';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;

  let cloneIndex = 0;
  const cloneAt = (
    source: HTMLElement,
    rect: DOMRect,
    freezeAppearance = false
  ) => {
    const clone = source.cloneNode(true) as HTMLElement;
    if (freezeAppearance) {
      // Moving a bubble outside .feature-overview loses its scoped dimensions,
      // selected treatment, and checkmark styles. Freeze the small moving subtree
      // before detaching it; the full-slide snapshot retains its CSS ancestry.
      const originals = [source, ...source.querySelectorAll('*')];
      const copies = [clone, ...clone.querySelectorAll('*')];
      originals.forEach((element, index) => {
        const copy = copies[index];
        if (!(copy instanceof HTMLElement || copy instanceof SVGElement))
          return;
        const appearance = getComputedStyle(element);
        for (const property of Array.from(appearance)) {
          if (!property.startsWith('--'))
            copy.style.setProperty(
              property,
              appearance.getPropertyValue(property)
            );
        }
        copy.style.animation = 'none';
        copy.style.transition = 'none';
      });
    }
    clone.removeAttribute('id');
    const ids = new Map<string, string>();
    clone.querySelectorAll('[id]').forEach((node) => {
      const id = node.id;
      const replacement = `handoff-${cloneIndex++}-${id}`;
      ids.set(id, replacement);
      node.id = replacement;
    });
    // Keep cloned SVG texture filters local to the outgoing snapshot.
    clone.querySelectorAll('*').forEach((node) => {
      for (const attribute of Array.from(node.attributes)) {
        let value = attribute.value;
        for (const [id, replacement] of ids) {
          value = value.replaceAll(`url(#${id})`, `url(#${replacement})`);
          if (value === `#${id}`) value = `#${replacement}`;
        }
        if (value !== attribute.value) node.setAttribute(attribute.name, value);
      }
    });
    const accent = getComputedStyle(source).getPropertyValue('--intro-accent');
    if (accent) clone.style.setProperty('--intro-accent', accent);
    Object.assign(clone.style, {
      position: 'absolute',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      boxSizing: 'border-box',
      margin: '0',
      animation: 'none',
    });
    overlay.append(clone);
    return clone;
  };
  const snapshot = cloneAt(content, bounds);
  snapshot.querySelectorAll<HTMLElement>(sourceSelector).forEach((item) => {
    item.style.visibility = 'hidden';
  });
  const ghosts = sources.map((source, index) =>
    cloneAt(source, sourceBounds[index], true)
  );
  shell.append(overlay);

  const originalOpacity = content.style.opacity;
  const originalInert = content.inert;
  const originalBusy = content.getAttribute('aria-busy');
  const scroller = content.closest('[data-onboarding-scroll]');
  const animations: Animation[] = [];
  let finished = false;
  const finish = (focus: boolean) => {
    if (finished) return;
    finished = true;
    animations.forEach((animation) => animation.cancel());
    overlay.remove();
    content.style.opacity = originalOpacity;
    content.inert = originalInert;
    if (originalBusy === null) content.removeAttribute('aria-busy');
    else content.setAttribute('aria-busy', originalBusy);
    delete content.dataset.securityHandoff;
    window.removeEventListener('resize', settle);
    scroller?.removeEventListener('scroll', settleScroll);
    if (focus && content.isConnected)
      content.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  };
  const settle = () => finish(true);
  const settleScroll = () => finish(false);
  content.dataset.securityHandoff = '';
  content.style.opacity = '0';
  content.inert = true;
  content.setAttribute('aria-busy', 'true');
  commit();

  // The new view and its scroll reset must settle before measuring destinations.
  queueMicrotask(() => {
    if (finished) return;
    const targets = Array.from(
      content.querySelectorAll<HTMLElement>(
        from === 'intro' && content.querySelector('.feature-flow-core')
          ? '.feature-flow-node, .feature-flow-core'
          : from !== 'security'
            ? '[data-security-item]'
            : '[data-privacy-item]'
      )
    );
    if (
      !content.isConnected ||
      (from === 'intro' ? targets.length === 0 : targets.length !== 3)
    ) {
      finish(true);
      return;
    }
    const targetBounds = targets.map((target) =>
      target.getBoundingClientRect()
    );
    const animate = (
      element: HTMLElement,
      frames: Keyframe[],
      duration: number,
      delay = 0
    ) => {
      const animation = element.animate(frames, {
        duration: duration * 1.5,
        delay: delay * 1.5,
        easing: 'cubic-bezier(.22,1,.36,1)',
        fill: 'both',
      });
      animations.push(animation);
    };

    animate(snapshot, [{ opacity: 1 }, { opacity: 0 }], 200);
    animate(content, [{ opacity: 0 }, { opacity: 1 }], 300, 180);
    ghosts.forEach((ghost, index) => {
      const source = sourceBounds[index];
      const to = targetBounds[index % targetBounds.length];
      const dx =
        from === 'intro'
          ? 0
          : to.left + to.width / 2 - source.left - source.width / 2;
      // The intro icon leaves downward; the proof row enters from above,
      // preserving the same direction even though its final layout is higher.
      const dy = from === 'intro' ? 96 : to.top - source.top;
      animate(
        ghost,
        [
          { transform: 'translate(0, 0)' },
          { transform: `translate(${dx}px, ${dy}px)` },
        ],
        680,
        index * 25
      );
      animate(
        ghost,
        [
          { opacity: 1, offset: 0 },
          { opacity: 0.2, offset: 0.45 },
          { opacity: 0, offset: 0.7 },
          { opacity: 0, offset: 1 },
        ],
        680,
        index * 25
      );
    });
    targets.forEach((target, index) => {
      // Individual translate composes with each bubble's centering transform.
      // Overriding transform makes it snap back by half its size on cleanup.
      animate(
        target,
        [
          { opacity: 0, translate: '0 -28px' },
          { opacity: 1, translate: '0 0' },
        ],
        380,
        280 + Math.min(index, 5) * 25
      );
    });
    content.style.opacity = originalOpacity;
    window.addEventListener('resize', settle, { once: true });
    scroller?.addEventListener('scroll', settleScroll, {
      once: true,
      passive: true,
    });
    const complete = async () => {
      try {
        await Promise.all(animations.map((animation) => animation.finished));
        settle();
      } catch {
        finish(false);
      }
    };
    void complete();
  });

  return () => finish(false);
}
