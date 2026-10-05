/**
 * The right panel: the selected layer's properties as Figma's design panel
 * shows them (editable when `onPatch` is given), CSS as Dev Mode writes
 * it, and export. Presentational: data and actions come in as props.
 */

import type {
  EffectInfo,
  NodeInfo,
  PageSummary,
  PaintInfo,
  TextInfo,
} from '@core/fig-engine/types';
import AlignBottom from '@phosphor/align-bottom.svg';
import AlignCenterHorizontal from '@phosphor/align-center-horizontal.svg';
import AlignCenterVertical from '@phosphor/align-center-vertical.svg';
import AlignLeft from '@phosphor/align-left.svg';
import AlignRight from '@phosphor/align-right.svg';
import AlignTop from '@phosphor/align-top.svg';
import Copy from '@phosphor/copy.svg';
import DownloadSimple from '@phosphor/download-simple.svg';
import Minus from '@phosphor/minus.svg';
import Plus from '@phosphor/plus.svg';
import { Button } from '@ui/components/Button';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type { Alignment } from '../core/align';
import type { BooleanOperation } from '../core/boolean';
import { cssColor, cssFor } from '../core/css';
import { formatMeasure } from '../core/measure';
import { formatLetterSpacing, formatLineHeight } from '../core/type';
import type { PaintSpec, Patch } from '../primitives/create-fig-editor';
import {
  AutoLayoutControls,
  ConstraintControls,
  SizingControls,
} from './auto-layout-controls';
import { BooleanButtons } from './boolean-controls';
import {
  NumberField,
  PaintEditRow,
  paintHex,
  TextField,
} from './design-fields';
import { EffectList } from './effect-controls';
import { TypeControls } from './type-controls';

function Section(props: {
  title: string;
  children: JSX.Element;
  /** A "+" action in the header (add a fill, say). */
  onAdd?: () => void;
  /** A "−" action in the header (remove auto layout, say). */
  onRemove?: () => void;
  testId?: string;
}) {
  return (
    <section
      class="border-edge-muted border-b px-3 py-3"
      data-testid={props.testId}
    >
      <div class="mb-2 flex items-center justify-between">
        <h3 class="font-semibold text-ink text-xs">{props.title}</h3>
        <Show when={props.onAdd}>
          {(add) => (
            <button
              type="button"
              aria-label={`Add ${props.title.toLowerCase()}`}
              class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
              onClick={() => add()()}
            >
              <Plus class="size-3.5" />
            </button>
          )}
        </Show>
        <Show when={props.onRemove}>
          {(remove) => (
            <button
              type="button"
              aria-label={`Remove ${props.title.toLowerCase()}`}
              class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
              onClick={() => remove()()}
            >
              <Minus class="size-3.5" />
            </button>
          )}
        </Show>
      </div>
      <div class="flex flex-col gap-1.5">{props.children}</div>
    </section>
  );
}

/** Paint specs that keep every paint except `edit` applied to one. */
function paintSpecs(
  paints: PaintInfo[],
  index: number,
  edit: (spec: PaintSpec, paint: PaintInfo) => PaintSpec | null
): PaintSpec[] {
  const out: PaintSpec[] = [];
  paints.forEach((p, k) => {
    const spec: PaintSpec = { keep: k };
    const next = k === index ? edit(spec, p) : spec;
    if (next) out.push(next);
  });
  return out;
}

/** Editable paint list (fills or strokes), top paint first as in Figma. */
function PaintList(props: {
  paints: PaintInfo[];
  kind: 'fill' | 'stroke';
  onChange: (specs: PaintSpec[], live: boolean) => void;
}) {
  const indexed = () =>
    props.paints.map((paint, index) => ({ paint, index })).reverse();
  const change = (
    index: number,
    edit: (spec: PaintSpec, paint: PaintInfo) => PaintSpec | null,
    live = false
  ) => props.onChange(paintSpecs(props.paints, index, edit), live);
  return (
    <For each={indexed()}>
      {({ paint, index }) => (
        <PaintEditRow
          paint={paint}
          swatch={swatchBackground(paint)}
          label={paintLabel(paint)}
          testId={`fig-${props.kind}-${index}`}
          onColor={(hex) =>
            change(index, (spec, p) => ({
              ...spec,
              color:
                hex.length === 6 && (p.alpha ?? 1) < 1
                  ? (paintHex({ ...p, color: hex }) ?? hex)
                  : hex,
            }))
          }
          onOpacity={(opacity, live) =>
            change(index, (spec) => ({ ...spec, opacity }), live)
          }
          onToggle={() =>
            change(index, (spec, p) => ({ ...spec, visible: !p.visible }))
          }
          onRemove={() => change(index, () => null)}
        />
      )}
    </For>
  );
}

