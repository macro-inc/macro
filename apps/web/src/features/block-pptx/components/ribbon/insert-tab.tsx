/**
 * The Insert tab: slides, tables, pictures, shapes, text boxes, links.
 */

import ImageIcon from '@phosphor/image.svg';
import LinkIcon from '@phosphor/link.svg';
import Plus from '@phosphor/plus.svg';
import ShapesIcon from '@phosphor/shapes.svg';
import TableIcon from '@phosphor/table.svg';
import TextT from '@phosphor/text-t.svg';
import { createSignal, For, Index, type JSX } from 'solid-js';
import {
  PopoverItem,
  RibbonGroup,
  RibbonPopover,
  RibbonTextButton,
} from './controls';
import { HeaderFooterButtons } from './deck-setup-controls';
import { useRibbon } from './ribbon';
import { ShapeGallery } from './shape-gallery';

/** PowerPoint's insert-table grid: hover to size, click to insert. */
export function TableGridPicker(props: {
  onPick: (rows: number, cols: number) => void;
}) {
  const ROWS = 8;
  const COLS = 10;
  const [hover, setHover] = createSignal({ rows: 0, cols: 0 });
  return (
    <div class="flex flex-col gap-1.5" data-testid="pptx-table-grid">
      <div class="px-0.5 text-ink-muted text-xs">
        {hover().rows > 0
          ? `${hover().cols} × ${hover().rows} table`
          : 'Insert table'}
      </div>
      <div
        class="grid gap-0.5"
        style={{ 'grid-template-columns': `repeat(${COLS}, 1rem)` }}
        onMouseLeave={() => setHover({ rows: 0, cols: 0 })}
      >
        <Index each={Array.from({ length: ROWS * COLS })}>
          {(_, i) => {
            const row = Math.floor(i / COLS) + 1;
            const col = (i % COLS) + 1;
            const on = () => row <= hover().rows && col <= hover().cols;
            return (
              <button
                type="button"
                aria-label={`${col} by ${row} table`}
                class="size-4 rounded-[3px] border"
                classList={{
                  'border-accent bg-accent/25': on(),
                  'border-edge-muted bg-surface': !on(),
                }}
                onMouseEnter={() => setHover({ rows: row, cols: col })}
                onClick={() => props.onPick(row, col)}
              />
            );
          }}
        </Index>
      </div>
    </div>
  );
}

export function InsertTab(props: {
  chartMenu?: (close: () => void) => JSX.Element;
}) {
  const env = useRibbon();
  const c = env.commands;
  const ro = () => env.readonly();
  let fileInput!: HTMLInputElement;
  return (
    <>
      <RibbonGroup label="Slides">
        <RibbonTextButton
          label="New slide"
          disabled={ro()}
          onClick={() => void c.addSlide()}
        >
          <Plus />
          New slide
        </RibbonTextButton>
        <RibbonPopover
          label="New slide with layout"
          icon={<span class="sr-only">Layouts</span>}
          disabled={ro()}
        >
          {(close) => (
            <div class="flex max-h-[60vh] w-56 flex-col overflow-y-auto">
              <For each={env.deck()?.layouts ?? []}>
                {(layout) => (
                  <PopoverItem
                    label={layout.name}
                    onClick={() => {
                      close();
                      void c.addSlide(layout.name);
                    }}
                  />
                )}
              </For>
            </div>
          )}
        </RibbonPopover>
      </RibbonGroup>
      <RibbonGroup label="Tables">
        <RibbonPopover
          label="Table"
          text="Table"
          icon={<TableIcon class="size-3.5" />}
          disabled={ro()}
          testId="pptx-insert-table"
        >
          {(close) => (
            <TableGridPicker
              onPick={(rows, cols) => {
                close();
                void c.insertTable(rows, cols);
              }}
            />
          )}
        </RibbonPopover>
      </RibbonGroup>
      <RibbonGroup label="Images">
        <RibbonTextButton
          label="Pictures"
          disabled={ro()}
          onClick={() => fileInput.click()}
        >
          <ImageIcon />
          Pictures
        </RibbonTextButton>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif"
          class="hidden"
          data-testid="pptx-image-input"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) void c.insertImage(file, file.name);
          }}
        />
      </RibbonGroup>
      <RibbonGroup label="Illustrations">
        <RibbonPopover
          label="Shapes"
          text="Shapes"
          icon={<ShapesIcon class="size-3.5" />}
          disabled={ro()}
        >
          {(close) => (
            <ShapeGallery
              load={env.presetPaths}
              onPick={(preset) => {
                close();
                void c.insertShape(preset);
              }}
            />
          )}
        </RibbonPopover>
        {props.chartMenu ? (
          <RibbonPopover
            label="Chart"
            text="Chart"
            icon={
              <svg viewBox="0 0 16 16" class="size-3.5">
                <path
                  d="M2 14h12M4 12V7M8 12V3M12 12V9"
                  class="fill-none stroke-current"
                  stroke-width="1.6"
                />
              </svg>
            }
            disabled={ro()}
            testId="pptx-insert-chart"
          >
            {(close) => props.chartMenu!(close)}
          </RibbonPopover>
        ) : null}
      </RibbonGroup>
      <RibbonGroup label="Text">
        <RibbonTextButton
          label="Text box"
          disabled={ro()}
          data-testid="pptx-insert-textbox"
          onClick={() => void c.insertTextBox()}
        >
          <TextT />
          Text box
        </RibbonTextButton>
        <HeaderFooterButtons />
        <RibbonTextButton
          label="Link"
          tooltip="Insert link (⌘K)"
          disabled={ro() || !c.textActive()}
          onClick={() => {
            const url = window.prompt('Link to (URL)', 'https://');
            if (url) void c.setLink(url.trim());
          }}
        >
          <LinkIcon />
          Link
        </RibbonTextButton>
      </RibbonGroup>
    </>
  );
}
