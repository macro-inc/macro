import CircleHalf from '@phosphor/circle-half.svg';
import CornersOut from '@phosphor/corners-out.svg';
import List from '@phosphor/list.svg';
import { InspectorSelect } from './inspector-select';
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
import { Tabs } from '@kobalte/core/tabs';
import Copy from '@phosphor/copy.svg';
import DiamondsFour from '@phosphor/diamonds-four.svg';
import Eye from '@phosphor/eye.svg';
import EyeSlash from '@phosphor/eye-slash.svg';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type { Alignment } from '../core/align';
import type { BooleanOperation } from '../core/boolean';
import { cssFor } from '../core/css';
import type { StyleKind } from '../core/design-system';
import { formatMeasure } from '../core/measure';
import type { MixedInfo } from '../core/mixed';
import { formatDashes, parseDashes } from '../core/paint';
import type { MixedTextField } from '../core/rich-text';
import { formatLetterSpacing, formatLineHeight } from '../core/type';
import type { Patch } from '../primitives/create-fig-editor';
import { BooleanButtons, BooleanMenu } from './boolean-controls';
import { ColorPicker } from './color-picker';
import { NumberField, ParsedField, TextField } from './design-fields';
import { EffectList } from './effect-controls';
import { LayoutSection, PositionSection } from './geometry-sections';
import { MixedFields } from './mixed-fields';
import { PaintList, paintLabel, paintSwatch } from './paint-controls';
import { Section } from './panel-section';
import { SwatchPopover } from './swatch-popover';
import { TypeControls } from './type-controls';

