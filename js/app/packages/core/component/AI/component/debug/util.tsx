import { cn } from '@ui/utils/classname';

export function Item(
  props: any & {
    label: string;
    col?: any;
    class?: string;
  }
) {
  return (
    <div class={cn('h-full w-full justify-start', props.class)}>
      <div class="text-sm text-ink-muted p-2 top-0">{props.label}</div>
      <div
        class={cn('p-4 flex gap-2 overflow-y-auto', props.col && 'flex-col')}
      >
        {props.children}
      </div>
    </div>
  );
}
