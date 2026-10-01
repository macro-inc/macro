import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js';
import {
  DocsGraphicFrame,
  DocsMarkdownScene,
  REST_T,
} from '../../../app/components/featureGraphics/DocsMarkdownScene';
import { createVisible } from '../../../app/utils/utilVisible';
import { HomepageVersionHistory } from './HomepageVersionHistory';
import './homepage-collaborative-doc.css';

/** One playhead drives both Julia's edits and the document history. */
export default function HomepageCollaborativeDoc() {
  const [time, setTime] = createSignal(REST_T);
  const [playing, setPlaying] = createSignal(false);
  const [foreground, setForeground] = createSignal(true);
  let root: HTMLDivElement | undefined;
  const visible = createVisible(() => root);
  onMount(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!motion.matches) {
      setTime(0);
      setPlaying(true);
    }
    const stopForReducedMotion = () => {
      if (motion.matches) setPlaying(false);
    };
    const visibility = () => setForeground(!document.hidden);
    visibility();
    motion.addEventListener('change', stopForReducedMotion);
    document.addEventListener('visibilitychange', visibility);
    onCleanup(() => {
      motion.removeEventListener('change', stopForReducedMotion);
      document.removeEventListener('visibilitychange', visibility);
    });
  });
  createEffect(() => {
    if (!playing() || !visible() || !foreground()) return;
    let last = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const next = Math.min(REST_T, untrack(time) + Math.min(now - last, 64));
      last = now;
      setTime(next);
      if (next === REST_T) setPlaying(false);
      else id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(id));
  });
  return (
    <div class="homepage-collaborative-doc" ref={root}>
      <DocsGraphicFrame label="Julia's document edits. Use the version history slider below to move backward or forward through the changes.">
        <DocsMarkdownScene t={time} />
      </DocsGraphicFrame>
      <div class="homepage-doc-timeline">
        <HomepageVersionHistory
          position={time() / REST_T}
          onPause={() => setPlaying(false)}
          onSeek={(position) => {
            setPlaying(false);
            setTime(position * REST_T);
          }}
        />
      </div>
    </div>
  );
}
