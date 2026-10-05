/**
 * The format pane's Effects section (shadow, reflection, glow, and soft
 * edges, each with its preset gallery and numeric options) and, for
 * pictures, its Picture section (corrections, recolor, transparency, and
 * crop), both reading the selection's current values from the outline.
 */

import type {
  EffectsOutline,
  PictureRecolor,
  ShapeOutline,
} from '@core/pptx-engine/types';
import { Popover } from '@kobalte/core/popover';
import { Button } from '@ui/components/Button';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { shadowPreset } from '../core/effects';
import { swatchCss } from '../core/palette';
import { NO_CROP, RECOLOR_ROWS, recolorLabel } from '../core/picture';
import type { EffectsChange } from '../primitives/create-editor-commands';
import { ColorPicker, NumberField } from './ribbon/controls';
import {
  type GalleryColors,
  GlowGallery,
  galleryColors,
  ReflectionGallery,
  ShadowGallery,
  SoftEdgeGallery,
} from './ribbon/effects-menu';
import type { RibbonEnv } from './ribbon/ribbon';

function Group(props: {
  title: string;
  testId: string;
  children: JSX.Element;
  open?: boolean;
}) {
  const [open, setOpen] = createSignal(props.open ?? false);
  return (
    <div class="border-edge-muted border-b py-2" data-testid={props.testId}>
      <button
        type="button"
        class="flex w-full items-center gap-1 px-3 py-1 font-semibold text-ink text-xs"
        aria-expanded={open()}
        onClick={() => setOpen((o) => !o)}
      >
        <span class="inline-block w-3 text-ink-muted">
          {open() ? '▾' : '▸'}
        </span>
        {props.title}
      </button>
      <Show when={open()}>
        <div class="flex flex-col gap-2 px-3 pt-1 pb-1">{props.children}</div>
      </Show>
    </div>
  );
}

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex items-center justify-between gap-2 text-xs">
      <span class="shrink-0 text-ink-muted">{props.label}</span>
      <div class="flex items-center gap-1.5">{props.children}</div>
    </div>
  );
}

/**
 * Applies values while a slider is dragged, one engine call at a time; the
 * whole drag is one undo step.
 */
function liveApplier(apply: (value: number, group?: string) => unknown) {
  let group: string | undefined;
  let running = false;
  let pending: number | undefined;
  let drags = 0;
  const run = async () => {
    running = true;
    while (pending !== undefined) {
      const value = pending;
      pending = undefined;
      await apply(value, group);
    }
    running = false;
  };
  return {
    start: () => {
      group = `pane-slider:${Date.now()}:${++drags}`;
    },
    end: () => {
      group = undefined;
    },
    set: (value: number) => {
      pending = value;
      if (!running) void run();
    },
  };
}

/**
 * A slider with a number box, as in PowerPoint's format pane. Dragging
 * applies live; the number box commits on Enter.
 */
function SliderField(props: {
  label: string;
  /** In display units (percent, points, degrees). */
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  unit: string;
  disabled?: boolean;
  testId: string;
  onApply: (value: number, group?: string) => unknown;
}) {
  const [dragging, setDragging] = createSignal<number>();
  const live = liveApplier(props.onApply);
  const shown = () => dragging() ?? props.value;
  return (
    <Row label={props.label}>
      <input
        type="range"
        aria-label={props.label}
        class="w-20 accent-accent"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={shown() ?? props.min}
        disabled={props.disabled}
        onPointerDown={() => live.start()}
        onInput={(e) => {
          const v = Number(e.currentTarget.value);
          setDragging(v);
          live.set(v);
        }}
        onChange={() => {
          live.end();
          setDragging(undefined);
        }}
      />
      <div class="flex w-[4.75rem] justify-end">
        <NumberField
          label={props.label}
          unit={props.unit}
          value={shown()}
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          precision={1}
          width="2.25rem"
          disabled={props.disabled}
          testId={props.testId}
          onCommit={(v) => void props.onApply(v)}
        />
      </div>
    </Row>
  );
}

