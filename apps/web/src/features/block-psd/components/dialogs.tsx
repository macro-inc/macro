/**
 * The editor's dialogs: Image Size, Canvas Size, the filters (with a live
 * preview on the canvas), Image > Adjustments, one-number dialogs
 * (Feather, Expand, Contract, Resolution), and the keyboard shortcuts.
 * Presentational: they report values; the editor applies them.
 */

import type {
  Adjustment,
  FilterSpec,
  Interpolation,
} from '@core/psd-engine/types';
import XIcon from '@phosphor/x.svg';
import { cn } from '@ui';
import { Button } from '@ui/components/Button';
import {
  createSignal,
  For,
  type JSX,
  Match,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { ADJUSTMENT_LABELS } from '../core/adjustments';
import { defaultFilter, FILTER_TITLES, type FilterKind } from '../core/filters';
import { SHORTCUT_GROUPS } from '../core/shortcuts';
import { AdjustmentControls } from './adjustment-controls';
import { CheckField, NumberField, SelectField, SliderField } from './fields';

function DialogShell(props: {
  title: string;
  testId: string;
  children: JSX.Element;
  okLabel?: string;
  /**
   * The dialog previews its result on the canvas: nothing dims the canvas
   * and the dialog stands aside at the top right.
   */
  previews?: boolean;
  onCancel: () => void;
  onOk?: () => void;
}) {
  let panel!: HTMLDivElement;
  onMount(() => {
    // The first field takes the keys.
    panel.querySelector<HTMLElement>('input, select, button')?.focus();
  });
  return (
    <div
      class={cn(
        'absolute inset-0 z-40 flex items-start',
        props.previews
          ? 'justify-end p-4'
          : 'justify-center bg-modal-overlay pt-[10vh]'
      )}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onCancel();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-label={props.title}
        data-testid={props.testId}
        class="flex w-80 flex-col gap-3 rounded-xl border border-edge-muted bg-dialog p-4 text-ink shadow-xl"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') props.onCancel();
          if (e.key === 'Enter' && props.onOk) {
            e.preventDefault();
            (document.activeElement as HTMLElement | null)?.blur();
            props.onOk();
          }
        }}
      >
        <h2 class="font-semibold text-sm">{props.title}</h2>
        {props.children}
        <div class="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid={`${props.testId}-cancel`}
            onClick={() => props.onCancel()}
          >
            Cancel
          </Button>
          <Show when={props.onOk}>
            <Button
              variant="cta"
              size="sm"
              data-testid={`${props.testId}-ok`}
              onClick={() => props.onOk?.()}
            >
              {props.okLabel ?? 'OK'}
            </Button>
          </Show>
        </div>
      </div>
    </div>
  );
}

const INTERPOLATIONS = [
  { value: 'bicubic', label: 'Bicubic' },
  { value: 'bilinear', label: 'Bilinear' },
  { value: 'nearest', label: 'Nearest Neighbor' },
] as const;

export function ImageSizeDialog(props: {
  width: number;
  height: number;
  onCancel: () => void;
  onApply: (
    width: number,
    height: number,
    interpolation: Interpolation
  ) => void;
}) {
  const [width, setWidth] = createSignal(props.width);
  const [height, setHeight] = createSignal(props.height);
  const [keep, setKeep] = createSignal(true);
  const [interpolation, setInterpolation] =
    createSignal<Interpolation>('bicubic');
  const ratio = props.width / Math.max(1, props.height);
  return (
    <DialogShell
      title="Image Size"
      testId="psd-image-size"
      onCancel={props.onCancel}
      onOk={() => props.onApply(width(), height(), interpolation())}
    >
      <NumberField
        label="Width"
        value={width()}
        min={1}
        max={300000}
        unit="px"
        testId="psd-image-size-width"
        onChange={(w) => {
          setWidth(Math.round(w));
          if (keep()) setHeight(Math.max(1, Math.round(w / ratio)));
        }}
      />
      <NumberField
        label="Height"
        value={height()}
        min={1}
        max={300000}
        unit="px"
        testId="psd-image-size-height"
        onChange={(h) => {
          setHeight(Math.round(h));
          if (keep()) setWidth(Math.max(1, Math.round(h * ratio)));
        }}
      />
      <CheckField
        label="Constrain proportions"
        checked={keep()}
        onChange={setKeep}
      />
      <SelectField
        label="Resample"
        value={interpolation()}
        options={INTERPOLATIONS}
        onChange={setInterpolation}
      />
    </DialogShell>
  );
}