function Field(props: { label: string; value: string | number }) {
  return (
    <div class="flex min-w-0 items-center gap-2 rounded-md bg-inset px-2 py-1">
      <span class="shrink-0 text-ink-muted">{props.label}</span>
      <span
        class="min-w-0 truncate text-ink tabular-nums"
        title={String(props.value)}
      >
        {props.value}
      </span>
    </div>
  );
}

const fmt = (v: number) => formatMeasure(v);

const hasCorners = (type: string) =>
  ['FRAME', 'RECTANGLE', 'ROUNDED_RECTANGLE', 'SYMBOL', 'INSTANCE'].includes(
    type
  );

function radiusLabel(r: {
  top_left: number;
  top_right: number;
  bottom_right: number;
  bottom_left: number;
}): string {
  return r.top_left === r.top_right &&
    r.top_left === r.bottom_left &&
    r.top_left === r.bottom_right
    ? fmt(r.top_left)
    : [r.top_left, r.top_right, r.bottom_right, r.bottom_left]
        .map(fmt)
        .join(', ');
}
const percent = (v: number) => `${Math.round(v * 100)}%`;
const title = (s: string) =>
  s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

function swatchBackground(p: PaintInfo): string {
  if (p.type === 'SOLID' && p.color) return cssColor(p.color, p.alpha ?? 1);
  if (p.stops) {
    const stops = p.stops
      .map((s) => `${cssColor(s.color, s.alpha)} ${s.position * 100}%`)
      .join(', ');
    return `linear-gradient(90deg, ${stops})`;
  }
  return 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px';
}

function paintLabel(p: PaintInfo): string {
  if (p.type === 'SOLID' && p.color) return p.color;
  if (p.type === 'IMAGE') return `Image · ${title(p.scaleMode ?? 'FILL')}`;
  return (
    title(p.type.replace('GRADIENT_', '')) +
    (p.type.startsWith('GRADIENT') ? ' gradient' : '')
  );
}

function PaintRow(props: { paint: PaintInfo }) {
  const p = () => props.paint;
  return (
    <div
      class="flex items-center gap-2 rounded-md bg-inset px-2 py-1"
      classList={{ 'opacity-50': !p().visible }}
    >
      <span
        class="size-4 shrink-0 rounded-sm border border-edge-muted"
        style={{ background: swatchBackground(p()) }}
      />
      <span class="min-w-0 flex-1 truncate font-mono text-ink">
        {paintLabel(p())}
      </span>
      <Show when={p().type === 'SOLID' && (p().alpha ?? 1) < 1}>
        <span class="text-ink-muted tabular-nums">
          {percent(p().alpha ?? 1)}
        </span>
      </Show>
      <Show when={p().opacity < 1}>
        <span class="text-ink-muted tabular-nums">{percent(p().opacity)}</span>
      </Show>
    </div>
  );
}

function EffectRow(props: { effect: EffectInfo }) {
  const e = () => props.effect;
  const shadow = () =>
    e().type === 'DROP_SHADOW' || e().type === 'INNER_SHADOW';
  return (
    <div
      class="flex flex-col gap-1 rounded-md bg-inset px-2 py-1"
      classList={{ 'opacity-50': !e().visible }}
    >
      <span class="text-ink">{title(e().type)}</span>
      <Show
        when={shadow()}
        fallback={<span class="text-ink-muted">Blur {fmt(e().radius)}</span>}
      >
        <span class="text-ink-muted tabular-nums">
          X {fmt(e().x)} · Y {fmt(e().y)} · Blur {fmt(e().radius)} · Spread{' '}
          {fmt(e().spread)} · #{e().color} {percent(e().alpha)}
        </span>
      </Show>
    </div>
  );
}