/** A swatch button opening the color picker. */
function ColorButton(props: {
  label: string;
  value: string | undefined;
  colors: GalleryColors;
  testId: string;
  disabled?: boolean;
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-end"
      gutter={4}
    >
      <Popover.Trigger
        class="flex h-7 items-center gap-1 rounded-md border border-edge-muted bg-input px-1.5 text-xs disabled:opacity-50"
        aria-label={props.label}
        disabled={props.disabled}
        data-testid={props.testId}
      >
        <span
          class="size-4 rounded-sm border border-edge-muted"
          style={{
            background:
              swatchCss(props.value, props.colors.themeColors) ?? 'transparent',
          }}
        />
        <span class="text-ink-muted">▾</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-action-menu rounded-xl border border-edge bg-menu p-2 shadow-xl outline-none">
          <ColorPicker
            themeGrid={props.colors.themeGrid}
            standard={props.colors.standard}
            onPick={(v) => {
              setOpen(false);
              if (v) props.onPick(v);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

/** A "Presets" button opening an effect's gallery. */
function PresetsButton(props: {
  label: string;
  testId: string;
  disabled?: boolean;
  children: (close: () => void) => JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-end"
      gutter={4}
    >
      <Popover.Trigger
        class="flex h-7 min-w-24 items-center justify-between gap-1 rounded-md border border-edge-muted bg-input px-1.5 text-ink text-xs disabled:opacity-50"
        disabled={props.disabled}
        data-testid={props.testId}
      >
        <span class="truncate">{props.label}</span>
        <span class="text-ink-muted">▾</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-action-menu rounded-xl border border-edge bg-menu p-2 text-ink text-xs shadow-xl outline-none">
          {props.children(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

const pct = (v: number | undefined) =>
  v === undefined ? undefined : Math.round(v * 1000) / 10;

/** What each effect group of the pane reads and writes. */
interface EffectGroupProps {
  effects: EffectsOutline | undefined;
  colors: GalleryColors;
  readonly: boolean;
  set: (change: EffectsChange, group?: string) => unknown;
}

function ShadowGroup(props: EffectGroupProps) {
  const shadow = () => props.effects?.shadow;
  const presetLabel = () => {
    const s = shadow();
    if (!s) return 'No Shadow';
    return (s.preset && shadowPreset(s.preset)?.label) || 'Custom';
  };
  return (
    <Group title="Shadow" testId="pptx-pane-shadow" open>
      <Row label="Presets">
        <PresetsButton
          label={presetLabel()}
          testId="pptx-pane-shadow-presets"
          disabled={props.readonly}
        >
          {(close) => (
            <ShadowGallery
              current={shadow()}
              testPrefix="pptx-pane-shadow-preset"
              onPick={(spec) => {
                close();
                void props.set({ shadow: spec });
              }}
            />
          )}
        </PresetsButton>
      </Row>
      <Row label="Color">
        <ColorButton
          label="Shadow color"
          value={shadow()?.color}
          colors={props.colors}
          disabled={props.readonly}
          testId="pptx-pane-shadow-color"
          onPick={(color) => void props.set({ shadow: { color } })}
        />
      </Row>
      <SliderField
        label="Transparency"
        unit="%"
        min={0}
        max={100}
        value={pct(shadow()?.transparency)}
        disabled={props.readonly}
        testId="pptx-pane-shadow-transparency"
        onApply={(v, g) => props.set({ shadow: { transparency: v / 100 } }, g)}
      />
      <SliderField
        label="Size"
        unit="%"
        min={1}
        max={200}
        value={shadow()?.sizePct}
        disabled={props.readonly || shadow()?.kind === 'inner'}
        testId="pptx-pane-shadow-size"
        onApply={(v, g) => props.set({ shadow: { sizePct: v } }, g)}
      />
      <SliderField
        label="Blur"
        unit="pt"
        min={0}
        max={100}
        value={shadow()?.blurPt}
        disabled={props.readonly}
        testId="pptx-pane-shadow-blur"
        onApply={(v, g) => props.set({ shadow: { blurPt: v } }, g)}
      />
      <SliderField
        label="Angle"
        unit="°"
        min={0}
        max={359}
        value={shadow()?.angleDeg}
        disabled={props.readonly}
        testId="pptx-pane-shadow-angle"
        onApply={(v, g) => props.set({ shadow: { angleDeg: v } }, g)}
      />
      <SliderField
        label="Distance"
        unit="pt"
        min={0}
        max={200}
        value={shadow()?.distancePt}
        disabled={props.readonly}
        testId="pptx-pane-shadow-distance"
        onApply={(v, g) => props.set({ shadow: { distancePt: v } }, g)}
      />
    </Group>
  );
}

function ReflectionGroup(props: EffectGroupProps) {
  const reflection = () => props.effects?.reflection;
  const accent = () =>
    swatchCss('accent1', props.colors.themeColors) ?? '#4472C4';
  return (
    <Group title="Reflection" testId="pptx-pane-reflection">
      <Row label="Presets">
        <PresetsButton
          label={reflection() ? 'Reflection' : 'No Reflection'}
          testId="pptx-pane-reflection-presets"
          disabled={props.readonly}
        >
          {(close) => (
            <ReflectionGallery
              current={reflection()}
              accent={accent()}
              testPrefix="pptx-pane-reflection-preset"
              onPick={(spec) => {
                close();
                void props.set({ reflection: spec });
              }}
            />
          )}
        </PresetsButton>
      </Row>
      <SliderField
        label="Transparency"
        unit="%"
        min={0}
        max={100}
        value={pct(reflection()?.transparency)}
        disabled={props.readonly}
        testId="pptx-pane-reflection-transparency"
        onApply={(v, g) =>
          props.set({ reflection: { transparency: v / 100 } }, g)
        }
      />
      <SliderField
        label="Size"
        unit="%"
        min={1}
        max={100}
        value={reflection()?.sizePct}
        disabled={props.readonly}
        testId="pptx-pane-reflection-size"
        onApply={(v, g) => props.set({ reflection: { sizePct: v } }, g)}
      />
      <SliderField
        label="Distance"
        unit="pt"
        min={0}
        max={100}
        value={reflection()?.distancePt}
        disabled={props.readonly}
        testId="pptx-pane-reflection-distance"
        onApply={(v, g) => props.set({ reflection: { distancePt: v } }, g)}
      />
      <SliderField
        label="Blur"
        unit="pt"
        min={0}
        max={100}
        value={reflection()?.blurPt}
        disabled={props.readonly}
        testId="pptx-pane-reflection-blur"
        onApply={(v, g) => props.set({ reflection: { blurPt: v } }, g)}
      />
    </Group>
  );
}

function GlowGroup(props: EffectGroupProps) {
  const glow = () => props.effects?.glow;
  return (
    <Group title="Glow" testId="pptx-pane-glow">
      <Row label="Presets">
        <PresetsButton
          label={glow() ? `${glow()?.sizePt} pt glow` : 'No Glow'}
          testId="pptx-pane-glow-presets"
          disabled={props.readonly}
        >
          {(close) => (
            <GlowGallery
              current={glow()}
              colors={props.colors}
              testPrefix="pptx-pane-glow-preset"
              onPick={(spec) => {
                close();
                void props.set({ glow: spec });
              }}
            />
          )}
        </PresetsButton>
      </Row>
      <Row label="Color">
        <ColorButton
          label="Glow color"
          value={glow()?.color}
          colors={props.colors}
          disabled={props.readonly}
          testId="pptx-pane-glow-color"
          onPick={(color) => void props.set({ glow: { color } })}
        />
      </Row>
      <SliderField
        label="Size"
        unit="pt"
        min={0}
        max={150}
        value={glow()?.sizePt}
        disabled={props.readonly}
        testId="pptx-pane-glow-size"
        onApply={(v, g) => props.set({ glow: { sizePt: v } }, g)}
      />
      <SliderField
        label="Transparency"
        unit="%"
        min={0}
        max={100}
        value={pct(glow()?.transparency)}
        disabled={props.readonly}
        testId="pptx-pane-glow-transparency"
        onApply={(v, g) => props.set({ glow: { transparency: v / 100 } }, g)}
      />
    </Group>
  );
}

function SoftEdgeGroup(props: EffectGroupProps) {
  const softEdge = () => props.effects?.softEdge;
  const accent = () =>
    swatchCss('accent1', props.colors.themeColors) ?? '#4472C4';
  return (
    <Group title="Soft Edges" testId="pptx-pane-soft-edges">
      <Row label="Presets">
        <PresetsButton
          label={softEdge() ? `${softEdge()?.sizePt} Point` : 'No Soft Edges'}
          testId="pptx-pane-soft-edge-presets"
          disabled={props.readonly}
        >
          {(close) => (
            <SoftEdgeGallery
              current={softEdge()}
              accent={accent()}
              testPrefix="pptx-pane-soft-edge-preset"
              onPick={(size) => {
                close();
                void props.set({
                  softEdge: size === 'none' ? 'none' : { sizePt: size },
                });
              }}
            />
          )}
        </PresetsButton>
      </Row>
      <SliderField
        label="Size"
        unit="pt"
        min={0}
        max={100}
        value={softEdge()?.sizePt ?? 0}
        disabled={props.readonly}
        testId="pptx-pane-soft-edge-size"
        onApply={(v, g) =>
          props.set({ softEdge: v > 0 ? { sizePt: v } : 'none' }, g)
        }
      />
    </Group>
  );
}

/** Shadow, Reflection, Glow, and Soft Edges for the selected shapes. */
export function EffectsPaneSections(props: { env: RibbonEnv }) {
  const env = props.env;
  const effects = () => env.selection()[0]?.effects;
  const colors = () => galleryColors(env);
  const set = (change: EffectsChange, group?: string) =>
    env.commands.setShapeEffects(change, group);
  return (
    <div data-testid="pptx-pane-effects">
      <ShadowGroup
        effects={effects()}
        colors={colors()}
        readonly={env.readonly()}
        set={set}
      />
      <ReflectionGroup
        effects={effects()}
        colors={colors()}
        readonly={env.readonly()}
        set={set}
      />
      <GlowGroup
        effects={effects()}
        colors={colors()}
        readonly={env.readonly()}
        set={set}
      />
      <SoftEdgeGroup
        effects={effects()}
        colors={colors()}
        readonly={env.readonly()}
        set={set}
      />
    </div>
  );
}

/** Corrections, recolor, transparency, and crop of the selected pictures. */
export function PicturePaneSections(props: { env: RibbonEnv }) {
  const env = props.env;
  const c = env.commands;
  const ro = () => env.readonly();
  const picture = (): ShapeOutline | undefined =>
    env.selection().find((s) => s.kind === 'picture');
  const info = () => picture()?.picture;
  const crop = () => info()?.crop ?? NO_CROP;
  const recolors = RECOLOR_ROWS.flatMap((row) => row.presets);
  return (
    <div data-testid="pptx-pane-picture">
      <Show
        when={picture()}
        fallback={
          <p class="p-3 text-ink-muted text-xs">
            Select a picture to adjust it.
          </p>
        }
      >
        <Group title="Picture Corrections" testId="pptx-pane-corrections" open>
          <SliderField
            label="Brightness"
            unit="%"
            min={-100}
            max={100}
            value={pct(info()?.brightness)}
            disabled={ro()}
            testId="pptx-pane-brightness"
            onApply={(v, g) => c.formatPicture({ brightness: v / 100 }, g)}
          />
          <SliderField
            label="Contrast"
            unit="%"
            min={-100}
            max={100}
            value={pct(info()?.contrast)}
            disabled={ro()}
            testId="pptx-pane-contrast"
            onApply={(v, g) => c.formatPicture({ contrast: v / 100 }, g)}
          />
          <div class="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={ro()}
              data-testid="pptx-pane-corrections-reset"
              onClick={() =>
                void c.formatPicture({ brightness: 0, contrast: 0 })
              }
            >
              Reset
            </Button>
          </div>
        </Group>
        <Group title="Picture Color" testId="pptx-pane-color" open>
          <Row label="Recolor">
            <select
              aria-label="Recolor"
              data-testid="pptx-pane-recolor"
              class="h-7 max-w-40 rounded-md border border-edge-muted bg-input px-1 text-ink text-xs"
              disabled={ro()}
              value={info()?.recolor ?? 'none'}
              onChange={(e) =>
                void c.formatPicture({
                  recolor: e.currentTarget.value as PictureRecolor,
                })
              }
            >
              <Show when={!recolors.some((r) => r.value === info()?.recolor)}>
                <option value={info()?.recolor}>
                  {recolorLabel(info()?.recolor ?? 'none')}
                </option>
              </Show>
              <For each={recolors}>
                {(r) => <option value={r.value}>{r.label}</option>}
              </For>
            </select>
          </Row>
        </Group>
        <Group
          title="Picture Transparency"
          testId="pptx-pane-transparency-group"
          open
        >
          <SliderField
            label="Transparency"
            unit="%"
            min={0}
            max={100}
            value={pct(info()?.transparency)}
            disabled={ro()}
            testId="pptx-pane-transparency"
            onApply={(v, g) => c.formatPicture({ transparency: v / 100 }, g)}
          />
        </Group>
        <Group title="Crop" testId="pptx-pane-crop" open>
          <p class="text-ink-muted text-xs">
            Percent of the picture cut off each side (negative adds space).
          </p>
          <For
            each={
              [
                ['Left', 'left'],
                ['Top', 'top'],
                ['Right', 'right'],
                ['Bottom', 'bottom'],
              ] as const
            }
          >
            {([label, edge]) => (
              <Row label={label}>
                <NumberField
                  label={`Crop ${label.toLowerCase()}`}
                  unit="%"
                  value={pct(crop()[edge])}
                  min={-500}
                  max={99}
                  precision={1}
                  disabled={ro()}
                  testId={`pptx-pane-crop-${edge}`}
                  onCommit={(v) =>
                    void c.cropPictures(() => ({ [edge]: v / 100 }))
                  }
                />
              </Row>
            )}
          </For>
          <div class="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="outline"
              disabled={ro()}
              onClick={() => void c.fitPictures('fill')}
            >
              Fill
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={ro()}
              onClick={() => void c.fitPictures('fit')}
            >
              Fit
            </Button>
          </div>
        </Group>
        <div class="flex justify-end p-3">
          <Button
            size="sm"
            variant="outline"
            disabled={ro()}
            data-testid="pptx-pane-picture-reset"
            onClick={() => void c.resetPictures(true)}
          >
            Reset Picture & Size
          </Button>
        </div>
      </Show>
    </div>
  );
}
