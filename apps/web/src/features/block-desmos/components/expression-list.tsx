import { createEffect, createSignal, For, Show } from 'solid-js';
import {
  DESMOS_COLORS,
  type Expression,
  type PlotScene,
} from '../core/document';

export function ExpressionList(props: {
  expressions: Expression[];
  scene: PlotScene | undefined;
  canEdit: boolean;
  onChange: (id: string, latex: string) => void;
  onToggle: (id: string, hidden: boolean) => void;
  onColor: (id: string, color: string) => void;
  onSlider: (id: string, value: number) => void;
  onAddSlider: (name: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  const [selected, setSelected] = createSignal<string | undefined>();
  const errorFor = (id: string) => {
    const item = props.scene?.items.find((entry) => entry.id === id);
    return item?.kind === 'error' ? item : undefined;
  };

  return (
    <div
      class="flex h-full min-h-0 w-[324px] shrink-0 flex-col border-r border-edge bg-surface"
      data-testid="desmos-expressions"
    >
      <div class="flex h-9 items-center px-1.5">
        <Show when={props.canEdit}>
          <button
            type="button"
            class="grid size-7 place-items-center text-[22px] leading-none text-ink-muted hover:text-accent"
            title="Add expression"
            onClick={() => props.onAdd()}
          >
            +
          </button>
        </Show>
      </div>
      <div class="min-h-0 flex-1 overflow-auto">
        <For each={props.expressions}>
          {(expr, index) => {
            const value = () => assignmentValue(expr.latex);
            return (
              <ExpressionRow
                expr={expr}
                index={index()}
                selected={selected() === expr.id}
                error={errorFor(expr.id)}
                canEdit={props.canEdit}
                canRemove={props.canEdit && props.expressions.length > 1}
                onSelect={() => setSelected(expr.id)}
                onChange={props.onChange}
                onToggle={props.onToggle}
                onColor={props.onColor}
                onSlider={props.onSlider}
                onRemove={props.onRemove}
                onAdd={props.onAdd}
                sliderValue={value()}
              />
            );
          }}
        </For>
        <Show
          when={(props.scene?.neededSliders?.length ?? 0) > 0 && props.canEdit}
        >
          <div class="flex flex-wrap gap-1 px-3 py-2 text-[12px]">
            <For each={props.scene?.neededSliders ?? []}>
              {(name) => (
                <button
                  type="button"
                  class="rounded-full bg-accent-bg px-2 py-0.5 text-accent"
                  onClick={() => props.onAddSlider(name)}
                >
                  add slider: {name}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

function ExpressionRow(props: {
  expr: Expression;
  index: number;
  selected: boolean;
  error: { message: string } | undefined;
  canEdit: boolean;
  canRemove: boolean;
  sliderValue: number | null;
  onSelect: () => void;
  onChange: (id: string, latex: string) => void;
  onToggle: (id: string, hidden: boolean) => void;
  onColor: (id: string, color: string) => void;
  onSlider: (id: string, value: number) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  // Local draft so late engine responses cannot overwrite newer keystrokes.
  const [text, setText] = createSignal(props.expr.latex);
  let pending: string | undefined;

  createEffect(() => {
    const engine = props.expr.latex;
    if (pending !== undefined) {
      if (engine === pending) pending = undefined;
      return;
    }
    if (engine !== text()) setText(engine);
  });

  return (
    <div
      class="group border-b border-edge px-1.5 py-1.5"
      classList={{ 'bg-ink-extra-muted/10': props.selected }}
      data-testid={`desmos-expression-${props.expr.id}`}
      onMouseDown={() => props.onSelect()}
    >
      <div class="flex items-start gap-1.5">
        <div class="flex w-7 shrink-0 flex-col items-center gap-1 pt-0.5">
          <span class="text-[11px] text-ink-extra-muted">
            {props.index + 1}
          </span>
          <button
            type="button"
            class="size-3.5 rounded-full border-2"
            style={{
              'background-color': props.expr.hidden
                ? 'transparent'
                : props.expr.color,
              'border-color': props.expr.color,
            }}
            title={props.expr.hidden ? 'Show' : 'Hide'}
            onClick={() => props.onToggle(props.expr.id, !props.expr.hidden)}
          />
        </div>
        <div class="min-w-0 flex-1">
          <input
            class="w-full bg-transparent text-[16.5px] text-ink outline-none"
            style={{
              'font-family':
                '"Times New Roman", "STIX Two Math", ui-serif, serif',
            }}
            value={text()}
            placeholder="y=x^2"
            disabled={!props.canEdit}
            spellcheck={false}
            onInput={(event) => {
              const next = event.currentTarget.value;
              setText(next);
              pending = next;
              props.onChange(props.expr.id, next);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && props.canEdit) {
                event.preventDefault();
                props.onAdd();
              }
              if (
                event.key === 'Backspace' &&
                text() === '' &&
                props.canEdit &&
                props.canRemove
              ) {
                event.preventDefault();
                props.onRemove(props.expr.id);
              }
            }}
          />
          <Show when={props.error}>
            {(error) => (
              <div class="pt-0.5 text-[11px] text-negative">
                {error().message}
              </div>
            )}
          </Show>
          <Show when={props.expr.slider && props.sliderValue != null}>
            <div class="mt-1 flex items-center gap-2">
              <input
                type="range"
                class="min-w-0 flex-1 accent-[var(--slider-color)]"
                style={{ '--slider-color': props.expr.color }}
                min={props.expr.slider?.min ?? -10}
                max={props.expr.slider?.max ?? 10}
                step={props.expr.slider?.step ?? 0.01}
                value={props.sliderValue ?? 0}
                disabled={!props.canEdit}
                onInput={(event) =>
                  props.onSlider(
                    props.expr.id,
                    Number(event.currentTarget.value)
                  )
                }
              />
              <span
                class="w-10 text-right text-[12px] text-ink-muted"
                style={{
                  'font-family': '"Times New Roman", ui-serif, serif',
                }}
              >
                {formatSlider(props.sliderValue ?? 0)}
              </span>
            </div>
          </Show>
          <Show when={props.selected && props.canEdit}>
            <div class="mt-1.5 flex gap-1">
              <For each={DESMOS_COLORS}>
                {(color) => (
                  <button
                    type="button"
                    class="size-3.5 rounded-full border"
                    classList={{
                      'ring-1 ring-[#222] ring-offset-1':
                        props.expr.color === color,
                    }}
                    style={{
                      'background-color': color,
                      'border-color': color,
                    }}
                    title={color}
                    onClick={() => props.onColor(props.expr.id, color)}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
        <Show when={props.canRemove}>
          <button
            type="button"
            class="mt-0.5 hidden px-1 text-[16px] text-ink-extra-muted group-hover:block hover:text-negative"
            title="Remove"
            onClick={() => props.onRemove(props.expr.id)}
          >
            ×
          </button>
        </Show>
      </div>
    </div>
  );
}

function assignmentValue(latex: string): number | null {
  const match = latex.match(/^[A-Za-z]\w*\s*=\s*(-?\d+(?:\.\d+)?)\s*$/);
  return match ? Number(match[1]) : null;
}

function formatSlider(value: number): string {
  return String(Number(value.toPrecision(4)));
}