const canHaveAutoLayout = (type: string) => ['FRAME', 'SYMBOL'].includes(type);

function AutoLayoutFields(props: { info: NodeInfo }) {
  return (
    <Show when={props.info.autoLayout}>
      {(al) => (
        <Section title="Auto layout">
          <div class="grid grid-cols-2 gap-1.5">
            <Field label="Direction" value={title(al().mode)} />
            <Field label="Gap" value={fmt(al().spacing)} />
            <Field
              label="Padding"
              value={[
                al().paddingTop,
                al().paddingRight,
                al().paddingBottom,
                al().paddingLeft,
              ]
                .map(fmt)
                .join(' ')}
            />
            <Show when={al().primaryAlign}>
              {(a) => <Field label="Align" value={title(a())} />}
            </Show>
          </div>
        </Section>
      )}
    </Show>
  );
}

function TextFields(props: { text: TextInfo }) {
  const t = () => props.text;
  return (
    <>
      <Field
        label="Font"
        value={[t().fontFamily, t().fontStyle].filter(Boolean).join(' ')}
      />
      <div class="grid grid-cols-2 gap-1.5">
        <Show when={t().fontSize}>
          {(size) => <Field label="Size" value={fmt(size())} />}
        </Show>
        <Field label="Line" value={formatLineHeight(t().lineHeight)} />
        <Show when={t().letterSpacing}>
          <Field
            label="Letter"
            value={formatLetterSpacing(t().letterSpacing)}
          />
        </Show>
        <Show when={t().alignHorizontal}>
          {(a) => <Field label="Align" value={title(a())} />}
        </Show>
      </div>
    </>
  );
}

