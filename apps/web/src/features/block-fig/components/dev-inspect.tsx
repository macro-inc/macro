/**
 * The Code tab as Figma's Dev Mode inspect panel: the selected layer's
 * size and position, auto layout spacing, typography, colors with the
 * styles and variables they come from, effects, code in CSS, Tailwind,
 * SwiftUI, or Jetpack Compose, and the layer's exportable assets.
 * Presentational.
 */

import type { DesignInfo } from '@core/fig-engine/design-types';
import type { Exportable, ExportSetting } from '@core/fig-engine/handoff-types';
import type { NodeInfo, PaintInfo } from '@core/fig-engine/types';
import Copy from '@phosphor/copy.svg';
import DownloadSimple from '@phosphor/download-simple.svg';
import { createSignal, For, type JSX, Show } from 'solid-js';
import {
  CODE_LANGUAGES,
  type CodeLanguage,
  codeFor,
} from '../core/code-snippets';
import { cssColor } from '../core/css';
import { exportFileName } from '../core/export-settings';
import { formatMeasure } from '../core/measure';
import { formatLetterSpacing, formatLineHeight } from '../core/type';
import { Section } from './panel-section';

function CopyButton(props: {
  text: string;
  label: string;
  testId?: string;
  onCopy: (text: string) => void;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
      data-testid={props.testId}
      onClick={() => props.onCopy(props.text)}
    >
      <Copy class="size-3" />
    </button>
  );
}

/** A label and a value that copies on click. */
function Row(props: {
  label: string;
  value: string;
  testId?: string;
  onCopy: (text: string) => void;
}) {
  return (
    <div class="flex items-center gap-2">
      <span class="w-24 shrink-0 text-ink-muted">{props.label}</span>
      <button
        type="button"
        class="min-w-0 truncate rounded px-1 text-left font-mono text-ink hover:bg-hover"
        title={`Copy ${props.value}`}
        data-testid={props.testId}
        onClick={() => props.onCopy(props.value)}
      >
        {props.value}
      </button>
    </div>
  );
}

const fmt = (v: number) => formatMeasure(v);

/** `8px`, or each corner's radius when they differ. */
const radiusValue = (corners: number[]) =>
  corners.every((v) => v === corners[0])
    ? `${fmt(corners[0])}px`
    : corners.map((v) => `${fmt(v)}px`).join(' ');
const title = (s: string) =>
  s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

function ColorRow(props: {
  paint: PaintInfo;
  /** A style or variable the color comes from. */
  source?: string;
  onCopy: (text: string) => void;
}) {
  const value = () => {
    const p = props.paint;
    if (p.type === 'SOLID' && p.color)
      return cssColor(p.color, (p.alpha ?? 1) * p.opacity);
    return title(p.type);
  };
  const swatch = () =>
    props.paint.color ? `#${props.paint.color}` : 'var(--color-inset)';
  return (
    <div class="flex items-center gap-2" data-testid="fig-dev-color">
      <span
        class="size-4 shrink-0 rounded-sm border border-edge-muted"
        style={{ background: swatch() }}
      />
      <button
        type="button"
        class="min-w-0 truncate rounded px-1 text-left font-mono text-ink hover:bg-hover"
        onClick={() => props.onCopy(value())}
      >
        {value()}
      </button>
      <Show when={props.source}>
        {(s) => (
          <span
            class="ml-auto truncate text-ink-muted"
            data-testid="fig-dev-color-source"
          >
            {s()}
          </span>
        )}
      </Show>
    </div>
  );
}

/** The padding box of an auto layout frame, as Dev Mode draws it. */
function PaddingBox(props: {
  top: number;
  right: number;
  bottom: number;
  left: number;
  gap: number;
}) {
  const cell = (v: number): JSX.Element => (
    <span class="tabular-nums">{fmt(v)}</span>
  );
  return (
    <div
      class="grid grid-cols-3 grid-rows-3 place-items-center rounded-md border border-accent/50 border-dashed bg-accent/5 p-1 text-ink"
      data-testid="fig-dev-padding"
    >
      <span />
      {cell(props.top)}
      <span />
      {cell(props.left)}
      <span class="rounded bg-inset px-1.5 py-0.5 text-ink-muted">
        gap {fmt(props.gap)}
      </span>
      {cell(props.right)}
      <span />
      {cell(props.bottom)}
      <span />
    </div>
  );
}

