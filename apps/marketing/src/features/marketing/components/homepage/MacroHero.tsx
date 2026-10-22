import Pause from '@phosphor/pause.svg';
import Play from '@phosphor/play.svg';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { FeatureConstellation } from '../../../setup/components/FeatureOverview';
import { ContextScene } from '../../../setup/components/WelcomeSteps';
import './macro-hero.css';

/** The original homepage graphics share one stage and a slow gather/unfold loop. */
export function MacroHero() {
  let scene!: HTMLDivElement;
  const [paused, setPaused] = createSignal(false);
  const [visible, setVisible] = createSignal(false);
  const [documentVisible, setDocumentVisible] = createSignal(true);
  onMount(() => {
    // Layout coordinates stay stable while the compositor moves the tiles.
    const measure = () => {
      for (const stage of scene.querySelectorAll<HTMLElement>(
        '[data-context-scene], .feature-flow'
      )) {
        const context = stage.hasAttribute('data-context-scene');
        const centerY = stage.clientHeight * (context ? 0.5 : 0.49);
        for (const node of stage.querySelectorAll<HTMLElement>(
          '.ob-orbit-tile, .feature-flow-node'
        )) {
          node.style.setProperty(
            '--gather-x',
            `${stage.clientWidth / 2 - node.offsetLeft}px`
          );
          node.style.setProperty('--gather-y', `${centerY - node.offsetTop}px`);
        }
      }
    };
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion.addEventListener('change', measure);
    const resize = new ResizeObserver(measure);
    resize.observe(scene);
    measure();
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting)
    );
    observer.observe(scene);
    const visibility = () => setDocumentVisible(!document.hidden);
    visibility();
    document.addEventListener('visibilitychange', visibility);
    onCleanup(() => {
      reducedMotion.removeEventListener('change', measure);
      resize.disconnect();
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
    });
  });
  return (
    <div
      class="macro-hero-art"
      ref={scene}
      data-paused={paused() || !visible() || !documentVisible()}
    >
      <div
        class="macro-hero-scene"
        role="img"
        aria-label="Your existing tools come together in Macro, then unfold into connected email, chat, documents, tasks, CRM, calls, sheets, and agents."
      >
        <div class="macro-hero-before" aria-hidden="true">
          <ContextScene />
        </div>
        <div class="macro-hero-after macro-hero-expanded" aria-hidden="true">
          <FeatureConstellation expanded />
        </div>
        <div class="macro-hero-after macro-hero-compact" aria-hidden="true">
          <FeatureConstellation />
        </div>
      </div>
      <button
        class="macro-motion-toggle"
        type="button"
        aria-label={paused() ? 'Play animation' : 'Pause animation'}
        aria-pressed={paused()}
        onClick={() => setPaused(!paused())}
      >
        <Show when={paused()} fallback={<Pause />}>
          <Play />
        </Show>
      </button>
    </div>
  );
}
