import { cn } from '@ui/utils/classname';

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
        'flex flex-row items-stretch justify-start ml-(--left-of-connector)',
        props.class
      )}
    >
      <div class="flex flex-col items-center justify-center">
        <div
          class={cn(
            'border-l border-edge-muted min-h-1/2',
            props.highlightAbove && 'border-accent'
          )}
        />
        <div
          class={cn(
            'border-l border-edge-muted min-h-1/2',
            props.highlightBelow && 'border-accent'
          )}
        />
      </div>
      <div class="flex flex-col items-center justify-center">
        <div
          class={cn(
            'w-7 border-b border-edge-muted',
            props.highlightBelow && 'border-accent'
          )}
        />
      </div>
      <div
        class={cn(
          'text-xs text-panel uppercase font-mono p-1 my-6 mt bg-edge',
          props.highlightBelow && 'bg-accent'
        )}
      >
        {props.text}
      </div>
    </div>
  );
}
