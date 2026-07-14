import { cn } from '@ui';
import { Show } from 'solid-js';
import type { WidgetOf } from '../schema';
import { TEXT } from '../tokens';

export type StatProps = Omit<WidgetOf<'stat'>, 'type'>;

/** Arrow glyph for a delta direction. */
const DELTA_GLYPH: Record<'up' | 'down' | 'neutral', string> = {
  up: '▲',
  down: '▼',
  neutral: '—',
};

/** A compact stat card: label, prominent value (+unit), optional delta. */
export function Stat(props: StatProps) {
  return (
    <div class="w-full gap-1 rounded-lg border border-edge-muted bg-surface p-3">
      <span class="text-ink-extra-muted text-xxs font-medium uppercase tracking-wide">
        {props.label}
      </span>
      <div class="flex items-baseline gap-1">
        <span class={cn('text-2xl font-semibold leading-none', TEXT.primary)}>
          {props.value}
        </span>
        <Show when={props.unit}>
          <span class="text-ink-muted text-sm">{props.unit}</span>
        </Show>
      </div>

      <Show when={props.delta}>
        {(delta) => (
          <span class={cn('flex items-center gap-1 text-xs', TEXT.accent)}>
            <span aria-hidden="true">{DELTA_GLYPH[delta().direction]}</span>
            <span class="font-medium">{delta().value}</span>
            <Show when={delta().label}>
              <span class="text-ink-extra-muted">{delta().label}</span>
            </Show>
          </span>
        )}
      </Show>
    </div>
  );
}
