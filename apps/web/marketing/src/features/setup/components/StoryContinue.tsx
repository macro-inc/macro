import ArrowRight from '@phosphor/arrow-right.svg';

/** An understated, explicit next step that leaves scrolling native. */
export function StoryContinue(props: { label: string; onClick: () => void }) {
  return (
    <div class="mt-10 flex justify-center pb-5">
      <button
        type="button"
        aria-label={props.label}
        onClick={props.onClick}
        class="flex items-center gap-2 rounded-lg px-5 py-3 text-xs text-ink-muted outline-none focus-visible:ring-1 focus-visible:ring-ink/50"
      >
        <span>{props.label}</span>
        <ArrowRight class="size-4" />
      </button>
    </div>
  );
}