export function CanvasSizeDialog(props: {
  width: number;
  height: number;
  onCancel: () => void;
  onApply: (width: number, height: number, anchor: [number, number]) => void;
}) {
  const [width, setWidth] = createSignal(props.width);
  const [height, setHeight] = createSignal(props.height);
  const [anchor, setAnchor] = createSignal<[number, number]>([0.5, 0.5]);
  return (
    <DialogShell
      title="Canvas Size"
      testId="psd-canvas-size"
      onCancel={props.onCancel}
      onOk={() => props.onApply(width(), height(), anchor())}
    >
      <NumberField
        label="Width"
        value={width()}
        min={1}
        max={300000}
        unit="px"
        testId="psd-canvas-size-width"
        onChange={(w) => setWidth(Math.round(w))}
      />
      <NumberField
        label="Height"
        value={height()}
        min={1}
        max={300000}
        unit="px"
        testId="psd-canvas-size-height"
        onChange={(h) => setHeight(Math.round(h))}
      />
      <div class="flex items-center gap-3 text-ink-muted text-xs">
        <span>Anchor</span>
        <div class="grid grid-cols-3 gap-0.5">
          <For each={[0, 0.5, 1]}>
            {(y) => (
              <For each={[0, 0.5, 1]}>
                {(x) => (
                  <button
                    type="button"
                    aria-label={`Anchor ${x}, ${y}`}
                    aria-pressed={anchor()[0] === x && anchor()[1] === y}
                    class="size-5 rounded-sm border border-edge-muted"
                    classList={{
                      'bg-accent': anchor()[0] === x && anchor()[1] === y,
                      'bg-input hover:bg-hover': !(
                        anchor()[0] === x && anchor()[1] === y
                      ),
                    }}
                    onClick={() => setAnchor([x, y])}
                  />
                )}
              </For>
            )}
          </For>
        </div>
      </div>
    </DialogShell>
  );
}

/**
 * A filter's settings with Preview: while it is on, every change shows on
 * the canvas (`onPreview`); OK keeps it, Cancel takes it back.
 */