export function DesignPanel(props: {
  info: NodeInfo | undefined;
  selectionCount: number;
  /** Edits the selection; absent when the file is read-only. */
  onPatch?: (patch: Patch, live: boolean) => void;
  /** Aligns the selection; absent when the file is read-only. */
  onAlign?: (how: Alignment) => void;
  page: PageSummary | undefined;
  onExport: (scale: number) => void;
  onExportSvg: () => void;
  onCopySvg: () => void;
  onCopyPng: () => void;
  /** Boolean operations on the selection; absent when read-only. */
  onBoolean?: (operation: BooleanOperation) => void;
  onFlatten?: () => void;
  onCopyText: (text: string) => void;
  /** Font families text can be set in. */
  fontFamilies?: readonly string[];
  /** Adds auto layout to the selection (⇧A); absent when read-only. */
  onAddAutoLayout?: () => void;
}) {
  const [tab, setTab] = createSignal<'design' | 'code'>('design');
  return (
    <div
      class="flex size-full min-h-0 flex-col text-ink text-xs"
      data-testid="fig-design-panel"
    >
      <div class="flex h-9 shrink-0 items-center gap-1 border-edge-muted border-b px-2">
        <For each={['design', 'code'] as const}>
          {(t) => (
            <button
              type="button"
              class="rounded-md px-2 py-1 font-medium"
              classList={{
                'bg-hover text-ink': tab() === t,
                'text-ink-muted': tab() !== t,
              }}
              onClick={() => setTab(t)}
            >
              {t === 'design' ? 'Design' : 'Code'}
            </button>
          )}
        </For>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <Show
          when={props.onAlign && props.selectionCount > 0 && tab() === 'design'}
        >
          <AlignRow onAlign={(how) => props.onAlign?.(how)} />
        </Show>
        <Show
          when={
            props.onBoolean &&
            tab() === 'design' &&
            (props.selectionCount > 1 ||
              props.info?.type === 'BOOLEAN_OPERATION')
          }
        >
          <BooleanButtons
            current={
              props.info?.type === 'BOOLEAN_OPERATION'
                ? ((props.info.booleanOperation ?? 'UNION') as BooleanOperation)
                : undefined
            }
            onBoolean={(op) => props.onBoolean?.(op)}
            onFlatten={() => props.onFlatten?.()}
          />
        </Show>
        <Show
          when={props.info}
          fallback={
            <Show when={props.page}>
              {(page) => (
                <Section title="Page">
                  <Field label="Name" value={page().name} />
                  <div class="flex items-center gap-2 rounded-md bg-inset px-2 py-1">
                    <span
                      class="size-4 rounded-sm border border-edge-muted"
                      style={{
                        background: `rgb(${page()
                          .background.slice(0, 3)
                          .map((v) => Math.round(v * 255))
                          .join(',')})`,
                      }}
                    />
                    <span class="text-ink-muted">Canvas color</span>
                  </div>
                  <Show when={props.selectionCount > 1}>
                    <span class="text-ink-muted">
                      {props.selectionCount} layers selected
                    </span>
                  </Show>
                </Section>
              )}
            </Show>
          }
        >
          {(info) => (
            <Show
              when={tab() === 'design'}
              fallback={<CodeTab info={info()} onCopy={props.onCopyText} />}
            >
              <div class="border-edge-muted border-b px-3 py-3">
                <Show
                  when={props.onPatch}
                  fallback={
                    <div
                      class="truncate font-semibold text-sm"
                      title={info().name}
                    >
                      {info().name}
                    </div>
                  }
                >
                  {(patch) => (
                    <TextField
                      value={info().name}
                      class="-mx-1 font-semibold text-sm"
                      testId="fig-name"
                      onChange={(name) => patch()({ name }, false)}
                    />
                  )}
                </Show>
                <div class="text-ink-muted">
                  {info().typeLabel}
                  <Show when={info().mainComponent}>
                    {(main) => <> of {main()}</>}
                  </Show>
                </div>
                <Show when={info().description}>
                  {(d) => <p class="mt-1 text-ink-muted">{d()}</p>}
                </Show>
              </div>
              <Section title="Layout">
                <Show
                  when={props.onPatch && !info().id.startsWith('I')}
                  fallback={
                    <div class="grid grid-cols-2 gap-1.5">
                      <Field label="X" value={fmt(info().x)} />
                      <Field label="Y" value={fmt(info().y)} />
                      <Field label="W" value={fmt(info().width)} />
                      <Field label="H" value={fmt(info().height)} />
                      <Show when={Math.abs(info().rotation) > 0.01}>
                        <Field label="↻" value={`${fmt(info().rotation)}°`} />
                      </Show>
                      <Show when={info().cornerRadius}>
                        {(r) => (
                          <Field label="Radius" value={radiusLabel(r())} />
                        )}
                      </Show>
                    </div>
                  }
                >
                  <div class="grid grid-cols-2 gap-1.5">
                    <NumberField
                      label="X"
                      value={info().x}
                      testId="fig-field-x"
                      onChange={(x, live) => props.onPatch?.({ x }, live)}
                    />
                    <NumberField
                      label="Y"
                      value={info().y}
                      testId="fig-field-y"
                      onChange={(y, live) => props.onPatch?.({ y }, live)}
                    />
                    <NumberField
                      label="W"
                      value={info().width}
                      min={0.01}
                      testId="fig-field-w"
                      onChange={(width, live) =>
                        props.onPatch?.({ width }, live)
                      }
                    />
                    <NumberField
                      label="H"
                      value={info().height}
                      min={0.01}
                      testId="fig-field-h"
                      onChange={(height, live) =>
                        props.onPatch?.({ height }, live)
                      }
                    />
                    <NumberField
                      label="↻"
                      value={info().rotation}
                      testId="fig-field-rotation"
                      onChange={(rotation, live) =>
                        props.onPatch?.({ rotation }, live)
                      }
                    />
                    <Show when={info().cornerRadius || hasCorners(info().type)}>
                      <NumberField
                        label="◜"
                        value={info().cornerRadius?.top_left ?? 0}
                        min={0}
                        testId="fig-field-radius"
                        onChange={(cornerRadius, live) =>
                          props.onPatch?.({ cornerRadius }, live)
                        }
                      />
                    </Show>
                  </div>
                  <SizingControls
                    info={info()}
                    onPatch={(patch, live) => props.onPatch?.(patch, live)}
                  />
                  <Show when={info().layoutParent}>
                    {(positioning) => (
                      <label class="flex items-center gap-2 text-ink-muted">
                        <input
                          type="checkbox"
                          checked={positioning() === 'ABSOLUTE'}
                          data-testid="fig-absolute"
                          onChange={(e) =>
                            props.onPatch?.(
                              {
                                layoutPositioning: e.currentTarget.checked
                                  ? 'ABSOLUTE'
                                  : 'AUTO',
                              },
                              false
                            )
                          }
                        />
                        Absolute position
                      </label>
                    )}
                  </Show>
                  <Show when={info().type === 'FRAME'}>
                    <label class="flex items-center gap-2 text-ink-muted">
                      <input
                        type="checkbox"
                        checked={info().clipsContent}
                        data-testid="fig-clip-content"
                        onChange={(e) =>
                          props.onPatch?.(
                            { clipContent: e.currentTarget.checked },
                            false
                          )
                        }
                      />
                      Clip content
                    </label>
                  </Show>
                </Show>
                <Show
                  when={props.onPatch && info().constrained}
                  fallback={
                    <>
                      <Show
                        when={
                          !props.onPatch &&
                          info().clipsContent &&
                          info().childCount > 0
                        }
                      >
                        <span class="text-ink-muted">Clips content</span>
                      </Show>
                      <Show when={info().constraints}>
                        {(c) => (
                          <span class="text-ink-muted">
                            Constraints: {title(c()[0])} · {title(c()[1])}
                          </span>
                        )}
                      </Show>
                    </>
                  }
                >
                  <ConstraintControls
                    constraints={info().constraints}
                    onPatch={(patch) => props.onPatch?.(patch, false)}
                  />
                </Show>
              </Section>
              <Show
                when={props.onPatch && !info().id.startsWith('I')}
                fallback={<AutoLayoutFields info={info()} />}
              >
                <Show
                  when={info().autoLayout}
                  fallback={
                    <Show when={canHaveAutoLayout(info().type)}>
                      <Section
                        title="Auto layout"
                        testId="fig-auto-layout-section"
                        onAdd={props.onAddAutoLayout}
                      >
                        <span class="text-ink-muted">⇧A adds auto layout</span>
                      </Section>
                    </Show>
                  }
                >
                  {(al) => (
                    <Section
                      title="Auto layout"
                      testId="fig-auto-layout-section"
                      onRemove={() =>
                        props.onPatch?.({ layoutMode: 'NONE' }, false)
                      }
                    >
                      <Show
                        when={
                          (al().mode === 'HORIZONTAL' ||
                            al().mode === 'VERTICAL') &&
                          !al().wrap
                        }
                        fallback={
                          <span class="text-ink-muted">
                            {title(al().mode)}
                            {al().wrap ? ' (wrap)' : ''}: kept as laid out in
                            Figma
                          </span>
                        }
                      >
                        <AutoLayoutControls
                          layout={al()}
                          onPatch={(patch, live) =>
                            props.onPatch?.(patch, live)
                          }
                        />
                      </Show>
                    </Section>
                  )}
                </Show>
              </Show>
              <Section title="Appearance">
                <div class="grid grid-cols-2 gap-1.5">
                  <Show
                    when={props.onPatch}
                    fallback={
                      <Field label="Opacity" value={percent(info().opacity)} />
                    }
                  >
                    <NumberField
                      label="◐"
                      value={info().opacity}
                      percent
                      min={0}
                      max={1}
                      testId="fig-field-opacity"
                      onChange={(opacity, live) =>
                        props.onPatch?.({ opacity }, live)
                      }
                    />
                  </Show>
                  <Field label="Blend" value={title(info().blendMode)} />
                </div>
              </Section>
              <Show when={info().text}>
                {(t) => (
                  <Section title="Text">
                    <Show
                      when={props.onPatch}
                      fallback={<TextFields text={t()} />}
                    >
                      <TypeControls
                        text={t()}
                        families={props.fontFamilies ?? ['Inter']}
                        onPatch={(patch, live) => props.onPatch?.(patch, live)}
                      />
                    </Show>
                    <Show when={t().fonts.length > 0}>
                      <span class="text-ink-muted">
                        Also uses {t().fonts.join(', ')}
                      </span>
                    </Show>
                    <div class="relative">
                      <p
                        class="max-h-40 select-text overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-inset px-2 py-1.5 text-ink"
                        data-testid="fig-text-content"
                      >
                        {t().characters}
                        {t().truncated ? '…' : ''}
                      </p>
                      <button
                        type="button"
                        aria-label="Copy text"
                        class="absolute top-1 right-1 rounded p-0.5 text-ink-muted hover:text-ink"
                        onClick={() => props.onCopyText(t().characters)}
                      >
                        <Copy class="size-3" />
                      </button>
                    </div>
                  </Section>
                )}
              </Show>
              <Show
                when={props.onPatch}
                fallback={
                  <Show when={info().fills.length > 0}>
                    <Section title="Fill">
                      <For each={[...info().fills].reverse()}>
                        {(p) => <PaintRow paint={p} />}
                      </For>
                    </Section>
                  </Show>
                }
              >
                <Section
                  title="Fill"
                  testId="fig-fills"
                  onAdd={() =>
                    props.onPatch?.(
                      {
                        fills: [
                          ...info().fills.map((_, keep) => ({ keep })),
                          {
                            color:
                              info().type === 'FRAME' ? 'FFFFFF' : 'D9D9D9',
                          },
                        ],
                      },
                      false
                    )
                  }
                >
                  <PaintList
                    paints={info().fills}
                    kind="fill"
                    onChange={(fills, live) => props.onPatch?.({ fills }, live)}
                  />
                </Section>
              </Show>
              <Show when={props.onPatch}>
                <Section
                  title="Stroke"
                  testId="fig-strokes"
                  onAdd={() =>
                    props.onPatch?.(
                      {
                        strokes: [
                          ...info().strokes.map((_, keep) => ({ keep })),
                          { color: '000000' },
                        ],
                        ...(info().strokes.length === 0
                          ? { strokeWeight: 1 }
                          : {}),
                      },
                      false
                    )
                  }
                >
                  <PaintList
                    paints={info().strokes}
                    kind="stroke"
                    onChange={(strokes, live) =>
                      props.onPatch?.({ strokes }, live)
                    }
                  />
                  <Show when={info().strokes.length > 0}>
                    <div class="grid grid-cols-2 gap-1.5">
                      <NumberField
                        label="≡"
                        value={info().strokeWeight ?? 1}
                        min={0}
                        testId="fig-field-stroke-weight"
                        onChange={(strokeWeight, live) =>
                          props.onPatch?.({ strokeWeight }, live)
                        }
                      />
                      <select
                        class="rounded-md bg-inset px-2 py-1 text-ink outline-none"
                        value={info().strokeAlign ?? 'CENTER'}
                        onChange={(e) =>
                          props.onPatch?.(
                            {
                              strokeAlign: e.currentTarget
                                .value as Patch['strokeAlign'],
                            },
                            false
                          )
                        }
                      >
                        <option value="INSIDE">Inside</option>
                        <option value="CENTER">Center</option>
                        <option value="OUTSIDE">Outside</option>
                      </select>
                    </div>
                  </Show>
                </Section>
              </Show>
              <Show when={info().strokes.length > 0 && !props.onPatch}>
                <Section title="Stroke">
                  <For each={[...info().strokes].reverse()}>
                    {(p) => <PaintRow paint={p} />}
                  </For>
                  <div class="grid grid-cols-2 gap-1.5">
                    <Show when={info().strokeWeight !== null}>
                      <Field
                        label="Weight"
                        value={fmt(info().strokeWeight ?? 0)}
                      />
                    </Show>
                    <Show when={info().strokeAlign}>
                      {(a) => <Field label="Position" value={title(a())} />}
                    </Show>
                    <Show when={info().dashPattern}>
                      {(d) => (
                        <Field label="Dash" value={d().map(fmt).join(', ')} />
                      )}
                    </Show>
                  </div>
                </Section>
              </Show>
              <Show
                when={props.onPatch}
                fallback={
                  <Show when={info().effects.length > 0}>
                    <Section title="Effects">
                      <For each={info().effects}>
                        {(e) => <EffectRow effect={e} />}
                      </For>
                    </Section>
                  </Show>
                }
              >
                <Section
                  title="Effects"
                  testId="fig-effects"
                  onAdd={() =>
                    props.onPatch?.(
                      {
                        effects: [
                          ...info().effects.map((_, keep) => ({ keep })),
                          {},
                        ],
                      },
                      false
                    )
                  }
                >
                  <EffectList
                    effects={info().effects}
                    onChange={(effects, live) =>
                      props.onPatch?.({ effects }, live)
                    }
                  />
                </Section>
              </Show>
              <Show when={info().componentProperties.length > 0}>
                <Section title="Properties">
                  <For each={info().componentProperties}>
                    {(p) => <Field label={title(p.kind)} value={p.name} />}
                  </For>
                </Section>
              </Show>
              <Section title="Export">
                <div class="flex flex-wrap gap-1.5">
                  <For each={[1, 2, 3]}>
                    {(scale) => (
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`fig-export-${scale}x`}
                        onClick={() => props.onExport(scale)}
                      >
                        <DownloadSimple />
                        PNG {scale}x
                      </Button>
                    )}
                  </For>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="fig-export-svg"
                    onClick={props.onExportSvg}
                  >
                    <DownloadSimple />
                    SVG
                  </Button>
                  <Button variant="outline" size="sm" onClick={props.onCopyPng}>
                    <Copy />
                    Copy
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="fig-copy-svg"
                    onClick={props.onCopySvg}
                  >
                    <Copy />
                    Copy as SVG
                  </Button>
                </div>
              </Section>
            </Show>
          )}
        </Show>
      </div>
    </div>
  );
}

