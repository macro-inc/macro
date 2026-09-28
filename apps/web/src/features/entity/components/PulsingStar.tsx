import SparkleIcon from '@phosphor/sparkle.svg';
import { cn } from '@ui';

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
  return (
    <div class={kind[props.kind]}>
      <SparkleIcon
        class={cn('size-full', props.class, props.animate && 'animate-pulse')}
      />
    </div>
  );
}
