/**
 * The design panel's Export section, as in Figma: the layer's presets
 * (size, suffix, format, and per-format options) with "+" and "−", a
 * preview, and "Export <name>". Presets are the layer's own when
 * `onChange` is given; read-only viewers get presets for this session.
 * Presentational.
 */

import type {
  ExportFormat,
  ExportSetting,
} from '@core/fig-engine/handoff-types';
import CaretDown from '@phosphor/caret-down.svg';
import Copy from '@phosphor/copy.svg';
import DotsThree from '@phosphor/dots-three.svg';
import Minus from '@phosphor/minus.svg';
import { Button } from '@ui/components/Button';
import { createSignal, For, Index, onCleanup, Show } from 'solid-js';
import {
  EXPORT_FORMATS,
  EXPORT_SIZES,
  exportFileName,
  hasSize,
  nextSetting,
  parseSize,
  sizeLabel,
} from '../core/export-settings';
import { isCommitKey } from '../core/shortcuts';
import { Section } from './panel-section';

/** A text field that commits on Enter or blur (empty is a value). */
function DraftInput(props: {
  value: string;
  placeholder?: string;
  class?: string;
  list?: string;
  testId?: string;
  ariaLabel: string;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = createSignal<string>();
  const commit = () => {
    const text = draft();
    setDraft(undefined);
    if (text !== undefined && text !== props.value) props.onCommit(text);
  };
  return (
    <input
      class={`min-w-0 rounded-md bg-inset px-1.5 py-1 text-ink outline-none focus:outline focus:outline-1 focus:outline-accent ${props.class ?? ''}`}
      aria-label={props.ariaLabel}
      placeholder={props.placeholder}
      list={props.list}
      data-testid={props.testId}
      value={draft() ?? props.value}
      onFocus={(e) => setDraft(e.currentTarget.value)}
      onInput={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (isCommitKey(e)) e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(undefined);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function ExportRow(props: {
  index: number;
  setting: ExportSetting;
  onChange: (setting: ExportSetting) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const s = () => props.setting;
  const k = () => props.index;
  return (
    <div class="flex flex-col gap-1" data-testid={`fig-export-row-${k()}`}>
      <div class="flex items-center gap-1">
        <Show
          when={hasSize(s().format)}
          fallback={
            <span class="min-w-0 rounded-md bg-inset px-1.5 py-1 text-ink outline-none focus:outline focus:outline-1 focus:outline-accent w-16 text-ink-muted">
              1x
            </span>
          }
        >
          <DraftInput
            class="w-16 tabular-nums"
            ariaLabel="Size"
            list="fig-export-sizes"
            testId={`fig-export-size-${k()}`}
            value={sizeLabel(s())}
            onCommit={(text) => {
              const size = parseSize(text);
              if (size) props.onChange({ ...s(), ...size });
            }}
          />
        </Show>
        <DraftInput
          class="w-0 flex-1"
          ariaLabel="Suffix"
          placeholder="Suffix"
          testId={`fig-export-suffix-${k()}`}
          value={s().suffix}
          onCommit={(suffix) => props.onChange({ ...s(), suffix })}
        />
        <select
          class="min-w-0 rounded-md bg-inset px-1.5 py-1 text-ink outline-none focus:outline focus:outline-1 focus:outline-accent w-16"
          aria-label="Format"
          data-testid={`fig-export-format-${k()}`}
          value={s().format}
          onChange={(e) => {
            const format = e.currentTarget.value as ExportFormat;
            // Vectors export at their own size.
            props.onChange(
              hasSize(format)
                ? { ...s(), format }
                : { ...s(), format, constraint: 'CONTENT_SCALE', value: 1 }
            );
          }}
        >
          <For each={EXPORT_FORMATS}>
            {(f) => <option value={f.format}>{f.label}</option>}
          </For>
        </select>
        <Show when={s().format === 'SVG' || s().format === 'JPEG'}>
          <button
            type="button"
            aria-label="Export settings"
            aria-expanded={open()}
            class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink aria-expanded:bg-hover"
            data-testid={`fig-export-options-${k()}`}
            onClick={() => setOpen((o) => !o)}
          >
            <DotsThree class="size-3.5" />
          </button>
        </Show>
        <button
          type="button"
          aria-label="Remove export setting"
          class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
          data-testid={`fig-export-remove-${k()}`}
          onClick={props.onRemove}
        >
          <Minus class="size-3.5" />
        </button>
      </div>
      <Show when={open() && s().format === 'SVG'}>
        <div class="flex flex-col gap-1 rounded-md bg-inset px-2 py-1.5 text-ink-muted">
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={s().svgOutlineText}
              data-testid={`fig-export-outline-text-${k()}`}
              onChange={(e) =>
                props.onChange({
                  ...s(),
                  svgOutlineText: e.currentTarget.checked,
                })
              }
            />
            Outline text
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={s().svgIncludeId}
              data-testid={`fig-export-include-id-${k()}`}
              onChange={(e) =>
                props.onChange({
                  ...s(),
                  svgIncludeId: e.currentTarget.checked,
                })
              }
            />
            Include "id" attribute
          </label>
        </div>
      </Show>
      <Show when={open() && s().format === 'JPEG'}>
        <label class="flex items-center gap-2 rounded-md bg-inset px-2 py-1.5 text-ink-muted">
          Quality
          <input
            type="range"
            min={1}
            max={100}
            class="min-w-0 flex-1"
            value={s().quality}
            data-testid={`fig-export-quality-${k()}`}
            onChange={(e) =>
              props.onChange({
                ...s(),
                quality: Number(e.currentTarget.value),
              })
            }
          />
          <span class="w-8 text-right tabular-nums">{s().quality}%</span>
        </label>
      </Show>
    </div>
  );
}

export function ExportSection(props: {
  /** The layer's (or layers') name. */
  name: string;
  /** How many layers export. */
  count: number;
  settings: readonly ExportSetting[];
  /** Stores presets on the layer; absent when read-only. */
  onChange?: (settings: ExportSetting[]) => void;
  /** Exports with these presets. */
  onExport: (settings: ExportSetting[]) => void;
  /** A PNG of the layer for the preview (an object URL). */
  preview?: () => Promise<string | undefined>;
  onCopyPng: () => void;
  onCopySvg: () => void;
}) {
  const [session, setSession] = createSignal<ExportSetting[]>();
  const settings = () =>
    props.onChange ? [...props.settings] : (session() ?? [...props.settings]);
  const update = (next: ExportSetting[]) => {
    if (props.onChange) props.onChange(next);
    else setSession(next);
  };
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const [previewUrl, setPreviewUrl] = createSignal<string>();
  const revoke = () => {
    const url = previewUrl();
    if (url) URL.revokeObjectURL(url);
  };
  onCleanup(revoke);
  const togglePreview = async () => {
    const open = !previewOpen();
    setPreviewOpen(open);
    if (!open || !props.preview) return;
    const url = await props.preview();
    revoke();
    setPreviewUrl(url);
  };
  const label = () =>
    props.count > 1 ? `${props.count} layers` : props.name || 'layer';
  return (
    <Section
      title="Export"
      testId="fig-export"
      onAdd={() => update([...settings(), nextSetting(settings())])}
    >
      <datalist id="fig-export-sizes">
        <For each={EXPORT_SIZES}>{(s) => <option value={s} />}</For>
      </datalist>
      <Index each={settings()}>
        {(s, k) => (
          <ExportRow
            index={k}
            setting={s()}
            onChange={(next) =>
              update(settings().map((old, i) => (i === k ? next : old)))
            }
            onRemove={() => update(settings().filter((_, i) => i !== k))}
          />
        )}
      </Index>
      <Show when={settings().length > 0}>
        <Button
          variant="outline"
          size="sm"
          class="w-full truncate"
          data-testid="fig-export-button"
          title={
            props.count === 1
              ? settings()
                  .map((s) => exportFileName(props.name, s))
                  .join(', ')
              : undefined
          }
          onClick={() => props.onExport(settings())}
        >
          Export {label()}
        </Button>
        <Show when={props.preview && props.count === 1}>
          <button
            type="button"
            class="flex items-center gap-1 self-start text-ink-muted hover:text-ink"
            aria-expanded={previewOpen()}
            data-testid="fig-export-preview-toggle"
            onClick={() => void togglePreview()}
          >
            <CaretDown
              class="size-3 transition-transform"
              classList={{ '-rotate-90': !previewOpen() }}
            />
            Preview
          </button>
          <Show when={previewOpen() && previewUrl()}>
            {(url) => (
              <div class="flex max-h-48 items-center justify-center rounded-md bg-inset p-2">
                <img
                  src={url()}
                  alt={`Preview of ${props.name}`}
                  class="max-h-44 max-w-full object-contain"
                  data-testid="fig-export-preview"
                />
              </div>
            )}
          </Show>
        </Show>
      </Show>
      <div class="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" onClick={props.onCopyPng}>
          <Copy />
          Copy as PNG
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
  );
}
