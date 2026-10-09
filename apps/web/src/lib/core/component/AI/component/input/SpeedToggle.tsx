import LightningIcon from '@phosphor-fill/lightning-fill.svg';
import { Button, cn } from '@ui';
import { onCleanup, Show } from 'solid-js';
import { acceleratedSpeed } from '../../constant/speed';
import { fastModeEnabled, setFastModeEnabled } from '../../signal/speed';

/** An explicit paid-speed preference. Changing models never enables unsupported tiers. */
export function SpeedToggle(props: { model: string }) {
  const speed = () => acceleratedSpeed(props.model);
  const enabled = () => !!speed() && fastModeEnabled();
  const label = () => {
    if (!speed()) return 'Fast mode is unavailable for this model';
    const name = speed() === 'ultrafast' ? 'Ultrafast' : 'Fast';
    const multiplier = speed() === 'ultrafast' ? '6×' : '2×';
    return `${name} mode ${enabled() ? 'on' : 'off'} · ${multiplier} AI usage`;
  };
  let bolt: HTMLSpanElement | undefined;
  let animation: Animation | undefined;
  onCleanup(() => animation?.cancel());

  function toggle() {
    if (!speed()) return;
    setFastModeEnabled(!fastModeEnabled());
    animation?.cancel();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    animation = bolt?.animate?.(
      [
        { transform: 'scale(1) rotate(0deg)', opacity: 1 },
        { transform: 'scale(0.65) rotate(-18deg)', opacity: 0.5, offset: 0.2 },
        { transform: 'scale(1.35) rotate(12deg)', opacity: 1, offset: 0.55 },
        { transform: 'scale(1) rotate(0deg)', opacity: 1 },
      ],
      { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    );
  }

  return (
    <Show when={speed()}>
      <Button
        variant="ghost"
        size="icon-composer"
        label={label()}
        aria-label={label()}
        aria-pressed={enabled()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
        class={cn(
          'shrink-0 transition-colors motion-reduce:transition-none',
          enabled() ? 'text-accent bg-accent/10' : 'text-ink-muted'
        )}
      >
        <span ref={bolt} class="flex items-center justify-center">
          <LightningIcon class="size-4" />
        </span>
      </Button>
    </Show>
  );
}