const ALIGN_BUTTONS: {
  how: Alignment;
  label: string;
  icon: (props: { class?: string }) => JSX.Element;
}[] = [
  { how: 'left', label: 'Align left', icon: AlignLeft },
  {
    how: 'center',
    label: 'Align horizontal centers',
    icon: AlignCenterHorizontal,
  },
  { how: 'right', label: 'Align right', icon: AlignRight },
  { how: 'top', label: 'Align top', icon: AlignTop },
  { how: 'middle', label: 'Align vertical centers', icon: AlignCenterVertical },
  { how: 'bottom', label: 'Align bottom', icon: AlignBottom },
];

function AlignRow(props: { onAlign: (how: Alignment) => void }) {
  return (
    <div class="flex items-center justify-between border-edge-muted border-b px-2 py-1.5">
      <For each={ALIGN_BUTTONS}>
        {(b) => (
          <button
            type="button"
            aria-label={b.label}
            title={b.label}
            data-testid={`fig-align-${b.how}`}
            class="rounded p-1 text-ink-muted hover:bg-hover hover:text-ink"
            onClick={() => props.onAlign(b.how)}
          >
            {b.icon({ class: 'size-4' })}
          </button>
        )}
      </For>
    </div>
  );
}

function CodeTab(props: { info: NodeInfo; onCopy: (text: string) => void }) {
  const css = () => cssFor(props.info).join('\n');
  return (
    <Section title="CSS">
      <div class="relative">
        <pre
          class="select-text overflow-x-auto whitespace-pre rounded-md bg-inset p-2 font-mono text-ink"
          data-testid="fig-css"
        >
          {css()}
        </pre>
        <button
          type="button"
          aria-label="Copy CSS"
          class="absolute top-1 right-1 rounded p-0.5 text-ink-muted hover:text-ink"
          onClick={() => props.onCopy(css())}
        >
          <Copy class="size-3" />
        </button>
      </div>
    </Section>
  );
}
