import type { Appearance } from '@macro-inc/graphics';
import { For } from 'solid-js';

const colors = [
  ['None', 'transparent'],
  ['Ink', 'var(--color-ink)'],
  ['Muted', 'var(--color-ink-muted)'],
  ['Accent', 'var(--color-accent)'],
  ['Accent wash', 'var(--color-accent-bg)'],
  ['Surface', 'var(--color-panel)'],
] as const;

export function StyleInspector(props: {
  count: number;
  value: <K extends keyof Appearance>(key: K) => Appearance[K] | undefined;
  onChange: (patch: Partial<Appearance>) => void;
}) {
  return (
    <section
      class="space-y-3 border-b border-edge-muted p-3"
      aria-label="Shape appearance"
    >
      <div>
        <h2 class="text-xs font-medium">
          {props.count ? 'Appearance' : 'New shape style'}
        </h2>
        <p class="mt-1 text-xs text-ink-muted">
          {props.count
            ? `${props.count} shape${props.count === 1 ? '' : 's'} · groups edit their children`
            : 'Select a shape to edit it'}
        </p>
      </div>
      <For each={['stroke', 'fill'] as const}>
        {(key) => (
          <fieldset>
            <legend class="mb-2 text-xs capitalize">
              {key}
              {props.value(key) === undefined ? ' · Mixed' : ''}
            </legend>
            <div class="flex flex-wrap gap-1.5">
              <For each={colors}>
                {([label, color]) => (
                  <button
                    type="button"
                    aria-label={`${key}: ${label}`}
                    title={`${key}: ${label}`}
                    aria-pressed={props.value(key) === color}
                    onClick={() => props.onChange({ [key]: color })}
                    class="relative size-6 rounded border border-edge data-[selected=true]:outline-2 data-[selected=true]:outline-offset-2 data-[selected=true]:outline-accent"
                    data-selected={props.value(key) === color}
                    style={{ background: color }}
                  >
                    {color === 'transparent' ? (
                      <span class="absolute inset-0 text-center text-ink-muted">
                        ╱
                      </span>
                    ) : null}
                  </button>
                )}
              </For>
            </div>
          </fieldset>
        )}
      </For>
      <For
        each={
          [
            {
              key: 'strokeWidth',
              label: 'Stroke width',
              max: 40,
              step: 1,
              factor: 1,
            },
            {
              key: 'opacity',
              label: 'Opacity (%)',
              max: 100,
              step: 5,
              factor: 100,
            },
            {
              key: 'cornerRadius',
              label: 'Corner radius',
              max: 500,
              step: 1,
              factor: 1,
            },
          ] as const
        }
      >
        {(field) => (
          <label class="flex items-center justify-between gap-2 text-xs">
            {field.label}
            <input
              type="number"
              min="0"
              max={field.max}
              step={field.step}
              aria-label={field.label}
              placeholder="Mixed"
              value={
                props.value(field.key) === undefined
                  ? ''
                  : Math.round(props.value(field.key)! * field.factor * 100) /
                    100
              }
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isFinite(value) && value >= 0 && value <= field.max)
                  props.onChange({ [field.key]: value / field.factor });
              }}
              class="w-16 rounded border border-edge-muted bg-input px-2 py-1 tabular-nums"
            />
          </label>
        )}
      </For>
    </section>
  );
}
