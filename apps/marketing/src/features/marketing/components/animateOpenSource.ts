/** Move the settled feature constellation into GitHub using native scroll only. */
export function animateOpenSource(section: HTMLElement, scroller: HTMLElement) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let sourceSection = scroller.querySelector('.homepage-unification');
  const target = section.querySelector<HTMLElement>('.homepage-github-mark')!;
  const animations: {
    animation: Animation;
    start: number;
    end: number;
    time: number;
  }[] = [];
  const sources = new Map<HTMLElement, string>();
  let overlay: HTMLDivElement | undefined;
  let start = 0;
  let distance = 1;
  let prepared = false;
  let lastProgress = -1;
  let traveling = false;

  const clear = () => {
    animations.forEach(({ animation }) => animation.cancel());
    animations.length = 0;
    for (const [source, visibility] of sources)
      source.style.visibility = visibility;
    sources.clear();
    overlay?.remove();
    overlay = undefined;
    prepared = false;
    lastProgress = -1;
    traveling = false;
  };
  const animate = (
    element: Element,
    frames: Keyframe[],
    duration: number,
    delay = 0
  ) => {
    const animation = element.animate(frames, {
      duration,
      delay,
      easing: 'linear',
      fill: 'both',
    });
    animation.pause();
    animation.currentTime = 0;
    animations.push({
      animation,
      start: delay,
      end: delay + duration,
      time: 0,
    });
  };
  const prepare = () => {
    prepared = true;
    overlay = document.createElement('div');
    overlay.className = 'homepage-open-source-travel';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.inert = true;
    const origin = section.getBoundingClientRect();
    const destination = target.getBoundingClientRect();
    const scale = section.offsetWidth / origin.width;
    const scene = sourceSection?.querySelector<HTMLElement>('.feature-flow');
    const sceneRect = scene?.getBoundingClientRect();
    const sceneScale =
      scene && sceneRect ? sceneRect.width / scene.offsetWidth : 1;
    const icons =
      sourceSection?.querySelectorAll<HTMLElement>(
        '.feature-flow-icon, .feature-flow-core'
      ) ?? [];
    // Read every source before inserting ghosts or starting animations. Mixing
    // these reads with DOM writes forces a layout for each of the 17 bubbles.
    const snapshots = Array.from(icons, (source) => {
      const styles = getComputedStyle(source);
      const svg = source.querySelector('svg');
      const svgStyles = svg ? getComputedStyle(svg) : undefined;
      const node = source.closest<HTMLElement>(
        '.feature-flow-node, .feature-flow-core'
      )!;
      // The previous transition may still be seeking the parent node. Cache its
      // settled layout position so this scene can be prepared before scrolling.
      const rect = sceneRect
        ? new DOMRect(
            sceneRect.left +
              (node.offsetLeft - node.offsetWidth / 2) * sceneScale,
            sceneRect.top +
              (node.offsetTop - node.offsetHeight / 2) * sceneScale,
            source.offsetWidth * sceneScale,
            source.offsetHeight * sceneScale
          )
        : source.getBoundingClientRect();
      return {
        source,
        rect,
        background: styles.background,
        borderRadius: styles.borderRadius,
        boxShadow: styles.boxShadow,
        color: styles.color,
        svgWidth: svgStyles?.width,
        svgHeight: svgStyles?.height,
      };
    });
    // Finish all layout/style reads before inserting travel layers.
    section.append(overlay);
    snapshots.forEach(
      ({ source, rect, svgWidth, svgHeight, ...surface }, index) => {
        const ghost = source.cloneNode(true) as HTMLElement;
        ghost.removeAttribute('id');
        ghost
          .querySelectorAll('[id]')
          .forEach((node) => node.removeAttribute('id'));
        Object.assign(ghost.style, {
          position: 'absolute',
          left: `${(rect.left - origin.left) * scale}px`,
          top: `${(rect.top - origin.top) * scale}px`,
          width: `${rect.width * scale}px`,
          height: `${rect.height * scale}px`,
          margin: '0',
          transform: 'none',
          animation: 'none',
          ...surface,
          backdropFilter: 'none',
          willChange: 'transform, opacity',
          visibility: 'visible',
        });
        const ghostSvg = ghost.querySelector('svg');
        if (ghostSvg && svgWidth && svgHeight) {
          ghostSvg.style.width = svgWidth;
          ghostSvg.style.height = svgHeight;
        }
        overlay!.append(ghost);
        sources.set(source, source.style.visibility);
        const dx =
          (destination.left +
            destination.width / 2 -
            rect.left -
            rect.width / 2) *
          scale;
        const dy =
          (destination.top +
            destination.height / 2 -
            rect.top -
            rect.height / 2) *
          scale;
        animate(
          ghost,
          [
            { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
            { opacity: 0.38, offset: 0.28 },
            { opacity: 0.24, offset: 0.65 },
            {
              transform: `translate(${dx}px, ${dy}px) scale(.18)`,
              opacity: 0,
              offset: 1,
            },
          ],
          1100,
          index * (350 / Math.max(1, icons.length - 1))
        );
      }
    );
    animate(
      target,
      [
        { opacity: 0.18, transform: 'scale(.82)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      650,
      650
    );
  };
  const update = () => {
    // A live edit can replace the constellation without remounting this
    // section. Detached sources measure as zero-sized boxes at (0, 0).
    const currentSource = scroller.querySelector('.homepage-unification');
    if (currentSource !== sourceSection) {
      if (sourceSection) resize.unobserve(sourceSection);
      sourceSection = currentSource;
      if (sourceSection) resize.observe(sourceSection);
      measure();
      return;
    }
    if (reduced.matches) return;
    const progress = Math.max(
      0,
      Math.min(1, (scroller.scrollTop - start) / distance)
    );
    if (progress === lastProgress) return;
    lastProgress = progress;
    if (!prepared && progress > 0) prepare();
    animations.forEach((entry) => {
      const time = Math.max(entry.start, Math.min(entry.end, progress * 1450));
      if (time === entry.time) return;
      entry.animation.currentTime = time;
      entry.time = time;
    });
    if (overlay) overlay.hidden = progress === 0 || progress === 1;
    const active = progress > 0 && progress < 1;
    if (active !== traveling) {
      traveling = active;
      for (const [source, visibility] of sources) {
        source.style.visibility = active ? 'hidden' : visibility;
      }
    }
  };
  const measure = () => {
    clear();
    const viewport = scroller.getBoundingClientRect();
    const top =
      section.getBoundingClientRect().top - viewport.top + scroller.scrollTop;
    const center =
      target.getBoundingClientRect().top -
      viewport.top +
      scroller.scrollTop +
      target.offsetHeight / 2;
    // Hold the readable constellation for 100px longer before it leaves.
    const delay = 100;
    start = top - scroller.clientHeight * 0.82 + delay;
    // Shift the whole transition, preserving its travel length and speed.
    distance = Math.max(
      1,
      center - scroller.clientHeight * 0.32 + delay - start
    );
    if (!reduced.matches) {
      prepare();
      overlay!.hidden = true;
    }
    update();
  };
  const resize = new ResizeObserver(measure);
  resize.observe(section);
  resize.observe(scroller);
  if (sourceSection) resize.observe(sourceSection);
  let updateFrame = 0;
  const scheduleUpdate = () => {
    if (updateFrame) return;
    updateFrame = requestAnimationFrame(() => {
      updateFrame = 0;
      update();
    });
  };
  scroller.addEventListener('scroll', scheduleUpdate, { passive: true });
  reduced.addEventListener('change', measure);
  measure();
  return () => {
    resize.disconnect();
    scroller.removeEventListener('scroll', scheduleUpdate);
    cancelAnimationFrame(updateFrame);
    reduced.removeEventListener('change', measure);
    clear();
  };
}
