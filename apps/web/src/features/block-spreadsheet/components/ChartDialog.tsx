import { Button } from '@ui/components/Button';
import { createSignal, createUniqueId, For, Show } from 'solid-js';
import {
  CHART_TYPES,
  type ChartSettings,
  type ChartTypeId,
} from '../core/chart-builder';
import { SpreadsheetDialog as Dialog } from './SpreadsheetDialog';

const LEGENDS = [
  { value: 'none', label: 'None' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'right', label: 'Right' },
  { value: 'top', label: 'Top' },
  { value: 'left', label: 'Left' },
] as const;

const FIELD =
  'h-9 w-full touch:h-[44px] touch:text-[max(16px,1rem)] rounded-md border border-edge-muted bg-input px-3 text-sm text-ink outline-none focus:border-accent';

/** The fields of the chart dialog, opened with a chart's settings. */
function ChartForm(props: {
  settings: ChartSettings;
  onApply: (settings: ChartSettings) => string | undefined;
  onClose: () => void;
}) {
  const id = createUniqueId();
  const [settings, setSettings] = createSignal(props.settings);
  const [error, setError] = createSignal('');
  const change = (patch: Partial<ChartSettings>) =>
    setSettings((value) => ({ ...value, ...patch }));
  return (
    <form
      class="p-5 text-ink"
      onKeyDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        const problem = props.onApply(settings());
        if (problem) setError(problem);
        else props.onClose();
      }}
    >
      <Dialog.Title class="mb-2 text-sm font-semibold">Edit chart</Dialog.Title>
      <Dialog.Description class="mb-4 text-xs text-ink-muted">
        Charts redraw as their cells change. Macro writes edited charts in Excel
        downloads with its own formatting.
      </Dialog.Description>
      <div class="grid grid-cols-2 gap-3 text-xs">
        <label class="block">
          <span class="mb-1.5 block">Type</span>
          <select
            class={FIELD}
            value={settings().type ?? ''}
            onChange={(event) =>
              change({ type: event.currentTarget.value as ChartTypeId })
            }
          >
            <Show when={!settings().type}>
              <option value="">Keep the current type</option>
            </Show>
            <For each={CHART_TYPES}>
              {(type) => <option value={type.id}>{type.label}</option>}
            </For>
          </select>
        </label>
        <label class="block">
          <span class="mb-1.5 block">Legend</span>
          <select
            class={FIELD}
            value={settings().legend}
            onChange={(event) =>
              change({
                legend: event.currentTarget.value as ChartSettings['legend'],
              })
            }
          >
            <For each={LEGENDS}>
              {(legend) => <option value={legend.value}>{legend.label}</option>}
            </For>
          </select>
        </label>
        <label class="col-span-2 block">
          <span class="mb-1.5 block">Title</span>
          <input
            class={FIELD}
            value={settings().title}
            maxLength={1_000}
            placeholder="No title"
            onInput={(event) => change({ title: event.currentTarget.value })}
          />
        </label>
        <label class="col-span-2 block">
          <span class="mb-1.5 block">Data</span>
          <input
            class={FIELD}
            value={settings().range}
            placeholder="A1:C7"
            aria-invalid={!!error()}
            aria-describedby={error() ? `${id}-error` : `${id}-range`}
            autocapitalize="off"
            spellcheck={false}
            onInput={(event) => change({ range: event.currentTarget.value })}
          />
          <span id={`${id}-range`} class="mt-1 block text-ink-muted">
            The cells to chart, such as A1:C7 or 'Sales'!A1:C7.
          </span>
        </label>
        <fieldset class="col-span-2">
          <legend class="mb-1.5">Series</legend>
          <div class="flex gap-4">
            <For each={['columns', 'rows'] as const}>
              {(orientation) => (
                <label class="flex items-center gap-2 touch:min-h-[44px]">
                  <input
                    type="radio"
                    name={`${id}-orientation`}
                    class="touch:size-[20px]"
                    checked={settings().orientation === orientation}
                    onChange={() => change({ orientation })}
                  />
                  In {orientation}
                </label>
              )}
            </For>
          </div>
        </fieldset>
        <label class="col-span-2 flex items-center gap-2 touch:min-h-[44px]">
          <input
            type="checkbox"
            class="touch:size-[20px]"
            checked={settings().firstRow}
            onChange={(event) =>
              change({ firstRow: event.currentTarget.checked })
            }
          />
          First row is{' '}
          {settings().orientation === 'columns' ? 'series names' : 'labels'}
        </label>
        <label class="col-span-2 flex items-center gap-2 touch:min-h-[44px]">
          <input
            type="checkbox"
            class="touch:size-[20px]"
            checked={settings().firstColumn}
            onChange={(event) =>
              change({ firstColumn: event.currentTarget.checked })
            }
          />
          First column is{' '}
          {settings().orientation === 'columns' ? 'labels' : 'series names'}
        </label>
      </div>
      <Show when={error()}>
        <p id={`${id}-error`} role="alert" class="mt-3 text-xs text-failure">
          {error()}
        </p>
      </Show>
      <div class="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" type="button" onClick={props.onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="strong" type="submit">
          Apply
        </Button>
      </div>
    </form>
  );
}

/** Change a chart's type, title, legend and the cells it charts. */
export function ChartDialog(props: {
  settings: ChartSettings | undefined;
  onApply: (settings: ChartSettings) => string | undefined;
  onClose: () => void;
  onRestoreFocus?: () => void;
}) {
  return (
    <Dialog
      onRestoreFocus={props.onRestoreFocus}
      open={!!props.settings}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      position="center"
      class="w-108"
    >
      <Show when={props.settings} keyed>
        {(settings) => (
          <ChartForm
            settings={settings}
            onApply={props.onApply}
            onClose={props.onClose}
          />
        )}
      </Show>
    </Dialog>
  );
}
