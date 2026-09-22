import {
  createEffect,
  createSignal,
  type JSX,
  Match,
  onCleanup,
  Switch,
  untrack,
} from 'solid-js';
import { SecurityStep, VisionStep } from './StorySteps';
import { WelcomeStep } from './WelcomeSteps';

export type StoryStep = 'welcome' | 'vision' | 'tools' | 'security';
export const isStoryStep = (key: string): key is StoryStep =>
  key === 'welcome' ||
  key === 'vision' ||
  key === 'tools' ||
  key === 'security';

/** Owns the measured handoffs between the four opening story slides. */
export function StoryStage(props: {
  step: StoryStep;
  onNext: () => void;
  children: JSX.Element;
  durationMs?: number;
}) {
  const [shown, setShown] = createSignal(untrack(() => props.step));
  const [moving, setMoving] = createSignal(false);
  let stage!: HTMLDivElement;
  let disposeMotion: (() => void) | undefined;
  onCleanup(() => disposeMotion?.());

  const advance = () => {
    if (!moving()) props.onNext();
  };

  const transitionTo = (next: StoryStep) => {
    disposeMotion?.();
    if (
      !stage ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setShown(next);
      queueMicrotask(() => {
        if (stage?.isConnected && shown() === next)
          stage.querySelector('h1')?.focus({ preventScroll: true });
      });
      return;
    }
    const bounds = stage.getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.className =
      'onboarding-flow pointer-events-none fixed inset-0 z-[1000] font-sans text-ink';
    overlay.setAttribute('data-story-transition', '');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.inert = true;
    const snapshot = stage.cloneNode(true) as HTMLDivElement;
    snapshot.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    Object.assign(snapshot.style, {
      position: 'absolute',
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
    });
    overlay.append(snapshot);
    document.body.append(overlay);
    const sources = Array.from(
      stage.querySelectorAll<HTMLElement>(
        '[data-constellation-tool], [data-tool-surface]'
      )
    );
    const ghosts = sources.map((source) => {
      const rect = source.getBoundingClientRect();
      const appearance = getComputedStyle(source);
      const ghost = source.cloneNode(true) as HTMLElement;
      Object.assign(ghost.style, {
        position: 'absolute',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        animation: 'none',
        transform: 'none',
        margin: '0',
        color: appearance.color,
        background: appearance.background,
        borderColor: appearance.borderColor,
        boxShadow: appearance.boxShadow,
      });
      overlay.append(ghost);
      return {
        ghost,
        rect,
        name:
          source.dataset.constellationTool ??
          source.closest<HTMLElement>('[data-tool-tile]')?.dataset.toolTile,
      };
    });
    snapshot
      .querySelectorAll<HTMLElement>(
        '[data-constellation-tool], [data-tool-surface]'
      )
      .forEach((node) => {
        node.style.visibility = 'hidden';
      });
    const animations: Animation[] = [];
    let cancelled = false;
    const cleanup = () => {
      cancelled = true;
      animations.forEach((animation) => animation.cancel());
      overlay.remove();
      setMoving(false);
      window.removeEventListener('resize', finish);
    };
    const finish = () => {
      cleanup();
      stage.querySelector('h1')?.focus({ preventScroll: true });
    };
    disposeMotion = cleanup;
    setMoving(true);
    setShown(next);
    queueMicrotask(() => {
      if (cancelled || !stage.isConnected) {
        cleanup();
        return;
      }
      const duration = props.durationMs ?? 1400;
      const animate = (
        element: Element,
        frames: Keyframe[],
        start = 0,
        end = 1
      ) => {
        const animation = element.animate(frames, {
          duration: duration * (end - start),
          delay: duration * start,
          easing: 'cubic-bezier(.22,1,.36,1)',
          fill: 'both',
        });
        animations.push(animation);
        return animation;
      };
      const heading = stage.querySelector<HTMLElement>('h1');
      heading?.setAttribute('tabindex', '-1');
      if (heading) heading.style.outline = 'none';
      animate(snapshot, [{ opacity: 1 }, { opacity: 0 }], 0, 0.34);
      animate(stage, [{ opacity: 0 }, { opacity: 1 }], 0.28, 0.92);
      if (heading)
        animate(
          heading,
          [{ transform: 'translateY(18px)' }, { transform: 'translateY(0)' }],
          0.3,
          1
        );
      const targets = Array.from(
        stage.querySelectorAll<HTMLElement>(
          '[data-constellation-tool], [data-tool-surface]'
        )
      );
      const security = stage
        .querySelector('[data-security-scene]')
        ?.getBoundingClientRect();
      targets.forEach((target) => {
        if (target.dataset.constellationTool) {
          target.style.animation = 'none';
          target.style.transform = 'translate(-50%, -50%)';
        }
      });
      ghosts.forEach(({ ghost, rect, name }, index) => {
        const target = targets.find(
          (el) =>
            (el.dataset.constellationTool ??
              el.closest<HTMLElement>('[data-tool-tile]')?.dataset.toolTile) ===
            name
        );
        if (target) {
          const end = target.getBoundingClientRect();
          animate(
            ghost,
            [
              {
                transform: 'translate(0,0)',
                width: `${rect.width}px`,
                height: `${rect.height}px`,
                borderRadius: getComputedStyle(ghost).borderRadius,
              },
              {
                transform: `translate(${end.left - rect.left}px,${end.top - rect.top}px)`,
                width: `${end.width}px`,
                height: `${end.height}px`,
                borderRadius: getComputedStyle(target).borderRadius,
              },
            ],
            (index % 3) * 0.025,
            0.9
          );
          animate(ghost, [{ opacity: 1 }, { opacity: 0 }], 0.76, 0.92);
          animate(target, [{ opacity: 0 }, { opacity: 1 }], 0.76, 0.94);
        } else if (security) {
          animate(
            ghost,
            [
              { transform: 'translate(0,0) scale(1)', opacity: 1 },
              {
                transform: `translate(${security.left + security.width / 2 - rect.left - rect.width / 2}px,${security.top + security.height / 2 - rect.top - rect.height / 2}px) scale(.25)`,
                opacity: 0,
              },
            ],
            0,
            0.58
          );
        } else {
          animate(ghost, [{ opacity: 1 }, { opacity: 0 }], 0, 0.34);
        }
      });
      const clock = animate(overlay, [{ opacity: 1 }, { opacity: 1 }]);
      const settle = async () => {
        try {
          await clock.finished;
          if (!cancelled) finish();
        } catch {
          /* Navigation or unmount cancelled the handoff. */
        }
      };
      void settle();
      window.addEventListener('resize', finish, { once: true });
    });
  };

  // A prop change drives an imperative DOM snapshot/animation, not derived state.
  createEffect(() => {
    const next = props.step;
    if (next !== untrack(shown)) untrack(() => transitionTo(next));
  });

  return (
    <div ref={stage} data-story-stage aria-busy={moving()} inert={moving()}>
      <Switch>
        <Match when={shown() === 'welcome'}>
          <WelcomeStep onContinue={advance} />
        </Match>
        <Match when={shown() === 'vision'}>
          <VisionStep onContinue={advance} />
        </Match>
        <Match when={shown() === 'tools'}>
          <div class="flex flex-col gap-8">
            <h1
              tabindex="-1"
              class="mx-auto max-w-lg text-center font-[Roboto_Slab_Variable] text-4xl font-[315] leading-[1.12] tracking-tight outline-none sm:text-5xl"
            >
              Start with the tools
              <br />
              you already use.
            </h1>
            <div>{props.children}</div>
          </div>
        </Match>
        <Match when={shown() === 'security'}>
          <SecurityStep onContinue={advance} />
        </Match>
      </Switch>
    </div>
  );
}
