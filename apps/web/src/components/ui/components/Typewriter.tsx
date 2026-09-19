import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import { cn } from '../utils/classname';

export type TypewriterPhase =
  | 'typing'
  | 'holding'
  | 'deleting'
  | 'resting'
  | 'done';

export type TypewriterTiming = {
  /** Delay between typed characters. */
  typeMs: number;
  /** Delay between deleted characters; deleting is quick so the next line lands fast. */
  deleteMs: number;
  /** How long a finished line stays on screen before it is deleted. */
  holdMs: number;
  /** Pause on the empty line before the next one starts typing. */
  restMs: number;
};

export const DEFAULT_TYPEWRITER_TIMING: TypewriterTiming = {
  typeMs: 55,
  deleteMs: 24,
  holdMs: 1800,
  restMs: 360,
};

export type TypewriterOptions = Partial<TypewriterTiming> & {
  /**
   * Whether to animate at all. Defaults to the user's motion preference: with
   * `prefers-reduced-motion: reduce` the first line is shown as static text.
   */
  animate?: Accessor<boolean>;
};

function prefersMotion(): boolean {
  return (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function' ||
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Types each phrase out character by character, holds it, deletes it quickly,
 * then moves on to the next phrase and loops. A single phrase is typed once
 * and left in place. Changing the phrase list deletes whatever is on screen
 * and starts the new list from its first line.
 */
export function createTypewriter(
  phrases: Accessor<readonly string[]>,
  options: TypewriterOptions = {}
) {
  const timing: TypewriterTiming = {
    typeMs: options.typeMs ?? DEFAULT_TYPEWRITER_TIMING.typeMs,
    deleteMs: options.deleteMs ?? DEFAULT_TYPEWRITER_TIMING.deleteMs,
    holdMs: options.holdMs ?? DEFAULT_TYPEWRITER_TIMING.holdMs,
    restMs: options.restMs ?? DEFAULT_TYPEWRITER_TIMING.restMs,
  };
  const animate = options.animate ?? (() => prefersMotion());
  const [text, setText] = createSignal('');
  const [phase, setPhase] = createSignal<TypewriterPhase>('typing');

  let index = 0;
  // Where deleting lands next; set explicitly so a phrase-list swap restarts at 0.
  let queued: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (ms: number) => {
    cancel();
    timer = setTimeout(step, ms);
  };
  // Slight variance keeps typing from feeling mechanical.
  const typeDelay = () => timing.typeMs * (0.75 + Math.random() * 0.5);

  const step = () => {
    timer = undefined;
    const list = untrack(phrases);
    const phrase = list[index] ?? '';
    const current = untrack(text);
    switch (untrack(phase)) {
      case 'typing': {
        if (current.length < phrase.length) {
          setText(phrase.slice(0, current.length + 1));
          schedule(typeDelay());
        } else {
          setPhase('holding');
          schedule(timing.holdMs);
        }
        return;
      }
      case 'holding': {
        if (list.length <= 1) {
          setPhase('done');
          return;
        }
        queued = (index + 1) % list.length;
        setPhase('deleting');
        schedule(timing.deleteMs);
        return;
      }
      case 'deleting': {
        if (current.length > 0) {
          setText(current.slice(0, -1));
          schedule(timing.deleteMs);
        } else {
          index = queued ?? (index + 1) % Math.max(list.length, 1);
          queued = undefined;
          setPhase('resting');
          schedule(timing.restMs);
        }
        return;
      }
      case 'resting': {
        setPhase('typing');
        schedule(typeDelay());
        return;
      }
      case 'done':
        return;
    }
  };

  const start = (list: readonly string[]) => {
    cancel();
    index = 0;
    queued = undefined;
    if (!untrack(animate)) {
      setText(list[0] ?? '');
      setPhase('done');
      return;
    }
    if (untrack(text).length > 0) {
      // Clear the previous list's line the same way a finished line leaves.
      queued = 0;
      setPhase('deleting');
      schedule(timing.deleteMs);
    } else {
      setPhase('typing');
      schedule(timing.restMs);
    }
  };

  start(untrack(phrases));
  // Timers are imperative state; restart the chain whenever the lines change.
  createEffect(
    on([phrases, animate], ([list]) => start(list), { defer: true })
  );
  onCleanup(cancel);

  return { text, phase };
}

export type TypewriterProps = TypewriterOptions & {
  /** Lines to cycle through, in order. */
  phrases: readonly string[];
  /**
   * What assistive technology reads instead of the animated characters.
   * Defaults to the first phrase.
   */
  label?: string;
  class?: string;
  caretClass?: string;
};

/**
 * Animated heading text that types out each phrase, quickly deletes it, and
 * moves on to the next one. Screen readers get a stable label instead of the
 * character-by-character updates.
 */
export function Typewriter(props: TypewriterProps) {
  const { text, phase } = createTypewriter(() => props.phrases, {
    typeMs: props.typeMs,
    deleteMs: props.deleteMs,
    holdMs: props.holdMs,
    restMs: props.restMs,
    ...(props.animate ? { animate: props.animate } : {}),
  });
  const idle = () => phase() !== 'typing' && phase() !== 'deleting';
  return (
    <span class={cn('inline-block whitespace-pre-wrap', props.class)}>
      <span class="sr-only">{props.label ?? props.phrases[0]}</span>
      <span aria-hidden="true" data-typewriter-text data-phase={phase()}>
        {text() || '\u200b'}
      </span>
      <Show when={phase() !== 'done'}>
        <span
          aria-hidden="true"
          data-typewriter-caret
          class={cn(
            'ml-[0.06em] inline-block h-[0.95em] w-[0.08em] min-w-[2px] translate-y-[0.12em] rounded-full bg-accent',
            idle() && 'motion-safe:animate-caret-blink',
            props.caretClass
          )}
        />
      </Show>
    </span>
  );
}
