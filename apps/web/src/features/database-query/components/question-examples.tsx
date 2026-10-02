import { createSignal, onCleanup, onMount } from 'solid-js';

/** Decorative guidance: the textarea keeps one stable accessible label. */
export function QuestionExamples(props: { examples: string[] }) {
  const [index, setIndex] = createSignal(0);
  const [visible, setVisible] = createSignal(true);
  onMount(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let transition: ReturnType<typeof setTimeout> | undefined;
    const rotation = setInterval(() => {
      if (props.examples.length < 2) return;
      setVisible(false);
      transition = setTimeout(() => {
        setIndex((current) => (current + 1) % props.examples.length);
        setVisible(true);
      }, 180);
    }, 4500);
    onCleanup(() => {
      clearInterval(rotation);
      clearTimeout(transition);
    });
  });
  return (
    <span
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 top-0 line-clamp-3 text-sm text-ink-placeholder transition-opacity duration-150 motion-reduce:transition-none"
      classList={{ 'opacity-0': !visible(), 'opacity-100': visible() }}
    >
      {props.examples[index() % props.examples.length]}
    </span>
  );
}
