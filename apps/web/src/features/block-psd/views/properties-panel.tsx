/**
 * The Properties panel: what the active layer is and its settings, as in
 * Photoshop. Text layers: font, style, size, color, alignment, tracking,
 * and leading. Fill and shape layers: their color or gradient and the
 * shape's stroke. Adjustment layers: their settings. Masks: density and
 * feather. Layer styles: each effect on or off. Every change is shared
 * live; a slider drag is one undo step.
 */

import type {
  Adjustment,
  Effects,
  Fill,
  Gradient,
  LayerInfo,
  Rgb,
  TextAlign,
  TextLayer,
  TextStyle,
} from '@core/psd-engine/types';
import TextAlignCenter from '@phosphor/text-align-center.svg';
import TextAlignLeft from '@phosphor/text-align-left.svg';
import TextAlignRight from '@phosphor/text-align-right.svg';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { AdjustmentControls } from '../components/adjustment-controls';
import { ColorSwatch } from '../components/color-swatch';
import {
  CheckField,
  createDragKeys,
  NumberField,
  Section,
  SelectField,
  SliderField,
} from '../components/fields';
import { ADJUSTMENT_LABELS } from '../core/adjustments';
import {
  endColor,
  GRADIENT_KINDS,
  GRADIENT_METHODS,
  recolorEnd,
  twoColorGradient,
} from '../core/gradient';
import { leadStyle, postscriptName, realign, restyle } from '../core/text';
import type { PsdEditor } from '../primitives/create-psd-editor';

/** Fonts offered for text: the document's own first, then common ones. */
const COMMON_FONTS = [
  'Inter',
  'Arial',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Roboto',
  'Open Sans',
];
const STYLES = [
  'Regular',
  'Bold',
  'Italic',
  'Bold Italic',
  'Light',
  'Medium',
  'Semibold',
  'Black',
];

const EFFECT_LISTS: { key: keyof Effects; label: string }[] = [
  { key: 'dropShadows', label: 'Drop Shadow' },
  { key: 'innerShadows', label: 'Inner Shadow' },
  { key: 'outerGlows', label: 'Outer Glow' },
  { key: 'innerGlows', label: 'Inner Glow' },
  { key: 'bevels', label: 'Bevel & Emboss' },
  { key: 'satins', label: 'Satin' },
  { key: 'colorOverlays', label: 'Color Overlay' },
  { key: 'gradientOverlays', label: 'Gradient Overlay' },
  { key: 'patternOverlays', label: 'Pattern Overlay' },
  { key: 'strokes', label: 'Stroke' },
];

/** A PostScript name's family and style ("Inter-BoldItalic"). */
function splitFont(postscript: string): { family: string; style: string } {
  const [base, suffix = 'Regular'] = postscript.split('-');
  const family = base.replace(/([a-z])([A-Z])/g, '$1 $2');
  const style =
    suffix
      .replace(/MT$/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/^It$/, 'Italic') || 'Regular';
  return { family, style };
}

