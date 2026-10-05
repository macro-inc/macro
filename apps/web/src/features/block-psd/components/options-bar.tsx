/**
 * The options bar above the canvas: the settings of the tool in use, as
 * in Photoshop (the brush's size, hardness, opacity, and flow; selection
 * feather and anti-aliasing; tolerance and contiguity; the gradient's
 * style; new text's font and size), and the commit and cancel buttons of
 * Free Transform and Crop. Presentational.
 */

import type { GradientKind } from '@core/psd-engine/types';
import Check from '@phosphor/check.svg';
import X from '@phosphor/x.svg';
import { type JSX, Match, Show, Switch } from 'solid-js';
import type { BrushSettings } from '../core/brush';
import { SELECTION_TOOLS, TOOL_LABELS, type Tool } from '../core/tools';
import { CheckField, NumberField, SelectField } from './fields';

/** What the bar shows for a tool's options (the editor's `ToolOptions`). */
export interface OptionsBarOptions {
  autoSelect: boolean;
  tolerance: number;
  contiguous: boolean;
  sampleAll: boolean;
  antialias: boolean;
  feather: number;
  gradient: GradientKind;
  fontSize: number;
}

const percent = (v: number) => Math.round(v * 100);

export function OptionsBar(props: {
  tool: Tool;
  brush: BrushSettings;
  options: OptionsBarOptions;
  /** A box is being transformed or cropped: its commit and cancel. */
  pending?: { label: string; detail?: string };
  onBrush: (patch: Partial<BrushSettings>) => void;
  onOptions: (patch: Partial<OptionsBarOptions>) => void;
  onCommit: () => void;
  onCancel: () => void;
  /** Extra controls at the right (zoom). */
  children?: JSX.Element;
}) {
  const painting = () =>
    props.tool === 'brush' ||
    props.tool === 'pencil' ||
    props.tool === 'eraser';
  return (
    <div
      class="flex h-10 shrink-0 items-center gap-4 overflow-x-auto border-edge-muted border-b bg-panel px-3"
      data-testid="psd-options-bar"
    >
      <span
        class="shrink-0 font-medium text-ink text-xs"
        data-testid="psd-options-tool"
      >
        {props.pending?.label ?? TOOL_LABELS[props.tool]}
      </span>
      <Show
        when={!props.pending}
        fallback={
          <>
            <Show when={props.pending?.detail}>
              <span class="text-ink-muted text-xs tabular-nums">
                {props.pending?.detail}
              </span>
            </Show>
            <button
              type="button"
              aria-label="Cancel"
              title="Cancel · Esc"
              data-testid="psd-options-cancel"
              class="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
              onClick={() => props.onCancel()}
            >
              <X class="size-4" />
            </button>
            <button
              type="button"
              aria-label="Commit"
              title="Commit · Enter"
              data-testid="psd-options-commit"
              class="flex size-7 items-center justify-center rounded-md text-accent hover:bg-hover"
              onClick={() => props.onCommit()}
            >
              <Check class="size-4" />
            </button>
          </>
        }
      >
        <Switch>
          <Match when={painting()}>
            <NumberField
              label="Size"
              value={props.brush.size}
              min={1}
              max={5000}
              unit="px"
              narrow
              testId="psd-brush-size"
              onChange={(size) => props.onBrush({ size })}
            />
            <Show when={props.tool !== 'pencil'}>
              <NumberField
                label="Hardness"
                value={percent(props.brush.hardness)}
                min={0}
                max={100}
                unit="%"
                narrow
                testId="psd-brush-hardness"
                onChange={(v) => props.onBrush({ hardness: v / 100 })}
              />
            </Show>
            <NumberField
              label="Opacity"
              value={percent(props.brush.opacity)}
              min={1}
              max={100}
              unit="%"
              narrow
              testId="psd-brush-opacity"
              onChange={(v) => props.onBrush({ opacity: v / 100 })}
            />
            <Show when={props.tool !== 'pencil'}>
              <NumberField
                label="Flow"
                value={percent(props.brush.flow)}
                min={1}
                max={100}
                unit="%"
                narrow
                testId="psd-brush-flow"
                onChange={(v) => props.onBrush({ flow: v / 100 })}
              />
            </Show>
            <NumberField
              label="Spacing"
              value={percent(props.brush.spacing)}
              min={1}
              max={1000}
              unit="%"
              narrow
              testId="psd-brush-spacing"
              onChange={(v) => props.onBrush({ spacing: v / 100 })}
            />
            <CheckField
              label="Pressure size"
              checked={props.brush.pressureSize}
              onChange={(pressureSize) => props.onBrush({ pressureSize })}
            />
            <CheckField
              label="Pressure flow"
              checked={props.brush.pressureOpacity}
              onChange={(pressureOpacity) => props.onBrush({ pressureOpacity })}
            />
          </Match>
          <Match when={props.tool === 'move'}>
            <CheckField
              label="Auto-Select layer"
              checked={props.options.autoSelect}
              testId="psd-move-auto-select"
              onChange={(autoSelect) => props.onOptions({ autoSelect })}
            />
            <span class="text-ink-muted text-xs">
              Drag to move · ⌥ drag copies · arrows nudge · ⌘T transforms
            </span>
          </Match>
          <Match
            when={SELECTION_TOOLS.has(props.tool) && props.tool !== 'wand'}
          >
            <NumberField
              label="Feather"
              value={props.options.feather}
              min={0}
              max={1000}
              step={0.1}
              unit="px"
              narrow
              testId="psd-select-feather"
              onChange={(feather) => props.onOptions({ feather })}
            />
            <CheckField
              label="Anti-alias"
              checked={props.options.antialias}
              onChange={(antialias) => props.onOptions({ antialias })}
            />
            <span class="text-ink-muted text-xs">
              ⇧ adds · ⌥ subtracts · ⇧⌥ intersects
            </span>
          </Match>
          <Match when={props.tool === 'wand' || props.tool === 'bucket'}>
            <NumberField
              label="Tolerance"
              value={props.options.tolerance}
              min={0}
              max={255}
              narrow
              testId="psd-tolerance"
              onChange={(tolerance) =>
                props.onOptions({ tolerance: Math.round(tolerance) })
              }
            />
            <CheckField
              label="Anti-alias"
              checked={props.options.antialias}
              onChange={(antialias) => props.onOptions({ antialias })}
            />
            <CheckField
              label="Contiguous"
              checked={props.options.contiguous}
              testId="psd-contiguous"
              onChange={(contiguous) => props.onOptions({ contiguous })}
            />
            <CheckField
              label="Sample All Layers"
              checked={props.options.sampleAll}
              onChange={(sampleAll) => props.onOptions({ sampleAll })}
            />
          </Match>
          <Match when={props.tool === 'gradient'}>
            <SelectField
              label="Style"
              value={props.options.gradient}
              options={[
                { value: 'linear', label: 'Linear' },
                { value: 'radial', label: 'Radial' },
                { value: 'angle', label: 'Angle' },
                { value: 'reflected', label: 'Reflected' },
                { value: 'diamond', label: 'Diamond' },
              ]}
              testId="psd-gradient-style"
              onChange={(gradient) => props.onOptions({ gradient })}
            />
            <span class="text-ink-muted text-xs">
              Foreground to background · ⇧ snaps to 45°
            </span>
          </Match>
          <Match when={props.tool === 'type'}>
            <NumberField
              label="Size"
              value={props.options.fontSize}
              min={1}
              max={1296}
              unit="pt"
              narrow
              testId="psd-type-size"
              onChange={(fontSize) => props.onOptions({ fontSize })}
            />
            <span class="text-ink-muted text-xs">
              Click to place text, or click text to edit it
            </span>
          </Match>
          <Match when={props.tool === 'rectangle' || props.tool === 'ellipse'}>
            <span class="text-ink-muted text-xs">
              Drag to draw a shape layer in the foreground color · ⇧ keeps it
              even · ⌥ from the center
            </span>
          </Match>
          <Match when={props.tool === 'crop'}>
            <span class="text-ink-muted text-xs">
              Drag the box or its handles · Enter crops
            </span>
          </Match>
          <Match when={props.tool === 'eyedropper'}>
            <span class="text-ink-muted text-xs">
              Click picks the foreground color · ⌥ the background
            </span>
          </Match>
          <Match when={props.tool === 'zoom'}>
            <span class="text-ink-muted text-xs">
              Click zooms in · ⌥ click zooms out
            </span>
          </Match>
        </Switch>
      </Show>
      <span class="flex-1" />
      {props.children}
    </div>
  );
}
