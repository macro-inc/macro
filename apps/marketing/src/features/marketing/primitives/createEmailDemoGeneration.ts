import { createSignal, onCleanup, onMount } from 'solid-js';

export type EmailDemoToken = string | { kind: 'pdf' | 'md'; label: string };
const parts: EmailDemoToken[] = [
  'Hi Dana,\n',
  'Thanks for joining the demo on September 14. Great meeting your team!\n',
  'Here’s our ',
  { kind: 'pdf', label: 'Macro sales overview.pdf' },
  ' and the ',
  { kind: 'md', label: 'Team rollout plan' },
  '.\n',
  'I’ve cc’d Julia to help with setup. Does Thursday at 9 AM work for a follow-up?\n',
  'Best,\nJacob',
];
const tokens = parts.flatMap((part): EmailDemoToken[] =>
  typeof part === 'string'
    ? part
        .split(/(\n)/)
        .flatMap((text) =>
          text === '\n' ? [text] : (text.match(/\S+[^\S\n]*|[^\S\n]+/g) ?? [])
        )
    : [part]
);

/** The website owns its animation; it never initializes an app editor. */
export function createEmailDemoGeneration(
  element: () => HTMLElement | undefined,
  append: (items: EmailDemoToken[]) => void
) {
  const [phase, setPhase] = createSignal<
    'waiting' | 'loading' | 'generating' | 'complete'
  >('waiting');
  let visible = false;
  let index = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reduced: MediaQueryList | undefined;

  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const run = () => {
    stop();
    if (phase() === 'complete') return;
    if (reduced?.matches) {
      append(tokens.slice(index));
      index = tokens.length;
      setPhase('complete');
      return;
    }
    if (!visible || document.hidden) return;
    if (phase() === 'waiting') setPhase('loading');
    timer = setTimeout(
      () => {
        timer = undefined;
        setPhase('generating');
        append([tokens[index++]]);
        if (index === tokens.length) setPhase('complete');
        else run();
      },
      phase() === 'loading' ? 1000 : 32
    );
  };
  onMount(() => {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced.addEventListener('change', run);
    document.addEventListener('visibilitychange', run);
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        run();
      },
      { threshold: 0.2 }
    );
    const root = element();
    if (root) observer.observe(root);
    run();
    onCleanup(() => {
      stop();
      observer.disconnect();
      reduced?.removeEventListener('change', run);
      document.removeEventListener('visibilitychange', run);
    });
  });
  return { phase };
}
