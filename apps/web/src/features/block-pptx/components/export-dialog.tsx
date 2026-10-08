/**
 * Export ▸ slides as pictures: PNG or JPEG, for the current slide, the
 * selected slides, or all of them, at HD, Full HD, or 4K width. One slide
 * downloads as a picture; several download as a zip of `SlideN` pictures.
 */

import type { DeckOutline } from '@core/pptx-engine/types';
import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { zipSync } from 'fflate';
import { createSignal, For, Show } from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';
import {
  baseName,
  EXPORT_WIDTHS,
  type ExportScope,
  exportIndexes,
  type ImageFormat,
  slideFileName,
} from '../core/export-images';
import { slidePicture } from '../primitives/export-pictures';

function Choice(props: {
  name: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  testId?: string;
  onSelect: () => void;
}) {
  return (
    <label
      class="flex items-center gap-2 text-ink text-xs"
      classList={{ 'opacity-50': props.disabled }}
    >
      <input
        type="radio"
        name={props.name}
        checked={props.checked}
        disabled={props.disabled}
        data-testid={props.testId}
        onChange={() => props.onSelect()}
      />
      {props.label}
    </label>
  );
}

export function ExportDialog(props: {
  engine: PresentationEngine;
  deck: DeckOutline;
  current: number;
  /** Selected slides (indexes) in the rail. */
  selected: number[];
  fileName: string;
  download: (bytes: Uint8Array, fileName: string, mimeType?: string) => void;
  notifyError: (message: string) => void;
  onClose: () => void;
}) {
  const [format, setFormat] = createSignal<ImageFormat>('png');
  const [scope, setScope] = createSignal<ExportScope>('current');
  const [width, setWidth] = createSignal(1920);
  const [progress, setProgress] = createSignal<[number, number]>();
  const indexes = () =>
    exportIndexes(
      scope(),
      props.current,
      props.selected,
      props.deck.slides.length
    );

  const run = async () => {
    const list = indexes();
    if (list.length === 0) return;
    const mime = format() === 'png' ? 'image/png' : 'image/jpeg';
    try {
      setProgress([0, list.length]);
      if (list.length === 1) {
        const bytes = await slidePicture(
          props.engine,
          list[0],
          width(),
          format()
        );
        props.download(
          bytes,
          slideFileName(props.fileName, list[0], format(), true),
          mime
        );
      } else {
        const files: Record<string, Uint8Array> = {};
        for (const [n, index] of list.entries()) {
          files[slideFileName(props.fileName, index, format(), false)] =
            await slidePicture(props.engine, index, width(), format());
          setProgress([n + 1, list.length]);
        }
        // Pictures are compressed already; store them.
        const zip = zipSync(files, { level: 0 });
        props.download(
          zip,
          `${baseName(props.fileName)}.zip`,
          'application/zip'
        );
      }
      props.onClose();
    } catch {
      props.notifyError('The slides could not be exported.');
      setProgress(undefined);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      class="w-[min(420px,94vw)]"
    >
      <div class="relative flex flex-col gap-4 p-4" data-testid="pptx-export">
        <h2 class="font-semibold text-ink text-sm">Export as pictures</h2>
        <fieldset class="flex flex-col gap-1.5">
          <legend class="mb-1.5 font-medium text-ink-muted text-xs">
            File type
          </legend>
          <Choice
            name="pptx-export-format"
            label="PNG Portable Network Graphics"
            checked={format() === 'png'}
            testId="pptx-export-png"
            onSelect={() => setFormat('png')}
          />
          <Choice
            name="pptx-export-format"
            label="JPEG File Interchange Format"
            checked={format() === 'jpeg'}
            testId="pptx-export-jpeg"
            onSelect={() => setFormat('jpeg')}
          />
        </fieldset>
        <fieldset class="flex flex-col gap-1.5">
          <legend class="mb-1.5 font-medium text-ink-muted text-xs">
            Slides
          </legend>
          <Choice
            name="pptx-export-scope"
            label="Just this one"
            checked={scope() === 'current'}
            testId="pptx-export-current"
            onSelect={() => setScope('current')}
          />
          <Choice
            name="pptx-export-scope"
            label={`Selected slides (${props.selected.length})`}
            checked={scope() === 'selected'}
            disabled={props.selected.length < 2}
            testId="pptx-export-selected"
            onSelect={() => setScope('selected')}
          />
          <Choice
            name="pptx-export-scope"
            label={`All slides (${props.deck.slides.length})`}
            checked={scope() === 'all'}
            testId="pptx-export-all"
            onSelect={() => setScope('all')}
          />
        </fieldset>
        <label class="flex items-center justify-between gap-2 text-ink-muted text-xs">
          Size
          <select
            class="h-7 rounded-md border border-edge-muted bg-input px-1 text-ink text-xs"
            data-testid="pptx-export-width"
            value={String(width())}
            onChange={(e) => setWidth(Number(e.currentTarget.value))}
          >
            <For each={EXPORT_WIDTHS}>
              {(w) => <option value={String(w.value)}>{w.label}</option>}
            </For>
          </select>
        </label>
        <div class="flex items-center justify-end gap-2">
          <Show when={progress()}>
            {(p) => (
              <span
                class="mr-auto text-ink-muted text-xs"
                data-testid="pptx-export-progress"
              >
                Exporting {p()[0]} of {p()[1]}…
              </span>
            )}
          </Show>
          <Button size="sm" variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="cta"
            data-testid="pptx-export-run"
            disabled={!!progress() || indexes().length === 0}
            onClick={() => void run()}
          >
            Export
          </Button>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          label="Close"
          class="absolute top-3 right-3"
          onClick={props.onClose}
        >
          <X />
        </Button>
      </div>
    </Dialog>
  );
}
