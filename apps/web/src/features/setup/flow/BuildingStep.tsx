import { LoadingSpinner } from '@core/component/LoadingSpinner';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';

/** The breather before the summary: brand animation + cycling phrases for
 * ~22s, then auto-advance. Pure theater — nothing waits on real work. */

const BUILDING_PHRASES = [
  'Building your unified workspace…',
  'Processing your inbox…',
  'Linking people, docs, and threads…',
  'Distilling months of context…',
  'Bringing in your tasks and docs…',
  'Waking up your Macro…',
];

const BUILDING_HOLD_MS = 22_000;
const PHRASE_MS = BUILDING_HOLD_MS / BUILDING_PHRASES.length;

export function BuildingStep(props: { onDone: () => void }) {
  const [phraseIndex, setPhraseIndex] = createSignal(0);

  onMount(() => {
    const interval = setInterval(() => {
      setPhraseIndex((index) =>
        Math.min(index + 1, BUILDING_PHRASES.length - 1)
      );
    }, PHRASE_MS);
    const done = setTimeout(props.onDone, BUILDING_HOLD_MS);
    onCleanup(() => {
      clearInterval(interval);
      clearTimeout(done);
    });
  });

  const progress = () => ((phraseIndex() + 1) / BUILDING_PHRASES.length) * 100;

  return (
    <div class="flex flex-col items-center gap-8 py-16">
      <style>{
        /*css*/ `
        @keyframes obf-phrase-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        .obf-phrase { animation: obf-phrase-in 400ms ease-out both; }
      `
      }</style>

      <LoadingSpinner class="size-28 p-0" />

      {/* Keyed so each phrase re-enters with the fade-up animation. */}
      <Show when={BUILDING_PHRASES[phraseIndex()]} keyed>
        {(phrase) => (
          <p class="obf-phrase min-h-6 text-center text-base text-ink">
            {phrase}
          </p>
        )}
      </Show>

      <div class="h-1 w-48 overflow-hidden rounded-full bg-ink/10">
        <div
          class="h-full rounded-full bg-accent transition-all duration-1000 ease-linear"
          style={{ width: `${progress()}%` }}
        />
      </div>
    </div>
  );
}
