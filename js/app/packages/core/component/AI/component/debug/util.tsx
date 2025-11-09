export function Item(
  props: any & {
    label: string;
    col?: any;
    class?: string;
  }
) {
  return (
    <div
      class={`h-full w-full justify-start ${props.class ? props.class : ''}`}
    >
      <div class="text-sm text-ink-muted p-2 top-0">{props.label}</div>
      <div
        class={`p-4 flex ${props.col ? 'flex-col' : ''} gap-2 overflow-y-auto`}
      >
        {props.children}
      </div>
    </div>
  );
}
