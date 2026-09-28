import type { TextFont, TextGeometry } from '@macro-inc/graphics';
import { Show } from 'solid-js';
export function TextInspector(props: {
  label?: boolean;
  geometry: Pick<TextGeometry, 'fontSize' | 'fontFamily'> &
    Partial<Pick<TextGeometry, 'autoWidth'>>;
  onChange: (
    patch: Partial<Pick<TextGeometry, 'fontSize' | 'fontFamily' | 'autoWidth'>>
  ) => void;
}) {
  return (
    <section
      class="space-y-3 border-b border-edge-muted p-3"
      aria-label="Text style"
    >
      <h2 class="text-xs font-medium">
        {props.label ? 'Shape label' : 'Text'}
      </h2>
      <label class="flex items-center justify-between gap-2 text-xs">
        Font
        <select
          aria-label="Font family"
          class="w-28 rounded border border-edge-muted bg-input px-2 py-1.5 text-ink"
          value={props.geometry.fontFamily}
          onChange={(event) =>
            props.onChange({
              fontFamily: event.currentTarget.value as TextFont,
            })
          }
        >
          <option value="sans">Sans</option>
          <option value="serif">Serif</option>
          <option value="mono">Mono</option>
        </select>
      </label>
      <label class="flex items-center justify-between gap-2 text-xs">
        Size
        <input
          type="number"
          aria-label="Font size"
          min="4"
          max="512"
          class="w-28 rounded border border-edge-muted bg-input px-2 py-1.5 text-ink"
          value={Math.round(props.geometry.fontSize * 10) / 10}
          onChange={(event) => {
            const size = event.currentTarget.valueAsNumber;
            if (Number.isFinite(size) && size >= 4 && size <= 512)
              props.onChange({ fontSize: size });
          }}
        />
      </label>
      <Show when={!props.label}>
        <button
          type="button"
          aria-pressed={props.geometry.autoWidth}
          class="w-full rounded border border-edge-muted px-2 py-1.5 text-xs hover:bg-hover"
          onClick={() =>
            props.onChange({ autoWidth: !props.geometry.autoWidth })
          }
        >
          {props.geometry.autoWidth ? 'Auto width' : 'Wrap to width'}
        </button>
      </Show>
      <p class="text-[10px] leading-relaxed text-ink-muted">
        {props.label
          ? 'Double-click or Enter to edit. Labels wrap and fit inside the shape.'
          : 'Double-click or Enter to edit. Side edges wrap; corners scale text.'}
      </p>
    </section>
  );
}
