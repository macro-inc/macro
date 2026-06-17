import { PIN_LABEL_RE } from '@queries/pins';
import { createSignal, onMount } from 'solid-js';

export function CreatePin(props: {
  leftPx: number;
  containerWidth: number;
  onConfirm: (label: string) => void;
  onCancel: () => void;
}) {
  let inputRef!: HTMLInputElement;
  const [label, setLabel] = createSignal('');
  onMount(() => inputRef.focus());

  const left = () =>
    Math.min(Math.max(72, props.leftPx), props.containerWidth - 72);

  const confirm = () => {
    const l = label().trim();
    if (l) props.onConfirm(l);
    else props.onCancel();
  };

  return (
    <div
      class="pointer-events-auto absolute top-8 z-40 -translate-x-1/2"
      style={{ left: `${left()}px` }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div class="flex items-center gap-1 rounded border border-ink-muted/40 bg-hover/60 px-1.5 py-1 shadow-sm">
        <input
          ref={inputRef}
          placeholder="Label…"
          class="w-24 bg-transparent text-[11px] outline-none placeholder:text-ink-muted"
          value={label()}
          onInput={(e) => setLabel(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key.length === 1 && !PIN_LABEL_RE.test(e.key))
              e.preventDefault();
            if (e.key === 'Enter') confirm();
            if (e.key === 'Escape') {
              e.preventDefault();
              props.onCancel();
            }
          }}
        />
        <button
          type="button"
          class="text-[11px] text-accent hover:opacity-70"
          onClick={confirm}
        >
          ✓
        </button>
        <button
          type="button"
          class="text-[11px] text-ink-muted hover:opacity-70"
          onClick={props.onCancel}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