export function DevInspect(props: {
  info: NodeInfo;
  design?: DesignInfo;
  /** The layer and layers inside it with export presets. */
  assets?: readonly Exportable[];
  onCopy: (text: string) => void;
  onDownload?: (id: string, setting: ExportSetting) => void;
}) {
  const [language, setLanguage] = createSignal<CodeLanguage>('css');
  const info = () => props.info;
  const code = () => codeFor(info(), language());
  const fills = () => info().fills.filter((p) => p.visible);
  const strokes = () => info().strokes.filter((p) => p.visible);
  const fillSource = (k: number) =>
    props.design?.variables.fills[k]?.name ?? props.design?.styles.fill?.name;
  const strokeSource = (k: number) =>
    props.design?.variables.strokes[k]?.name ??
    props.design?.styles.stroke?.name;
  return (
    <div data-testid="fig-dev-inspect">
      <Section title="Inspect">
        <Row
          label="Width"
          value={`${fmt(info().width)}px`}
          testId="fig-dev-width"
          onCopy={props.onCopy}
        />
        <Row
          label="Height"
          value={`${fmt(info().height)}px`}
          testId="fig-dev-height"
          onCopy={props.onCopy}
        />
        <Row label="Left" value={`${fmt(info().x)}px`} onCopy={props.onCopy} />
        <Row label="Top" value={`${fmt(info().y)}px`} onCopy={props.onCopy} />
        <Show when={Math.abs(info().rotation) > 0.01}>
          <Row
            label="Rotation"
            value={`${fmt(info().rotation)}°`}
            onCopy={props.onCopy}
          />
        </Show>
        <Show when={info().cornerRadius}>
          {(r) => (
            <Row
              label="Radius"
              value={radiusValue([
                r().top_left,
                r().top_right,
                r().bottom_right,
                r().bottom_left,
              ])}
              onCopy={props.onCopy}
            />
          )}
        </Show>
        <Show when={info().opacity < 0.999}>
          <Row
            label="Opacity"
            value={`${Math.round(info().opacity * 100)}%`}
            onCopy={props.onCopy}
          />
        </Show>
      </Section>
      <Show when={info().autoLayout}>
        {(al) => (
          <Section title="Auto layout">
            <Row
              label="Direction"
              value={title(al().mode)}
              onCopy={props.onCopy}
            />
            <PaddingBox
              top={al().paddingTop}
              right={al().paddingRight}
              bottom={al().paddingBottom}
              left={al().paddingLeft}
              gap={al().spacing}
            />
          </Section>
        )}
      </Show>
      <Show when={info().text}>
        {(t) => (
          <Section title="Typography">
            <Show when={props.design?.styles.text}>
              {(s) => (
                <Row
                  label="Style"
                  value={s().name}
                  testId="fig-dev-text-style"
                  onCopy={props.onCopy}
                />
              )}
            </Show>
            <Show when={t().fontFamily}>
              {(f) => (
                <Row
                  label="Font"
                  value={f()}
                  testId="fig-dev-font"
                  onCopy={props.onCopy}
                />
              )}
            </Show>
            <Show when={t().fontStyle}>
              {(s) => <Row label="Weight" value={s()} onCopy={props.onCopy} />}
            </Show>
            <Show when={t().fontSize}>
              {(s) => (
                <Row
                  label="Size"
                  value={`${fmt(s())}px`}
                  onCopy={props.onCopy}
                />
              )}
            </Show>
            <Row
              label="Line height"
              value={formatLineHeight(t().lineHeight)}
              onCopy={props.onCopy}
            />
            <Row
              label="Letter spacing"
              value={formatLetterSpacing(t().letterSpacing)}
              onCopy={props.onCopy}
            />
            <Show when={t().alignHorizontal}>
              {(a) => (
                <Row label="Align" value={title(a())} onCopy={props.onCopy} />
              )}
            </Show>
          </Section>
        )}
      </Show>
      <Show when={fills().length > 0 || strokes().length > 0}>
        <Section title="Colors" testId="fig-dev-colors">
          <For each={info().fills}>
            {(p, k) => (
              <Show when={p.visible}>
                <ColorRow
                  paint={p}
                  source={fillSource(k())}
                  onCopy={props.onCopy}
                />
              </Show>
            )}
          </For>
          <For each={info().strokes}>
            {(p, k) => (
              <Show when={p.visible}>
                <ColorRow
                  paint={p}
                  source={strokeSource(k()) && `${strokeSource(k())} (stroke)`}
                  onCopy={props.onCopy}
                />
              </Show>
            )}
          </For>
        </Section>
      </Show>
      <Show when={info().effects.some((e) => e.visible)}>
        <Section title="Effects">
          <Show when={props.design?.styles.effect}>
            {(s) => (
              <Row label="Style" value={s().name} onCopy={props.onCopy} />
            )}
          </Show>
          <For each={info().effects.filter((e) => e.visible)}>
            {(e) => (
              <Row
                label={title(e.type)}
                value={
                  e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'
                    ? `${fmt(e.x)} ${fmt(e.y)} ${fmt(e.radius)} ${fmt(e.spread)} ${cssColor(e.color, e.alpha)}`
                    : `blur ${fmt(e.radius)}`
                }
                onCopy={props.onCopy}
              />
            )}
          </For>
        </Section>
      </Show>
      <Section
        title="Code"
        testId="fig-dev-code"
        actions={
          <CopyButton
            text={code()}
            label="Copy code"
            testId="fig-code-copy"
            onCopy={props.onCopy}
          />
        }
      >
        <div class="flex gap-0.5 rounded-md bg-inset p-0.5">
          <For each={CODE_LANGUAGES}>
            {(l) => (
              <button
                type="button"
                class="flex-1 rounded px-1 py-0.5 text-ink-muted aria-pressed:bg-hover aria-pressed:text-ink"
                aria-pressed={language() === l.id}
                data-testid={`fig-code-lang-${l.id}`}
                onClick={() => setLanguage(l.id)}
              >
                {l.label}
              </button>
            )}
          </For>
        </div>
        <pre
          class="select-text overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-inset p-2 font-mono text-ink"
          data-testid={
            language() === 'css' ? 'fig-css' : `fig-code-${language()}`
          }
        >
          {code()}
        </pre>
      </Section>
      <Show when={(props.assets?.length ?? 0) > 0 && props.onDownload}>
        <Section title="Assets" testId="fig-dev-assets">
          <For each={props.assets}>
            {(a) => (
              <For each={a.settings}>
                {(s) => (
                  <button
                    type="button"
                    class="flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-ink hover:bg-hover"
                    data-testid="fig-dev-asset"
                    onClick={() => props.onDownload?.(a.id, s)}
                  >
                    <DownloadSimple class="size-3.5 shrink-0 text-ink-muted" />
                    <span class="truncate">{exportFileName(a.name, s)}</span>
                  </button>
                )}
              </For>
            )}
          </For>
        </Section>
      </Show>
    </div>
  );
}