function CreateComponentButton(props: { onCreate: () => void }) {
  return (
    <button
      type="button"
      aria-label="Create component"
      title="Create component"
      data-testid="fig-create-component"
      class="flex size-7 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
      onClick={props.onCreate}
    >
      <DiamondsFour class="size-4" />
    </button>
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

/** A page's canvas color as `RRGGBB`. */
const pageHex = (page: PageSummary) =>
  page.background
    .slice(0, 3)
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase();
const title = (s: string) =>
  s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

function PaintRow(props: { paint: PaintInfo }) {
  const p = () => props.paint;
  return (
    <div
      class="flex items-center gap-2 rounded-md bg-inset px-2 py-1"
      classList={{ 'opacity-50': !p().visible }}
    >
      <span
        class="size-4 shrink-0 rounded-sm border border-edge-muted"
        style={{ background: paintSwatch(p()) }}
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

export type PanelTab = 'design' | 'prototype' | 'code';

const PANEL_TAB_LABELS: Record<PanelTab, string> = {
  design: 'Design',
  prototype: 'Prototype',
  code: 'Code',
};
/** What the Type section offers beyond the layer's own values. */
export interface TypeOptions {
  /** Fields the characters selected in the text editor differ in. */
  mixed?: ReadonlySet<MixedTextField>;
  googleFamilies?: readonly string[];
  /** Weights of the shown family, when known. */
  weights?: readonly number[];
  preview?: (family: string) => Promise<string | undefined>;
  onFontsOpen?: () => void;
}

export function DesignPanel(props: {
  tab?: PanelTab;
  headerActions?: JSX.Element;
  zoom?: JSX.Element;
  info: NodeInfo | undefined;
  selectionCount: number;
  /** Edits the selection; absent when the file is read-only. */
  onPatch?: (patch: Patch, live: boolean) => void;
  /** Aligns the selection; absent when the file is read-only. */
  onAlign?: (how: Alignment) => void;
  onFlip?: (axis: 'horizontal' | 'vertical') => void;
  page: PageSummary | undefined;
  /** The Export section of the selected layer. */
  exportSection?: JSX.Element;
  /** The Layout grid section of the selected frame. */
  layoutGrids?: JSX.Element;
  /** The Code tab's content (Dev Mode inspect); CSS when absent. */
  code?: JSX.Element;
  /** Boolean operations on the selection; absent when read-only. */
  onBoolean?: (operation: BooleanOperation) => void;
  onFlatten?: () => void;
  onCreateComponent?: () => void;
  onCopyText: (text: string) => void;
  /** Font families the document uses. */
  fontFamilies?: readonly string[];
  /** The Type section's font picker and "Mixed" values. */
  type?: TypeOptions;
  /** Adds auto layout to the selection (⇧A); absent when read-only. */
  onAddAutoLayout?: () => void;
  /** Colors the color pickers offer (the page's). */
  swatches?: readonly string[];
  /** A color picker opened (to load the page's colors). */
  onPickerOpen?: () => void;
  /** Adds an image file for an image fill; resolves to its hash. */
  onAddImage?: (file: File) => Promise<string | undefined>;
  /** Sets the page's canvas color; absent when read-only. */
  onPageColor?: (hex: string, live: boolean) => void;
  /** Several selected layers' shared and mixed values. */
  mixed?: MixedInfo;
  /** The Prototype tab's content; the tab shows when it is given. */
  prototype?: JSX.Element;
  onTabChange?: (tab: PanelTab) => void;
  /** Component, variant, and property sections for the selected layer. */
  designSections?: JSX.Element;
  /** Shown with the page when nothing is selected (local styles). */
  pageExtra?: JSX.Element;
  /** The shared style control of a fill, stroke, text, or effect section. */
  styleControl?: (kind: StyleKind) => JSX.Element;
}) {
  const [localTab, setTabSignal] = createSignal<PanelTab>('design');
  const tab = () => props.tab ?? localTab();
  const setTab = (t: PanelTab) => {
    setTabSignal(t);
    props.onTabChange?.(t);
  };
  const tabs = (): PanelTab[] =>
    props.prototype === undefined ? ['design'] : ['design', 'prototype'];
  return (
    <Tabs
      class="flex size-full min-h-0 flex-col text-ink text-xs"
      data-testid="fig-design-panel"
      value={tab() === 'code' ? 'design' : tab()}
      onChange={(value) => setTab(value as PanelTab)}
    >
      <div class="flex h-12 shrink-0 items-center justify-end px-3">
        {props.headerActions}
      </div>
      <div class="flex h-10 shrink-0 items-center gap-1 border-edge-frame border-b px-3">
        <Tabs.List
          aria-label="Inspector"
          class="flex min-w-0 flex-1 items-center gap-1"
        >
          <For each={tabs()}>
            {(t) => (
              <Tabs.Trigger
                value={t}
                class="rounded-md px-2 py-1 font-medium"
                classList={{
                  'bg-hover text-ink':
                    (tab() === 'code' ? 'design' : tab()) === t,
                  'text-ink-muted': (tab() === 'code' ? 'design' : tab()) !== t,
                }}
                data-testid={`fig-panel-tab-${t}`}
                onClick={() => setTab(t)}
              >
                {PANEL_TAB_LABELS[t]}
              </Tabs.Trigger>
            )}
          </For>
        </Tabs.List>
        {props.zoom}
      </div>
      <Show
        when={tab() === 'design' && !props.info && props.selectionCount > 1}
      >
        <div class="flex h-14 shrink-0 items-center justify-between gap-2 border-edge-frame border-b px-3">
          <span class="min-w-0 flex-1 truncate font-medium text-sm">
            {props.selectionCount} layers selected
          </span>
          <Show when={props.onCreateComponent}>
            {(create) => <CreateComponentButton onCreate={create()} />}
          </Show>
          <Show when={props.onBoolean}>
            {(onBoolean) => (
              <BooleanMenu
                onBoolean={onBoolean()}
                onFlatten={() => props.onFlatten?.()}
              />
            )}
          </Show>
        </div>
      </Show>
      <Show when={tab() === 'design' ? props.info : undefined}>
        {(info) => (
          <div class="shrink-0 border-edge-frame border-b px-3 py-3">
            <div class="flex h-7 items-center justify-between gap-2">
              <span class="min-w-0 flex-1 truncate font-medium text-sm">
                {info().typeLabel}
              </span>
              <Show
                when={
                  info().type !== 'SYMBOL' &&
                  info().type !== 'INSTANCE' &&
                  props.onCreateComponent
                }
              >
                {(create) => <CreateComponentButton onCreate={create()} />}
              </Show>
              <Show when={props.onBoolean}>
                {(onBoolean) => (
                  <BooleanMenu
                    onBoolean={onBoolean()}
                    onFlatten={() => props.onFlatten?.()}
                  />
                )}
              </Show>
            </div>
            <Show
              when={props.onPatch}
              fallback={
                <div class="truncate text-ink-muted" title={info().name}>
                  {info().name}
                </div>
              }
            >
              {(patch) => (
                <TextField
                  value={info().name}
                  class="-mx-1 text-ink-muted"
                  testId="fig-name"
                  onChange={(name) => patch()({ name }, false)}
                />
              )}
            </Show>
            <Show when={info().mainComponent}>
              {(main) => <div class="text-ink-muted">Instance of {main()}</div>}
            </Show>
            <Show when={info().description}>
              {(description) => (
                <p class="mt-1 text-ink-muted">{description()}</p>
              )}
            </Show>
          </div>
        )}
      </Show>
      <Tabs.Content
        value="prototype"
        class="min-h-0 flex-1 overflow-y-auto outline-none"
      >
        {props.prototype}
      </Tabs.Content>
      <Tabs.Content
        value="design"
        forceMount
        class="min-h-0 flex-1 overflow-y-auto"
        classList={{ hidden: tab() === 'prototype' }}
      >
        <Show
          when={
            props.onBoolean &&
            tab() === 'design' &&
            props.info?.type === 'BOOLEAN_OPERATION'
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
            <Show
              when={props.selectionCount > 1 && props.mixed}
              fallback={
                <Show when={props.page}>
                  {(page) => (
                    <Section title="Page">
                      <Field label="Name" value={page().name} />
                      <div class="flex items-center gap-2 rounded-md bg-inset px-2 py-1">
                        <Show
                          when={props.onPageColor}
                          fallback={
                            <span
                              class="size-4 rounded-sm border border-edge-muted"
                              style={{ background: `#${pageHex(page())}` }}
                            />
                          }
                        >
                          {(onColor) => (
                            <SwatchPopover
                              swatch={`#${pageHex(page())}`}
                              label="Canvas color"
                              testId="fig-page-color"
                              onOpenChange={(open) => {
                                if (open) props.onPickerOpen?.();
                              }}
                            >
                              <ColorPicker
                                value={pageHex(page())}
                                opaque
                                swatches={props.swatches}
                                onChange={(hex, live) => onColor()(hex, live)}
                              />
                            </SwatchPopover>
                          )}
                        </Show>
                        <span class="text-ink-muted">Canvas color</span>
                        <span class="ml-auto font-mono text-ink-muted">
                          {pageHex(page())}
                        </span>
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
              {(mixed) => (
                <MixedFields
                  mixed={mixed()}
                  onAlign={props.onAlign}
                  onPatch={props.onPatch}
                  swatches={props.swatches}
                  onPickerOpen={props.onPickerOpen}
                  onAddImage={props.onAddImage}
                />
              )}
            </Show>
          }
        >
          {(info) => (
            <Show
              when={tab() === 'design'}
              fallback={
                props.code ?? (
                  <CodeTab info={info()} onCopy={props.onCopyText} />
                )
              }
            >
              {props.designSections}
              <PositionSection
                info={info()}
                onAlign={props.onAlign}
                onFlip={props.onFlip}
                onPatch={!info().id.startsWith('I') ? props.onPatch : undefined}
              />
              <LayoutSection
                info={info()}
                onPatch={!info().id.startsWith('I') ? props.onPatch : undefined}
                onAddAutoLayout={props.onAddAutoLayout}
              />
              <Section
                title="Appearance"
                actions={
                  <Show when={props.onPatch}>
                    <button
                      type="button"
                      aria-label={info().visible ? 'Hide layer' : 'Show layer'}
                      title={info().visible ? 'Hide layer' : 'Show layer'}
                      data-testid="fig-appearance-visible"
                      class="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-hover hover:text-ink"
                      onClick={() =>
                        props.onPatch?.({ visible: !info().visible }, false)
                      }
                    >
                      <Show
                        when={info().visible}
                        fallback={<EyeSlash class="size-3.5" />}
                      >
                        <Eye class="size-3.5" />
                      </Show>
                    </button>
                  </Show>
                }
              >
                <div class="grid grid-cols-2 gap-1.5">
                  <span class="text-ink-muted text-[11px]">Opacity</span>
                  <span class="text-ink-muted text-[11px]">
                    {info().cornerRadius || hasCorners(info().type)
                      ? 'Corner radius'
                      : ''}
                  </span>
                  <Show
                    when={props.onPatch}
                    fallback={
                      <Field label="Opacity" value={percent(info().opacity)} />
                    }
                  >
                    <NumberField
                      label={<CircleHalf class="size-3.5" />}
                      ariaLabel="Opacity"
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
                  <Show when={info().cornerRadius || hasCorners(info().type)}>
                    <Show
                      when={props.onPatch}
                      fallback={
                        <Field
                          label="Radius"
                          value={
                            info().cornerRadius
                              ? radiusLabel(info().cornerRadius!)
                              : '0'
                          }
                        />
                      }
                    >
                      <NumberField
                        label={<CornersOut class="size-3.5" />}
                        ariaLabel="Corner radius"
                        value={info().cornerRadius?.top_left ?? 0}
                        min={0}
                        mixed={
                          !!info().cornerRadius &&
                          radiusLabel(info().cornerRadius!).includes(',')
                        }
                        testId="fig-field-radius"
                        onChange={(cornerRadius, live) =>
                          props.onPatch?.({ cornerRadius }, live)
                        }
                      />
                    </Show>
                  </Show>
                  <Show
                    when={
                      !['PASS_THROUGH', 'NORMAL'].includes(info().blendMode)
                    }
                  >
                    <div class="col-span-2">
                      <Field label="Blend" value={title(info().blendMode)} />
                    </div>
                  </Show>
                </div>
              </Section>
              <Show when={info().text}>
                {(t) => (
                  <Section
                    title="Typography"
                    actions={props.styleControl?.('TEXT')}
                  >
                    <Show
                      when={props.onPatch}
                      fallback={<TextFields text={t()} />}
                    >
                      <TypeControls
                        text={t()}
                        families={props.fontFamilies ?? ['Inter']}
                        mixed={props.type?.mixed}
                        googleFamilies={props.type?.googleFamilies}
                        weights={props.type?.weights}
                        preview={props.type?.preview}
                        onFontsOpen={props.type?.onFontsOpen}
                        onPatch={(patch, live) => props.onPatch?.(patch, live)}
                      />
                    </Show>
                    <Show when={t().fonts.length > 0}>
                      <span class="text-ink-muted">
                        Also uses {t().fonts.join(', ')}
                      </span>
                    </Show>
                    <details class="mt-1 text-ink-muted">
                      <summary class="py-1">Text content</summary>
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
                    </details>
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
                  actions={props.styleControl?.('FILL')}
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
                    swatches={props.swatches}
                    onPickerOpen={props.onPickerOpen}
                    onAddImage={props.onAddImage}
                    onChange={(fills, live) => props.onPatch?.({ fills }, live)}
                  />
                </Section>
              </Show>
              <Show when={props.onPatch}>
                <Section
                  title="Stroke"
                  testId="fig-strokes"
                  actions={props.styleControl?.('STROKE')}
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
                    swatches={props.swatches}
                    onPickerOpen={props.onPickerOpen}
                    onAddImage={props.onAddImage}
                    onChange={(strokes, live) =>
                      props.onPatch?.({ strokes }, live)
                    }
                  />
                  <Show when={info().strokes.length > 0}>
                    <div class="grid grid-cols-2 gap-1.5">
                      <NumberField
                        label={<List class="size-3.5" />}
                        value={info().strokeWeight ?? 1}
                        min={0}
                        testId="fig-field-stroke-weight"
                        onChange={(strokeWeight, live) =>
                          props.onPatch?.({ strokeWeight }, live)
                        }
                      />
                      <InspectorSelect
                        label="Stroke alignment"
                        value={info().strokeAlign ?? 'CENTER'}
                        options={[
                          { value: 'INSIDE', label: 'Inside' },
                          { value: 'CENTER', label: 'Center' },
                          { value: 'OUTSIDE', label: 'Outside' },
                        ]}
                        onChange={(strokeAlign) =>
                          props.onPatch?.(
                            {
                              strokeAlign: strokeAlign as Patch['strokeAlign'],
                            },
                            false
                          )
                        }
                      />
                      <div class="col-span-2">
                        <ParsedField
                          label="Dash"
                          shown={formatDashes(info().dashPattern) || 'None'}
                          testId="fig-field-dash"
                          parse={(text) =>
                            text.trim().toLowerCase() === 'none'
                              ? []
                              : parseDashes(text)
                          }
                          onChange={(dashPattern) =>
                            props.onPatch?.({ dashPattern }, false)
                          }
                        />
                      </div>
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
                  actions={props.styleControl?.('EFFECT')}
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
                    swatches={props.swatches}
                    onPickerOpen={props.onPickerOpen}
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
              {props.layoutGrids}
              {props.exportSection}
            </Show>
          )}
        </Show>
        <Show
          when={!props.info && props.selectionCount === 0 && tab() === 'design'}
        >
          {props.pageExtra}
        </Show>
      </Tabs.Content>
    </Tabs>
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
