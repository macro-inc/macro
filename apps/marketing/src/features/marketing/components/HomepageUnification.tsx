import { onCleanup, onMount } from 'solid-js';
import { FeatureConstellation } from '../../setup/components/FeatureOverview';
import './homepage-unification.css';

/** A separate section whose entrance follows native scroll position in both directions. */
export function HomepageUnification(
  props: {
    onPreviewReady?: (replay: ((duration: number) => void) | undefined) => void;
  } = {}
) {
  let section!: HTMLElement;

  onMount(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const scroller = section.parentElement!;
    const animations: { animation: Animation; end: number; time: number }[] =
      [];
    const hiddenSources = new Map<HTMLElement, string>();
    let overlay: HTMLDivElement | undefined;
    let prepared = false;
    let start = 0;
    let distance = 1;
    let lastProgress = -1;

    const clear = () => {
      prepared = false;
      lastProgress = -1;
      animations.forEach(({ animation }) => animation.cancel());
      animations.length = 0;
      overlay?.remove();
      overlay = undefined;
      for (const [source, visibility] of hiddenSources) {
        source.style.visibility = visibility;
      }
      hiddenSources.clear();
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
      animations.push({ animation, end: delay + duration, time: 0 });
      return animation;
    };

    const prepare = () => {
      prepared = true;
      const scene = section.querySelector<HTMLElement>('.feature-flow')!;
      const core = scene.querySelector<HTMLElement>('.feature-flow-core')!;
      const origin = section.getBoundingClientRect();
      const coreRect = core.getBoundingClientRect();
      const hero = section
        .closest('.onboarding-flow')
        ?.querySelector('[data-context-scene]');
      const sources = Array.from(
        hero?.querySelectorAll<HTMLElement>('[data-constellation-tool]') ?? []
      );
      const targets = Array.from(
        scene.querySelectorAll<HTMLElement>('[data-tool-tile]')
      );
      // Snapshot every source and destination before adding ghosts or keyframes.
      // Interleaving these reads with writes forces a layout for each bubble.
      const targetRects = new Map(
        [...targets, core].map((target) => [
          target,
          (
            target.querySelector('[data-tool-surface]') ?? target
          ).getBoundingClientRect(),
        ])
      );
      const heroCore = hero?.querySelector<HTMLElement>('.ob-welcome-logo');
      const sourceRects = new Map(
        [...sources, ...(heroCore ? [heroCore] : [])].map((source) => {
          const rect = source.getBoundingClientRect();
          // Ignore the hero's initial entrance transform during a fast scroll.
          if (source.hasAttribute('data-constellation-tool')) {
            const parent = source.offsetParent!.getBoundingClientRect();
            rect.x = parent.left + source.offsetLeft - source.offsetWidth / 2;
            rect.y = parent.top + source.offsetTop - source.offsetHeight / 2;
            rect.width = source.offsetWidth;
            rect.height = source.offsetHeight;
          }
          return [source, rect];
        })
      );
      overlay = document.createElement('div');
      overlay.className = 'unification-travel';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.inert = true;
      section.append(overlay);

      const arrivals = new Map<HTMLElement, { rect: DOMRect; delay: number }>();
      const fly = (
        source: HTMLElement,
        target: DOMRect,
        index: number,
        merges: boolean,
        destination?: HTMLElement
      ) => {
        const rect = sourceRects.get(source)!;
        const delay = index * 16;
        if (destination) arrivals.set(destination, { rect, delay });
        const ghost = source.cloneNode(true) as HTMLElement;
        ghost
          .querySelectorAll('[id]')
          .forEach((node) => node.removeAttribute('id'));
        ghost.removeAttribute('id');
        Object.assign(ghost.style, {
          position: 'absolute',
          left: `${rect.left - origin.left}px`,
          top: `${rect.top - origin.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          margin: '0',
          opacity: '1',
          animation: 'none',
          transform: 'none',
          willChange: 'transform, opacity',
        });
        overlay!.append(ghost);
        hiddenSources.set(source, source.style.visibility);
        source.style.visibility = 'hidden';
        const dx = target.left + target.width / 2 - rect.left - rect.width / 2;
        const dy = target.top + target.height / 2 - rect.top - rect.height / 2;
        const scale = merges ? 0.22 : target.width / rect.width;
        const end = `translate(${dx}px, ${dy}px) scale(${scale})`;
        // Fade travel early; keep the motion peripheral until the icons settle.
        // Transform and opacity share one compositor animation.
        animate(
          ghost,
          [
            { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
            { opacity: 0.18, offset: 0.18 },
            { opacity: 0.06, offset: 0.6 },
            { opacity: 0, offset: 0.82 },
            { transform: end, opacity: 0, offset: 1 },
          ],
          900,
          delay
        );
      };

      sources.forEach((source, index) => {
        const target = targets.find(
          (node) => node.dataset.toolTile === source.dataset.constellationTool
        );
        fly(
          source,
          (target && targetRects.get(target)) ?? coreRect,
          index,
          !target,
          target
        );
      });
      if (heroCore) fly(heroCore, coreRect, 0, false, core);

      const reveal = (target: HTMLElement, index: number) => {
        const end = targetRects.get(target)!;
        const arrival = arrivals.get(target);
        // Additional features unfold from the arriving Macro bubble.
        const origin = arrival?.rect ?? coreRect;
        const dx = origin.left + origin.width / 2 - end.left - end.width / 2;
        const dy = origin.top + origin.height / 2 - end.top - end.height / 2;
        const delay = arrival?.delay ?? 660 + index * 12;
        const duration = arrival ? 900 : 300;
        animate(
          target,
          [
            {
              transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${arrival ? origin.width / end.width : 0.35})`,
              opacity: 0,
              offset: 0,
            },
            { opacity: 0, offset: 0.55 },
            { opacity: 0.15, offset: 0.8 },
            {
              transform: 'translate(-50%, -50%) translate(0, 0) scale(1)',
              opacity: 1,
              offset: 1,
            },
          ],
          duration,
          delay
        );
        const label = target.querySelector(':scope > span');
        if (label)
          animate(
            label,
            [{ opacity: 0 }, { opacity: 1 }],
            180,
            delay + duration - 120
          );
      };
      targets.forEach(reveal);
      reveal(core, 0);
      const light = scene.querySelector('.feature-flow-light')!;
      animate(light, [{ opacity: 0 }, { opacity: 1 }], 800, 300);
      const before = section.querySelector('.unification-before')!;
      animate(before, [{ opacity: 1 }, { opacity: 0 }], 540);
      const heading = section.querySelector('h2')!;
      animate(
        heading,
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        850,
        240
      );
      animate(
        section.querySelector('.unification-subtext')!,
        [{ opacity: 0 }, { opacity: 1 }],
        800,
        630
      );
    };

    const update = () => {
      const progress = Math.max(
        0,
        Math.min(1, (scroller.scrollTop - start) / distance)
      );
      if (reduced.matches) {
        section.dataset.motion = 'complete';
        return;
      }
      // Once settled, leave this timeline alone while later sections scroll.
      if (progress === lastProgress) return;
      lastProgress = progress;
      if (!prepared && progress > 0) prepare();
      section.dataset.motion =
        progress === 0 ? 'waiting' : progress === 1 ? 'complete' : 'scrubbing';
      // A paused timeline is only a set of keyframes. The scroll offset is its
      // sole clock: no autoplay, easing toward a target, or scroll interception.
      for (const entry of animations) {
        const time = Math.min(entry.end, progress * 1500);
        if (time === entry.time) continue;
        entry.animation.currentTime = time;
        entry.time = time;
      }
      if (overlay) overlay.hidden = progress === 0 || progress === 1;
      for (const [source, visibility] of hiddenSources) {
        source.style.visibility =
          progress > 0 && progress < 1 ? 'hidden' : visibility;
      }
    };

    const measure = () => {
      clear();
      const top =
        section.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      start = top - scroller.clientHeight * 0.82;
      // Finish when the section reaches the upper fifth of the viewport,
      // before its heading and supporting copy are fully in view.
      distance = Math.max(1, scroller.clientHeight * 0.64);
      update();
    };
    let replayFrame = 0;
    const stopReplay = () => {
      cancelAnimationFrame(replayFrame);
      replayFrame = 0;
    };
    if (import.meta.env.DEV && props.onPreviewReady) {
      props.onPreviewReady((duration) => {
        stopReplay();
        scroller.scrollTop = 0;
        measure();
        const end = start + distance;
        if (reduced.matches) {
          scroller.scrollTop = end;
          return;
        }
        let began: number | undefined;
        const tick = (now: number) => {
          began ??= now;
          const progress = Math.min(1, (now - began) / duration);
          scroller.scrollTop = end * progress;
          if (progress < 1) replayFrame = requestAnimationFrame(tick);
          else replayFrame = 0;
        };
        replayFrame = requestAnimationFrame(tick);
      });
      scroller.addEventListener('wheel', stopReplay, { passive: true });
      scroller.addEventListener('pointerdown', stopReplay, { passive: true });
    }
    let updateFrame = 0;
    const scheduleUpdate = () => {
      if (updateFrame) return;
      updateFrame = requestAnimationFrame(() => {
        updateFrame = 0;
        update();
      });
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(section);
    resize.observe(scroller);
    scroller.addEventListener('scroll', scheduleUpdate, { passive: true });
    reduced.addEventListener('change', measure);
    onCleanup(() => {
      stopReplay();
      props.onPreviewReady?.(undefined);
      scroller.removeEventListener('wheel', stopReplay);
      scroller.removeEventListener('pointerdown', stopReplay);
      resize.disconnect();
      scroller.removeEventListener('scroll', scheduleUpdate);
      cancelAnimationFrame(updateFrame);
      reduced.removeEventListener('change', measure);
      clear();
    });
  });

  return (
    <section
      ref={section}
      class="homepage-unification"
      aria-labelledby="unification-heading"
    >
      <FeatureConstellation expanded />
      <div class="unification-copy">
        <div class="unification-before" aria-hidden="true">
          One unified interface
          <br />
          for all your work.
        </div>
        <h2 id="unification-heading">
          Replace 27+ apps
          <br />
          with a single system.
        </h2>
        <p class="unification-subtext">
          <span class="unification-subtext-desktop">
            From email and docs to booking links, databases, and coding agents.
            <br />
            Already connected, with one shared context.
          </span>
          <span class="unification-subtext-mobile">
            From email to docs to booking links, databases, and coding agents.
            One shared context.
          </span>
        </p>
      </div>
    </section>
  );
}