export function FilterDialog(props: {
  filter: FilterKind;
  onPreview: (spec: FilterSpec | null) => void;
  onCancel: () => void;
  onApply: (spec: FilterSpec) => void;
}) {
  const [spec, setSpec] = createSignal<FilterSpec>(defaultFilter(props.filter));
  const [preview, setPreview] = createSignal(true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = (next: FilterSpec) => {
    setSpec(next);
    if (!preview()) return;
    // Settle before previewing large blurs.
    clearTimeout(timer);
    timer = setTimeout(() => props.onPreview(next), 120);
  };
  onMount(() => props.onPreview(spec()));
  const s = <T extends FilterSpec['type']>() =>
    spec() as Extract<FilterSpec, { type: T }>;
  return (
    <DialogShell
      title={FILTER_TITLES[props.filter]}
      testId="psd-filter-dialog"
      previews
      onCancel={() => {
        clearTimeout(timer);
        props.onCancel();
      }}
      onOk={() => {
        clearTimeout(timer);
        props.onApply(spec());
      }}
    >
      <Switch>
        <Match when={spec().type === 'gaussianBlur'}>
          <SliderField
            label="Radius"
            value={s<'gaussianBlur'>().radius}
            min={0.1}
            max={250}
            step={0.1}
            unit="px"
            testId="psd-filter-radius"
            onChange={(radius) => update({ type: 'gaussianBlur', radius })}
          />
        </Match>
        <Match when={spec().type === 'unsharpMask'}>
          <SliderField
            label="Amount"
            value={Math.round(s<'unsharpMask'>().amount * 100)}
            min={1}
            max={500}
            unit="%"
            onChange={(v) => update({ ...s<'unsharpMask'>(), amount: v / 100 })}
          />
          <SliderField
            label="Radius"
            value={s<'unsharpMask'>().radius}
            min={0.1}
            max={250}
            step={0.1}
            unit="px"
            onChange={(radius) => update({ ...s<'unsharpMask'>(), radius })}
          />
          <SliderField
            label="Threshold"
            value={s<'unsharpMask'>().threshold}
            min={0}
            max={255}
            onChange={(threshold) =>
              update({
                ...s<'unsharpMask'>(),
                threshold: Math.round(threshold),
              })
            }
          />
        </Match>
        <Match when={spec().type === 'addNoise'}>
          <SliderField
            label="Amount"
            value={Math.round(s<'addNoise'>().amount * 1000) / 10}
            min={0.1}
            max={400}
            step={0.1}
            unit="%"
            onChange={(v) => update({ ...s<'addNoise'>(), amount: v / 100 })}
          />
          <CheckField
            label="Gaussian"
            checked={s<'addNoise'>().gaussian}
            onChange={(gaussian) => update({ ...s<'addNoise'>(), gaussian })}
          />
          <CheckField
            label="Monochromatic"
            checked={s<'addNoise'>().monochrome}
            onChange={(monochrome) =>
              update({ ...s<'addNoise'>(), monochrome })
            }
          />
        </Match>
        <Match when={spec().type === 'mosaic'}>
          <SliderField
            label="Cell Size"
            value={s<'mosaic'>().cell}
            min={2}
            max={200}
            unit="px"
            onChange={(cell) =>
              update({ type: 'mosaic', cell: Math.round(cell) })
            }
          />
        </Match>
        <Match when={spec().type === 'motionBlur'}>
          <SliderField
            label="Angle"
            value={s<'motionBlur'>().angle}
            min={-90}
            max={90}
            unit="°"
            onChange={(angle) => update({ ...s<'motionBlur'>(), angle })}
          />
          <SliderField
            label="Distance"
            value={s<'motionBlur'>().distance}
            min={1}
            max={2000}
            unit="px"
            onChange={(distance) => update({ ...s<'motionBlur'>(), distance })}
          />
        </Match>
      </Switch>
      <CheckField
        label="Preview"
        checked={preview()}
        testId="psd-filter-preview"
        onChange={(on) => {
          setPreview(on);
          props.onPreview(on ? spec() : null);
        }}
      />
    </DialogShell>
  );
}

/** Image > Adjustments: an adjustment applied to the pixels, previewed live. */
export function AdjustDialog(props: {
  adjustment: Adjustment;
  onPreview: (adjustment: Adjustment | null) => void;
  onCancel: () => void;
  onApply: (adjustment: Adjustment) => void;
}) {
  const [adjustment, setAdjustment] = createSignal(props.adjustment);
  const [preview, setPreview] = createSignal(true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onMount(() => props.onPreview(adjustment()));
  return (
    <DialogShell
      title={ADJUSTMENT_LABELS[props.adjustment.type]}
      testId="psd-adjust-dialog"
      previews
      onCancel={() => {
        clearTimeout(timer);
        props.onCancel();
      }}
      onOk={() => {
        clearTimeout(timer);
        props.onApply(adjustment());
      }}
    >
      <AdjustmentControls
        adjustment={adjustment()}
        onChange={(next) => {
          setAdjustment(next);
          if (!preview()) return;
          clearTimeout(timer);
          timer = setTimeout(() => props.onPreview(next), 80);
        }}
      />
      <CheckField
        label="Preview"
        checked={preview()}
        onChange={(on) => {
          setPreview(on);
          props.onPreview(on ? adjustment() : null);
        }}
      />
    </DialogShell>
  );
}

/** A dialog that asks for one number (Feather, Expand, Contract, Resolution). */
export function NumberDialog(props: {
  title: string;
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  testId: string;
  onCancel: () => void;
  onApply: (value: number) => void;
}) {
  const [value, setValue] = createSignal(props.value);
  return (
    <DialogShell
      title={props.title}
      testId={props.testId}
      onCancel={props.onCancel}
      onOk={() => props.onApply(value())}
    >
      <NumberField
        label={props.label}
        value={value()}
        min={props.min}
        max={props.max}
        step={0.1}
        unit={props.unit}
        testId={`${props.testId}-value`}
        onChange={setValue}
      />
    </DialogShell>
  );
}

export function ShortcutsDialog(props: { mac: boolean; onClose: () => void }) {
  const cap = (k: string) => (k === 'mod' ? (props.mac ? '⌘' : 'Ctrl') : k);
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      data-testid="psd-shortcuts"
      class="absolute inset-x-4 bottom-10 z-30 mx-auto max-h-[70%] max-w-3xl overflow-y-auto rounded-xl border border-edge-muted bg-menu p-4 text-ink text-xs shadow-xl"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-semibold text-sm">Keyboard shortcuts</h2>
        <button
          type="button"
          aria-label="Close"
          class="rounded p-1 text-ink-muted hover:text-ink"
          onClick={() => props.onClose()}
        >
          <XIcon class="size-3.5" />
        </button>
      </div>
      <div class="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
        <For each={SHORTCUT_GROUPS}>
          {(group) => (
            <div>
              <h3 class="mb-1.5 font-medium text-ink-muted">{group.title}</h3>
              <For each={group.items}>
                {(item) => (
                  <div class="flex items-center justify-between gap-2 py-0.5">
                    <span>{item.action}</span>
                    <span class="flex gap-0.5">
                      <For each={item.keys}>
                        {(k) => (
                          <kbd class="rounded border border-edge-muted bg-inset px-1 font-sans">
                            {cap(k)}
                          </kbd>
                        )}
                      </For>
                    </span>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
