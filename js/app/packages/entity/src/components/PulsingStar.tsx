import { AnimatedStarIcon } from '@macro-icons/wide/animating/star';
import type { StreamEvent } from '@service-connection/generated/schemas';
import { createSignal, onCleanup } from 'solid-js';

export type StreamIndicatorProps = {
  streamState?: StreamEvent;
};

const kind = {
  listIcon: 'size-4 text-chat',
  streamIndicator: 'size-4 text-accent',
} as const;

type Kind = keyof typeof kind;

export function PulsingStar(props: {
  kind: Kind;
  animate?: boolean;
  class?: string;
}) {
  const [pulse, setPulse] = createSignal(false);

  const interval = setInterval(() => {
    if (props.animate) {
      setPulse((p) => !p);
    } else {
      setPulse(false);
    }
  }, 900);

  onCleanup(() => clearInterval(interval));

  return (
    <div class={kind[props.kind]}>
      <AnimatedStarIcon class={props.class} triggerAnimation={pulse()} />
    </div>
  );
}