export function PropertiesPanel(props: {
  editor: PsdEditor;
  /** Fonts the document's text uses (families). */
  documentFonts: string[];
  /** Opens the text editor on a text layer. */
  onEditText: (id: number) => void;
}) {
  const { editor } = props;
  const keys = createDragKeys('properties');
  const info = () => editor.info();
  const editable = () => editor.enabled();
  const apply = (
    op: Parameters<PsdEditor['apply']>[0][number],
    field: string,
    done: boolean
  ) => {
    void editor.apply([op], keys.key(field));
    if (done) keys.end();
  };

  return (
    <div class="flex flex-col" data-testid="psd-properties-panel">
      <Show
        when={info()}
        fallback={
          <Section title="Properties">
            <p class="text-ink-muted text-xs">
              {editor.summary().width} × {editor.summary().height} px ·{' '}
              {Math.round(editor.summary().resolution)} ppi ·{' '}
              {editor.summary().mode.toUpperCase()} {editor.summary().depth}-bit
            </p>
          </Section>
        }
      >
        {(layer) => (
          <>
            <Section title={titleOf(layer())} testId="psd-properties-layer">
              <Show when={layer().bounds}>
                {(b) => (
                  <p
                    class="text-ink-muted text-xs tabular-nums"
                    data-testid="psd-layer-bounds"
                  >
                    X {b().x} · Y {b().y} · W {b().w} · H {b().h} px
                  </p>
                )}
              </Show>
            </Section>
            <Switch>
              <Match when={layer().text}>
                {(text) => (
                  <TextSection
                    layer={layer()}
                    text={text()}
                    fonts={props.documentFonts}
                    editable={editable()}
                    onEdit={() => props.onEditText(layer().id)}
                    onChange={(next, field, done) =>
                      apply(
                        { op: 'setText', id: layer().id, text: next },
                        field,
                        done
                      )
                    }
                  />
                )}
              </Match>
              <Match when={layer().fill}>
                {(fill) => (
                  <FillSection
                    fill={fill()}
                    layer={layer()}
                    editable={editable()}
                    onFill={(next, done) =>
                      apply(
                        { op: 'setFill', id: layer().id, fill: next },
                        'fill',
                        done
                      )
                    }
                    onStroke={(stroke, done) =>
                      apply(
                        { op: 'setFill', id: layer().id, fill: fill(), stroke },
                        'stroke',
                        done
                      )
                    }
                  />
                )}
              </Match>
              <Match when={layer().adjustment}>
                {(adjustment) => (
                  <Section
                    title={ADJUSTMENT_LABELS[adjustment().type]}
                    testId="psd-properties-adjustment"
                  >
                    <AdjustmentControls
                      adjustment={adjustment()}
                      disabled={!editable()}
                      onChange={(next: Adjustment, done) =>
                        apply(
                          {
                            op: 'setAdjustment',
                            id: layer().id,
                            adjustment: next,
                          },
                          'adjustment',
                          done
                        )
                      }
                    />
                  </Section>
                )}
              </Match>
              <Match when={layer().smartObject}>
                {(object) => (
                  <Section title="Smart Object">
                    <p class="text-ink-muted text-xs">
                      {object().fileName ?? 'Embedded content'} · drawn from its
                      stored pixels.
                    </p>
                  </Section>
                )}
              </Match>
            </Switch>
            <Show when={layer().mask}>
              {(mask) => (
                <Section title="Mask" testId="psd-properties-mask">
                  <SliderField
                    label="Density"
                    value={Math.round(mask().density * 100)}
                    min={0}
                    max={100}
                    unit="%"
                    disabled={!editable()}
                    testId="psd-mask-density"
                    onChange={(v, done) =>
                      apply(
                        { op: 'setMask', id: layer().id, density: v / 100 },
                        'density',
                        done
                      )
                    }
                  />
                  <SliderField
                    label="Feather"
                    value={mask().feather}
                    min={0}
                    max={250}
                    step={0.1}
                    unit="px"
                    disabled={!editable()}
                    testId="psd-mask-feather"
                    onChange={(v, done) =>
                      apply(
                        { op: 'setMask', id: layer().id, feather: v },
                        'feather',
                        done
                      )
                    }
                  />
                  <CheckField
                    label="Enabled"
                    checked={!mask().disabled}
                    disabled={!editable()}
                    onChange={(on) =>
                      void editor.apply([
                        { op: 'setMask', id: layer().id, disabled: !on },
                      ])
                    }
                  />
                </Section>
              )}
            </Show>
            <Show when={layer().effects}>
              {(effects) => (
                <Section title="Layer Style" testId="psd-properties-effects">
                  <CheckField
                    label="Effects on"
                    checked={effects().enabled}
                    disabled={!editable()}
                    onChange={(enabled) =>
                      void editor.apply([
                        {
                          op: 'setEffects',
                          id: layer().id,
                          effects: { ...effects(), enabled },
                        },
                      ])
                    }
                  />
                  <For
                    each={EFFECT_LISTS.filter(
                      (e) => (effects()[e.key] as unknown[]).length > 0
                    )}
                  >
                    {(entry) => (
                      <CheckField
                        label={entry.label}
                        checked={(
                          effects()[entry.key] as { enabled: boolean }[]
                        ).some((e) => e.enabled)}
                        disabled={!editable()}
                        onChange={(on) => {
                          const list = (
                            effects()[entry.key] as { enabled: boolean }[]
                          ).map((e) => ({ ...e, enabled: on }));
                          void editor.apply([
                            {
                              op: 'setEffects',
                              id: layer().id,
                              effects: { ...effects(), [entry.key]: list },
                            },
                          ]);
                        }}
                      />
                    )}
                  </For>
                </Section>
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

function titleOf(layer: LayerInfo): string {
  if (layer.text) return 'Type Layer';
  if (layer.kind === 'shape') return 'Shape Layer';
  if (layer.fill) return 'Fill Layer';
  if (layer.adjustment) return 'Adjustment Layer';
  if (layer.kind === 'group') return 'Group';
  if (layer.smartObject) return 'Smart Object';
  return layer.background ? 'Background' : 'Pixel Layer';
}

function TextSection(props: {
  layer: LayerInfo;
  text: TextLayer;
  fonts: string[];
  editable: boolean;
  onEdit: () => void;
  onChange: (text: TextLayer, field: string, done: boolean) => void;
}) {
  const style = (): TextStyle | undefined => leadStyle(props.text);
  const font = () => splitFont(style()?.font ?? 'Inter-Regular');
  const families = () => [
    ...new Set([...props.fonts, font().family, ...COMMON_FONTS]),
  ];
  const set = (patch: Partial<TextStyle>, field: string, done = true) =>
    props.onChange(restyle(props.text, patch), field, done);
  const align = () => props.text.paragraphs[0]?.align ?? 'left';
  const alignButton = (value: TextAlign, label: string, icon: JSX.Element) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={align() === value}
      data-testid={`psd-text-align-${value}`}
      disabled={!props.editable}
      class="flex size-7 items-center justify-center rounded-md"
      classList={{
        'bg-accent/15 text-accent': align() === value,
        'text-ink-muted hover:bg-hover hover:text-ink': align() !== value,
      }}
      onClick={() => props.onChange(realign(props.text, value), 'align', true)}
    >
      {icon}
    </button>
  );
  return (
    <Section title="Character" testId="psd-properties-text">
      <SelectField
        label="Font"
        value={font().family}
        options={families().map((f) => ({ value: f, label: f }))}
        disabled={!props.editable}
        testId="psd-text-font"
        onChange={(family) =>
          set({ font: postscriptName(family, font().style) }, 'font')
        }
      />
      <SelectField
        label="Style"
        value={STYLES.includes(font().style) ? font().style : 'Regular'}
        options={STYLES.map((s) => ({ value: s, label: s }))}
        disabled={!props.editable}
        testId="psd-text-style"
        onChange={(s) =>
          set({ font: postscriptName(font().family, s) }, 'style')
        }
      />
      <div class="flex items-center gap-3">
        <NumberField
          label="Size"
          value={style()?.size ?? 24}
          min={1}
          max={1296}
          step={0.1}
          unit="pt"
          narrow
          disabled={!props.editable}
          testId="psd-text-size"
          onChange={(size) => set({ size }, 'size')}
        />
        <NumberField
          label="Leading"
          value={style()?.leading ?? Math.round((style()?.size ?? 24) * 1.2)}
          min={0}
          max={5000}
          step={0.1}
          narrow
          disabled={!props.editable}
          testId="psd-text-leading"
          onChange={(leading) => set({ leading }, 'leading')}
        />
      </div>
      <SliderField
        label="Tracking"
        value={style()?.tracking ?? 0}
        min={-1000}
        max={10000}
        step={10}
        disabled={!props.editable}
        testId="psd-text-tracking"
        onChange={(tracking, done) => set({ tracking }, 'tracking', done)}
      />
      <ColorSwatch
        label="Color"
        color={style()?.color ?? { r: 0, g: 0, b: 0 }}
        disabled={!props.editable}
        testId="psd-text-color"
        onChange={(color: Rgb, done) => set({ color }, 'color', done)}
      />
      <div class="flex items-center gap-1">
        {alignButton('left', 'Left align', <TextAlignLeft class="size-4" />)}
        {alignButton('center', 'Center', <TextAlignCenter class="size-4" />)}
        {alignButton('right', 'Right align', <TextAlignRight class="size-4" />)}
        <span class="flex-1" />
        <CheckField
          label="Faux Bold"
          checked={style()?.fauxBold ?? false}
          disabled={!props.editable}
          onChange={(fauxBold) => set({ fauxBold }, 'bold')}
        />
      </div>
      <div class="flex items-center gap-3">
        <CheckField
          label="Italic"
          checked={style()?.fauxItalic ?? false}
          disabled={!props.editable}
          onChange={(fauxItalic) => set({ fauxItalic }, 'italic')}
        />
        <CheckField
          label="Underline"
          checked={style()?.underline ?? false}
          disabled={!props.editable}
          onChange={(underline) => set({ underline }, 'underline')}
        />
        <CheckField
          label="Strike"
          checked={style()?.strikethrough ?? false}
          disabled={!props.editable}
          onChange={(strikethrough) => set({ strikethrough }, 'strike')}
        />
      </div>
      <Show when={props.editable}>
        <button
          type="button"
          class="self-start rounded-md border border-edge-muted px-2 py-1 text-ink text-xs hover:bg-hover"
          data-testid="psd-text-edit"
          onClick={() => props.onEdit()}
        >
          Edit text…
        </button>
      </Show>
      <Show when={props.text.warped}>
        <p class="text-ink-muted text-xs">
          Warped text shows as Photoshop drew it until it is edited.
        </p>
      </Show>
    </Section>
  );
}

function FillSection(props: {
  fill: Fill;
  layer: LayerInfo;
  editable: boolean;
  onFill: (fill: Fill, done: boolean) => void;
  onStroke: (stroke: LayerInfo['stroke'], done: boolean) => void;
}) {
  return (
    <>
      <Section
        title={props.layer.kind === 'shape' ? 'Shape Fill' : 'Fill'}
        testId="psd-properties-fill"
      >
        <SelectField
          label="Type"
          value={props.fill.type}
          options={[
            { value: 'solid', label: 'Solid Color' },
            { value: 'gradient', label: 'Gradient' },
            ...(props.fill.type === 'pattern'
              ? [{ value: 'pattern' as const, label: 'Pattern' }]
              : []),
          ]}
          disabled={!props.editable}
          testId="psd-fill-type"
          onChange={(type) => {
            if (type === props.fill.type) return;
            const color =
              props.fill.type === 'solid'
                ? props.fill.color
                : props.fill.type === 'gradient'
                  ? (props.fill.gradient.colors[0]?.color ?? {
                      r: 0,
                      g: 0,
                      b: 0,
                    })
                  : { r: 0, g: 0, b: 0 };
            if (type === 'solid') props.onFill({ type: 'solid', color }, true);
            else if (type === 'gradient')
              props.onFill(
                {
                  type: 'gradient',
                  gradient: twoColorGradient(color, { r: 1, g: 1, b: 1 }),
                },
                true
              );
          }}
        />
        <Switch>
          <Match when={props.fill.type === 'solid' && props.fill}>
            {(f) => (
              <ColorSwatch
                label="Color"
                color={(f() as Extract<Fill, { type: 'solid' }>).color}
                disabled={!props.editable}
                testId="psd-fill-color"
                onChange={(color, done) =>
                  props.onFill({ type: 'solid', color }, done)
                }
              />
            )}
          </Match>
          <Match when={props.fill.type === 'gradient' && props.fill}>
            {(f) => {
              const g = () =>
                (f() as Extract<Fill, { type: 'gradient' }>).gradient;
              const set = (gradient: Gradient, done: boolean) =>
                props.onFill({ type: 'gradient', gradient }, done);
              return (
                <>
                  <ColorSwatch
                    label="From"
                    color={endColor(g(), 'first')}
                    disabled={!props.editable}
                    testId="psd-gradient-from"
                    onChange={(c, done) =>
                      set(recolorEnd(g(), 'first', c), done)
                    }
                  />
                  <ColorSwatch
                    label="To"
                    color={endColor(g(), 'last')}
                    disabled={!props.editable}
                    testId="psd-gradient-to"
                    onChange={(c, done) =>
                      set(recolorEnd(g(), 'last', c), done)
                    }
                  />
                  <SelectField
                    label="Style"
                    value={g().kind}
                    options={GRADIENT_KINDS}
                    disabled={!props.editable}
                    onChange={(kind) => set({ ...g(), kind }, true)}
                  />
                  <SelectField
                    label="Method"
                    value={g().method ?? 'classic'}
                    options={GRADIENT_METHODS}
                    disabled={!props.editable}
                    testId="psd-gradient-method"
                    onChange={(method) => set({ ...g(), method }, true)}
                  />
                  <SliderField
                    label="Angle"
                    value={g().angle}
                    min={-180}
                    max={180}
                    unit="°"
                    disabled={!props.editable}
                    onChange={(angle, done) => set({ ...g(), angle }, done)}
                  />
                </>
              );
            }}
          </Match>
          <Match when={props.fill.type === 'pattern'}>
            <p class="text-ink-muted text-xs">
              A pattern fill, kept as the file has it.
            </p>
          </Match>
        </Switch>
      </Section>
      <Show when={props.layer.kind === 'shape'}>
        <Section title="Stroke" testId="psd-properties-stroke">
          <Show
            when={props.layer.stroke}
            fallback={
              <button
                type="button"
                class="self-start rounded-md border border-edge-muted px-2 py-1 text-ink text-xs hover:bg-hover disabled:opacity-40"
                disabled={!props.editable}
                data-testid="psd-stroke-add"
                onClick={() =>
                  props.onStroke(
                    {
                      enabled: true,
                      fillEnabled: true,
                      width: 3,
                      align: 'inside',
                      cap: 'butt',
                      join: 'miter',
                      miterLimit: 100,
                      dashes: [],
                      dashOffset: 0,
                      opacity: 1,
                      blend: 'normal',
                      fill: { type: 'solid', color: { r: 0, g: 0, b: 0 } },
                    },
                    true
                  )
                }
              >
                Add stroke
              </button>
            }
          >
            {(stroke) => (
              <>
                <CheckField
                  label="Stroke on"
                  checked={stroke().enabled}
                  disabled={!props.editable}
                  onChange={(enabled) =>
                    props.onStroke({ ...stroke(), enabled }, true)
                  }
                />
                <SliderField
                  label="Width"
                  value={stroke().width}
                  min={0}
                  max={288}
                  step={0.5}
                  unit="px"
                  disabled={!props.editable}
                  testId="psd-stroke-width"
                  onChange={(width, done) =>
                    props.onStroke({ ...stroke(), width }, done)
                  }
                />
                <Show when={stroke().fill.type === 'solid' && stroke().fill}>
                  {(f) => (
                    <ColorSwatch
                      label="Color"
                      color={(f() as Extract<Fill, { type: 'solid' }>).color}
                      disabled={!props.editable}
                      onChange={(color, done) =>
                        props.onStroke(
                          { ...stroke(), fill: { type: 'solid', color } },
                          done
                        )
                      }
                    />
                  )}
                </Show>
              </>
            )}
          </Show>
        </Section>
      </Show>
    </>
  );
}
