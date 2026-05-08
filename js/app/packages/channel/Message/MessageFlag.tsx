import { cn } from '@ui';

type MessageFlagProps = {
  text: string;
  highlightAbove?: boolean;
  highlightBelow?: boolean;
  class?: string;
};

export function MessageFlag(props: MessageFlagProps) {
  return (
    <div
      class={cn(
        'flex flex-row items-stretch h-20 justify-start ml-(--left-of-connector)',
        props.class
      )}
    >
      <div class="flex flex-col items-center justify-center">
        <div
          class={cn(
            'border-l border-rail min-h-1/2',
            props.highlightAbove && 'border-accent'
          )}
        />
        <div
          class={cn(
            'border-l border-rail min-h-1/2',
            props.highlightBelow && 'border-accent'
          )}
        />
      </div>
      <div class="flex items-center flex-1 py-2">
        <div
          class={cn(
            'border-b border-rail w-5',
            props.highlightBelow && 'border-accent'
          )}
        />
        <span
          class={cn(
            'text-xs px-2',
            props.highlightBelow ? 'text-accent' : 'text-ink-extra-muted'
          )}
        >
          {props.text}
        </span>
        <div
          class={cn(
            'flex-1 border-b border-rail',
            props.highlightBelow && 'border-accent'
          )}
        />
      </div>
    </div>
  );
}
