import { createEffect, createSignal } from 'solid-js';

const compactFormatter = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatNumber(value: number): string {
  return compactFormatter.format(value);
}

interface AnimatedCounterProps {
  value: number;
  delay?: number;
  duration?: number;
  format?: (value: number) => string;
}

export function AnimatedCounter(props: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = createSignal(0);
  const [hasAnimated, setHasAnimated] = createSignal(false);

  const formatter = () => props.format ?? formatNumber;
  const duration = () => props.duration ?? 600;
  const delay = () => props.delay ?? 0;

  createEffect(() => {
    const target = props.value;
    if (hasAnimated()) {
      setDisplayValue(target);
      return;
    }

    const timeout = setTimeout(() => {
      setHasAnimated(true);
      const animDuration = duration();
      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / animDuration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplayValue(Math.round(eased * target));

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };

      requestAnimationFrame(animate);
    }, delay());

    return () => clearTimeout(timeout);
  });

  return <>{formatter()(displayValue())}</>;
}
