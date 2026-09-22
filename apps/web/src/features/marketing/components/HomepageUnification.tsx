import { onCleanup, onMount } from 'solid-js';
import { FeatureConstellation } from '../../setup/components/FeatureOverview';
import './homepage-unification.css';

/** A separate section whose entrance follows native scroll position in both directions. */
export function HomepageUnification() {
  let section!: HTMLElement;

  onMount(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const scroller = section.parentElement!;
    const animations: Animation[] = [];
    const hiddenSources = new Map<HTMLElement, string>();
    let overlay: HTMLDivElement | undefined;
    let prepared = false;
    let start = 0;
    let distance = 1;

    const clear = () => {
      prepared = false;
      animations.forEach((animation) => animation.cancel());
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
      animations.push(animation);
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
      overlay = document.createElement('div');
      overlay.className = 'unification-travel';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.inert = true;
      section.append(overlay);

      const fly = (
        source: HTMLElement,
        target: DOMRect,
        index: number,
        merges: boolean
      ) => {
        const rect = source.getBoundingClientRect();
        // The hero's initial entrance can still be playing during a fast scroll.
        // Use its settled layout so that entrance timing cannot alter this path.
        if (source.hasAttribute('data-constellation-tool')) {
          const parent = source.offsetParent!.getBoundingClientRect();
          rect.x = parent.left + source.offsetLeft - source.offsetWidth / 2;
          rect.y = parent.top + source.offsetTop - source.offsetHeight / 2;
          rect.width = source.offsetWidth;
          rect.height = source.offsetHeight;
        }
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
        });
        overlay!.append(ghost);
        hiddenSources.set(source, source.style.visibility);
        source.style.visibility = 'hidden';
        const dx = target.left + target.width / 2 - rect.left - rect.width / 2;
        const dy = target.top + target.height / 2 - rect.top - rect.height / 2;
        const scale = merges ? 0.22 : target.width / rect.width;
        const end = `translate(${dx}px, ${dy}px) scale(${scale})`;
        animate(
          ghost,
          [
            { transform: 'translate(0, 0) scale(1)', offset: 0 },
            { transform: end, offset: 0.78 },
            { transform: end, offset: 1 },
          ],
          1080,
          index * 28
        );
        // Dim the traveling logos together, independently of their staggered
        // paths, so none linger over the final feature icons.
        animate(
          ghost,
          [
            { opacity: 1, offset: 0 },
            { opacity: 0.38, offset: 0.32 },
            { opacity: 0.24, offset: 0.68 },
            { opacity: 0, offset: 1 },
          ],
          680
        );
      };

      sources.forEach((source, index) => {
        const target = targets.find(
          (node) => node.dataset.toolTile === source.dataset.constellationTool
        );
        fly(
          source,
          target
            ?.querySelector('[data-tool-surface]')
            ?.getBoundingClientRect() ?? coreRect,
          index,
          !target
        );
      });
      const heroCore = hero?.querySelector<HTMLElement>('.ob-welcome-logo');
      if (heroCore) fly(heroCore, coreRect, 0, false);

      // Reveal the final surfaces after the traveling logos have nearly faded.
      targets.forEach((target, index) => {
        animate(
          target,
          [
            { opacity: 0, transform: 'translate(-50%, -50%) scale(.86)' },
            { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
          ],
          400,
          600 + index * 12
        );
      });
      animate(core, [{ opacity: 0 }, { opacity: 1 }], 400, 560);
      const light = scene.querySelector('.feature-flow-light')!;
      animate(
        light,
        [
          { opacity: 0, transform: 'scale(.72)' },
          { opacity: 1, transform: 'scale(1)' },
        ],
        1350,
        300
      );
      const before = section.querySelector('.unification-before')!;
      animate(
        before,
        [
          { opacity: 1, filter: 'blur(0px)' },
          { opacity: 0, filter: 'blur(4px)' },
        ],
        540
      );
      const heading = section.querySelector('h2')!;
      animate(
        heading,
        [
          { opacity: 0, transform: 'translateY(8px)', filter: 'blur(4px)' },
          { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' },
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
      if (!prepared && progress > 0) prepare();
      section.dataset.motion =
        progress === 0 ? 'waiting' : progress === 1 ? 'complete' : 'scrubbing';
      // A paused timeline is only a set of keyframes. The scroll offset is its
      // sole clock: no autoplay, easing toward a target, or scroll interception.
      for (const animation of animations)
        animation.currentTime = progress * 1700;
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
      // Spread the movement across a longer scroll, without an early ease-out.
      distance = Math.max(1, scroller.clientHeight * 0.72 + 500);
      update();
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(section);
    resize.observe(scroller);
    scroller.addEventListener('scroll', update, { passive: true });
    reduced.addEventListener('change', measure);
    onCleanup(() => {
      resize.disconnect();
      scroller.removeEventListener('scroll', update);
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
      <FeatureConstellation />
      <div class="unification-copy">
        <div class="unification-before" aria-hidden="true">
          One unified interface
          <br />
          for all your work.
        </div>
        <h2 id="unification-heading">
          Replace 11+ apps
          <br />
          with a single system.
        </h2>
        <p class="unification-subtext">
          Email, chat, docs, tasks, calls, CRM, and agents.
          <br />
          Already connected, with one shared context.
        </p>
      </div>
    </section>
  );
}
