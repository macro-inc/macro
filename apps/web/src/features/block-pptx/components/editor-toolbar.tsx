/**
 * The editing toolbar: history, insertion, text and shape formatting, and
 * saving. Presentational: every action is a callback.
 */

import ArrowClockwise from '@phosphor/arrow-clockwise.svg';
import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import CaretDown from '@phosphor/caret-down.svg';
import CircleIcon from '@phosphor/circle.svg';
import CloudCheck from '@phosphor/cloud-check.svg';
import DownloadSimple from '@phosphor/download-simple.svg';
import ImageIcon from '@phosphor/image.svg';
import ListBullets from '@phosphor/list-bullets.svg';
import Minus from '@phosphor/minus.svg';
import PaintBucket from '@phosphor/paint-bucket.svg';
import Plus from '@phosphor/plus.svg';
import ShapesIcon from '@phosphor/shapes.svg';
import SquareIcon from '@phosphor/square.svg';
import StarIcon from '@phosphor/star.svg';
import TableIcon from '@phosphor/table.svg';
import TextAa from '@phosphor/text-aa.svg';
import AlignCenter from '@phosphor/text-align-center.svg';
import AlignLeft from '@phosphor/text-align-left.svg';
import AlignRight from '@phosphor/text-align-right.svg';
import TextB from '@phosphor/text-b.svg';
import TextItalic from '@phosphor/text-italic.svg';
import TextT from '@phosphor/text-t.svg';
import TextUnderline from '@phosphor/text-underline.svg';
import TriangleIcon from '@phosphor/triangle.svg';
import WarningIcon from '@phosphor/warning.svg';
import { Button, type ButtonProps } from '@ui/components/Button';
import { createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import type { TextFormatState } from '../core/formatting';
import type { Swatch } from '../core/palette';
import type { SaveState } from '../primitives/create-presentation-session';

function ToolButton(props: ButtonProps) {
  return (
    <Button variant="ghost" size="icon-sm" class="size-7 p-1" {...props} />
  );
}

function Divider() {
  return (
    <div aria-hidden="true" class="mx-1 h-5 w-px shrink-0 bg-edge-muted" />
  );
}

/** A button that opens a small panel below it. */
function Popover(props: {
  label: string;
  icon: JSX.Element;
  disabled?: boolean;
  testId?: string;
  children: (close: () => void) => JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;
  const onDocumentDown = (e: PointerEvent) => {
    if (!root.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener('pointerdown', onDocumentDown);
  onCleanup(() => document.removeEventListener('pointerdown', onDocumentDown));
  return (
    <div ref={root} class="relative">
      <Button
        variant="ghost"
        size="sm"
        class="h-7 gap-0.5 px-1.5"
        label={props.label}
        tooltip={props.label}
        disabled={props.disabled}
        data-testid={props.testId}
        aria-expanded={open()}
        onClick={() => setOpen((o) => !o)}
      >
        {props.icon}
        <CaretDown class="size-3" />
      </Button>
      <Show when={open()}>
        <div class="absolute top-full left-0 z-50 mt-1 rounded-lg border border-edge-muted bg-surface p-1.5 shadow-lg">
          {props.children(() => setOpen(false))}
        </div>
      </Show>
    </div>
  );
}

function SwatchGrid(props: {
  swatches: Swatch[];
  onPick: (value: string) => void;
}) {
  return (
    <div class="grid grid-cols-6 gap-1">
      <For each={props.swatches}>
        {(swatch) => (
          <button
            type="button"
            title={swatch.label}
            aria-label={swatch.label}
            class="size-5 rounded-sm border border-edge-muted"
            style={{ background: swatch.css }}
            onClick={() => props.onPick(swatch.value)}
          />
        )}
      </For>
    </div>
  );
}

const INSERTABLE_SHAPES = [
  { preset: 'rect', label: 'Rectangle', icon: SquareIcon },
  { preset: 'roundRect', label: 'Rounded rectangle', icon: SquareIcon },
  { preset: 'ellipse', label: 'Oval', icon: CircleIcon },
  { preset: 'triangle', label: 'Triangle', icon: TriangleIcon },
  { preset: 'rightArrow', label: 'Arrow', icon: ArrowRightIcon },
  { preset: 'star5', label: 'Star', icon: StarIcon },
] as const;

export interface EditorToolbarProps {
  readonly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onInsertTextBox: () => void;
  onInsertShape: (preset: string) => void;
  onInsertImage: (file: File) => void;
  onInsertTable: () => void;
  /** Text formatting applies (a text shape is selected or being edited). */
  textActive: boolean;
  format: TextFormatState;
  onToggle: (key: 'bold' | 'italic' | 'underline') => void;
  onFontSize: (direction: 1 | -1) => void;
  onTextColor: (value: string) => void;
  onAlign: (align: 'left' | 'center' | 'right') => void;
  onToggleBullets: () => void;
  /** Shape formatting applies (a shape is selected). */
  shapeActive: boolean;
  onFill: (value: string | null) => void;
  swatches: Swatch[];
  saveState: SaveState;
  onSave: () => void;
  onDownload: () => void;
  /** Keep keyboard focus in the text being edited while clicking. */
  keepFocus: boolean;
}

export function EditorToolbar(props: EditorToolbarProps) {
  let fileInput!: HTMLInputElement;
  // Clicks must not move focus out of the text being edited.
  const holdFocus = (e: Event) => {
    if (props.keepFocus && !(e.target instanceof HTMLInputElement))
      e.preventDefault();
  };
  const saveLabel = () =>
    ({
      saved: 'Saved',
      dirty: 'Unsaved changes',
      saving: 'Saving…',
      error: 'Save failed',
    })[props.saveState];
  return (
    <div
      role="toolbar"
      aria-label="Presentation"
      data-testid="pptx-toolbar"
      class="flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-edge-muted border-b bg-panel px-2"
      onPointerDown={holdFocus}
      onMouseDown={holdFocus}
    >
      <Show when={!props.readonly}>
        <ToolButton
          label="Undo"
          tooltip="Undo (⌘Z)"
          disabled={!props.canUndo}
          onClick={props.onUndo}
        >
          <ArrowCounterClockwise />
        </ToolButton>
        <ToolButton
          label="Redo"
          tooltip="Redo (⇧⌘Z)"
          disabled={!props.canRedo}
          onClick={props.onRedo}
        >
          <ArrowClockwise />
        </ToolButton>
        <Divider />
        <ToolButton
          label="Text box"
          tooltip="Insert text box"
          data-testid="pptx-insert-textbox"
          onClick={props.onInsertTextBox}
        >
          <TextT />
        </ToolButton>
        <Popover
          label="Insert shape"
          icon={<ShapesIcon class="size-3.5" />}
          testId="pptx-insert-shape"
        >
          {(close) => (
            <div class="flex gap-0.5">
              <For each={INSERTABLE_SHAPES}>
                {(shape) => (
                  <ToolButton
                    label={shape.label}
                    tooltip={shape.label}
                    data-testid={`pptx-shape-${shape.preset}`}
                    onClick={() => {
                      close();
                      props.onInsertShape(shape.preset);
                    }}
                  >
                    <shape.icon />
                  </ToolButton>
                )}
              </For>
            </div>
          )}
        </Popover>
        <ToolButton
          label="Picture"
          tooltip="Insert picture"
          onClick={() => fileInput.click()}
        >
          <ImageIcon />
        </ToolButton>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif"
          class="hidden"
          data-testid="pptx-image-input"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) props.onInsertImage(file);
          }}
        />
        <ToolButton
          label="Table"
          tooltip="Insert table"
          data-testid="pptx-insert-table"
          onClick={props.onInsertTable}
        >
          <TableIcon />
        </ToolButton>
        <Divider />
        <ToolButton
          label="Bold"
          tooltip="Bold (⌘B)"
          disabled={!props.textActive}
          aria-pressed={props.format.bold}
          variant={props.format.bold ? 'accent' : 'ghost'}
          data-testid="pptx-bold"
          onClick={() => props.onToggle('bold')}
        >
          <TextB />
        </ToolButton>
        <ToolButton
          label="Italic"
          tooltip="Italic (⌘I)"
          disabled={!props.textActive}
          aria-pressed={props.format.italic}
          variant={props.format.italic ? 'accent' : 'ghost'}
          onClick={() => props.onToggle('italic')}
        >
          <TextItalic />
        </ToolButton>
        <ToolButton
          label="Underline"
          tooltip="Underline (⌘U)"
          disabled={!props.textActive}
          aria-pressed={props.format.underline}
          variant={props.format.underline ? 'accent' : 'ghost'}
          onClick={() => props.onToggle('underline')}
        >
          <TextUnderline />
        </ToolButton>
        <ToolButton
          label="Smaller text"
          tooltip="Decrease font size"
          disabled={!props.textActive}
          onClick={() => props.onFontSize(-1)}
        >
          <Minus />
        </ToolButton>
        <span
          class="w-9 text-center text-ink-muted text-xs tabular-nums"
          data-testid="pptx-font-size"
        >
          {props.textActive && props.format.size
            ? Math.round(props.format.size * 10) / 10
            : '–'}
        </span>
        <ToolButton
          label="Larger text"
          tooltip="Increase font size"
          disabled={!props.textActive}
          onClick={() => props.onFontSize(1)}
        >
          <Plus />
        </ToolButton>
        <Popover
          label="Text color"
          testId="pptx-text-color"
          disabled={!props.textActive}
          icon={
            <span class="flex flex-col items-center">
              <TextAa class="size-3.5" />
              <span
                class="h-0.5 w-3.5 rounded"
                style={{ background: props.format.color ?? 'currentColor' }}
              />
            </span>
          }
        >
          {(close) => (
            <SwatchGrid
              swatches={props.swatches}
              onPick={(v) => {
                close();
                props.onTextColor(v);
              }}
            />
          )}
        </Popover>
        <ToolButton
          label="Align left"
          tooltip="Align left"
          disabled={!props.textActive}
          variant={
            props.textActive && props.format.align === 'left'
              ? 'accent'
              : 'ghost'
          }
          onClick={() => props.onAlign('left')}
        >
          <AlignLeft />
        </ToolButton>
        <ToolButton
          label="Center"
          tooltip="Center"
          disabled={!props.textActive}
          variant={
            props.textActive && props.format.align === 'center'
              ? 'accent'
              : 'ghost'
          }
          onClick={() => props.onAlign('center')}
        >
          <AlignCenter />
        </ToolButton>
        <ToolButton
          label="Align right"
          tooltip="Align right"
          disabled={!props.textActive}
          variant={
            props.textActive && props.format.align === 'right'
              ? 'accent'
              : 'ghost'
          }
          onClick={() => props.onAlign('right')}
        >
          <AlignRight />
        </ToolButton>
        <ToolButton
          label="Bullets"
          tooltip="Bullets"
          disabled={!props.textActive}
          aria-pressed={props.format.bullet}
          variant={props.textActive && props.format.bullet ? 'accent' : 'ghost'}
          onClick={props.onToggleBullets}
        >
          <ListBullets />
        </ToolButton>
        <Divider />
        <Popover
          label="Shape fill"
          icon={<PaintBucket class="size-3.5" />}
          disabled={!props.shapeActive}
          testId="pptx-fill"
        >
          {(close) => (
            <div class="flex flex-col gap-1.5">
              <SwatchGrid
                swatches={props.swatches}
                onPick={(v) => {
                  close();
                  props.onFill(v);
                }}
              />
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  close();
                  props.onFill(null);
                }}
              >
                No fill
              </Button>
            </div>
          )}
        </Popover>
      </Show>
      <div class="ml-auto flex shrink-0 items-center gap-1 pl-2">
        <Show when={!props.readonly}>
          <span
            class="flex items-center gap-1 text-ink-muted text-xs"
            classList={{ 'text-failure': props.saveState === 'error' }}
            data-testid="pptx-save-state"
          >
            <Show
              when={props.saveState === 'error'}
              fallback={<CloudCheck class="size-3.5" />}
            >
              <WarningIcon class="size-3.5" />
            </Show>
            {saveLabel()}
          </span>
          <Button
            size="sm"
            variant="outline"
            class="h-7"
            disabled={
              props.saveState === 'saved' || props.saveState === 'saving'
            }
            onClick={props.onSave}
          >
            Save
          </Button>
        </Show>
        <ToolButton
          label="Download"
          tooltip="Download .pptx"
          data-testid="pptx-download"
          onClick={props.onDownload}
        >
          <DownloadSimple />
        </ToolButton>
      </div>
    </div>
  );
}
