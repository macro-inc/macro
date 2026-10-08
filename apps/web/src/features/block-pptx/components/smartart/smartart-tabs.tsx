/**
 * The SmartArt Design contextual tab, shown while a SmartArt graphic is
 * selected: Create Graphic (Add Shape, Text Pane, Promote, Demote, Move Up
 * and Down), the Layouts, Change Colors, and SmartArt Styles galleries, and
 * Reset (Reset Graphic, Convert).
 */

import type {
  SmartArtCatalogItem,
  SmartArtPosition,
} from '@core/pptx-engine/types';
import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import ArrowDown from '@phosphor/arrow-down.svg';
import ArrowUp from '@phosphor/arrow-up.svg';
import Palette from '@phosphor/palette.svg';
import PlusSquare from '@phosphor/plus-square.svg';
import Shapes from '@phosphor/shapes.svg';
import SidebarSimple from '@phosphor/sidebar-simple.svg';
import Swap from '@phosphor/swap.svg';
import TextIndent from '@phosphor/text-indent.svg';
import TextOutdent from '@phosphor/text-outdent.svg';
import TreeStructure from '@phosphor/tree-structure.svg';
import { For, type JSX, Show } from 'solid-js';
import {
  canDemote,
  canPromote,
  colorGroups,
  paneLines,
  shortId,
} from '../../core/smartart';
import type { SmartArtState } from '../../primitives/create-smart-art';
import {
  PopoverItem,
  PopoverLabel,
  RibbonButton,
  RibbonGroup,
  RibbonPopover,
  RibbonTextButton,
} from '../ribbon/controls';
import { SmartArtPreview } from './smartart-preview';

/** A gallery tile: a preview with its name as the tooltip. */
function Tile(props: {
  label: string;
  active: boolean;
  testId: string;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.active}
      title={props.label}
      data-testid={props.testId}
      class="flex items-center justify-center rounded-md border bg-[white] p-1 hover:border-accent"
      classList={{
        'border-accent ring-1 ring-accent': props.active,
        'border-edge-muted': !props.active,
      }}
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  );
}

const ADD: { position: SmartArtPosition; label: string }[] = [
  { position: 'after', label: 'Add Shape After' },
  { position: 'before', label: 'Add Shape Before' },
  { position: 'above', label: 'Add Shape Above' },
  { position: 'below', label: 'Add Shape Below' },
  { position: 'assistant', label: 'Add Assistant' },
];

/** Add Shape's menu (also the stage menu's Add Shape submenu). */
export function AddShapeItems(props: {
  smartArt: SmartArtState;
  close: () => void;
}) {
  const s = () => props.smartArt;
  const org = () => shortId(s().outline()?.layout.id ?? '') === 'orgChart1';
  return (
    <For
      each={ADD.filter(
        (a) =>
          (a.position !== 'assistant' || org()) &&
          (a.position === 'after' || !!s().activeNode())
      )}
    >
      {(a) => (
        <PopoverItem
          label={a.label}
          testId={`pptx-smartart-add-${a.position}`}
          onClick={() => {
            props.close();
            void s().addNode(a.position);
          }}
        />
      )}
    </For>
  );
}

export function SmartArtDesignTab(props: { smartArt: SmartArtState }) {
  const s = () => props.smartArt;
  const outline = () => s().outline();
  const supported = () => !!outline()?.layout.supported;
  const lines = () => {
    const o = outline();
    return o ? paneLines(o) : [];
  };
  const index = () => lines().findIndex((l) => l.id === s().activeNode());
  const layoutShort = () => shortId(outline()?.layout.id ?? '');
  const colorsShort = () => shortId(outline()?.colors ?? '');
  const styleShort = () => shortId(outline()?.style ?? '');
  const catalog = () => s().catalog();
  const colorTile = (item: SmartArtCatalogItem, close: () => void) => (
    <Tile
      label={item.name}
      active={colorsShort() === item.short}
      testId={`pptx-smartart-colors-${item.short}`}
      onClick={() => {
        close();
        void s().setColors(item.short);
      }}
    >
      <SmartArtPreview
        paths={s().preview({
          layout: 'process1',
          colors: item.short,
          style: styleShort(),
          width: 60,
          height: 28,
        })}
        width={60}
        height={28}
        class="h-7 w-[60px]"
      />
    </Tile>
  );
  return (
    <>
      <RibbonGroup label="Create Graphic">
        <RibbonPopover
          label="Add Shape"
          text="Add Shape"
          icon={<PlusSquare class="size-3.5" />}
          disabled={!supported()}
          testId="pptx-smartart-add-shape"
        >
          {(close) => (
            <div class="flex w-44 flex-col">
              <AddShapeItems smartArt={s()} close={close} />
            </div>
          )}
        </RibbonPopover>
        <RibbonTextButton
          label="Text Pane"
          tooltip="Show or hide the Text Pane"
          aria-pressed={s().pane.open()}
          class={s().pane.open() ? 'bg-accent-bg text-accent' : undefined}
          data-testid="pptx-smartart-text-pane"
          onClick={() => s().pane.toggle()}
        >
          <SidebarSimple />
          Text Pane
        </RibbonTextButton>
        <RibbonButton
          label="Promote"
          tooltip="Promote"
          data-testid="pptx-smartart-promote"
          disabled={!supported() || !canPromote(lines(), index())}
          onClick={() => void s().promote()}
        >
          <TextOutdent />
        </RibbonButton>
        <RibbonButton
          label="Demote"
          tooltip="Demote"
          data-testid="pptx-smartart-demote"
          disabled={!supported() || !canDemote(lines(), index())}
          onClick={() => void s().demote()}
        >
          <TextIndent />
        </RibbonButton>
        <RibbonButton
          label="Move Up"
          tooltip="Move Up"
          data-testid="pptx-smartart-move-up"
          disabled={!supported() || index() < 0}
          onClick={() => void s().moveUp()}
        >
          <ArrowUp />
        </RibbonButton>
        <RibbonButton
          label="Move Down"
          tooltip="Move Down"
          data-testid="pptx-smartart-move-down"
          disabled={!supported() || index() < 0}
          onClick={() => void s().moveDown()}
        >
          <ArrowDown />
        </RibbonButton>
      </RibbonGroup>
      <RibbonGroup label="Layouts">
        <RibbonPopover
          label="Layouts"
          text={outline()?.layout.name ?? 'Layouts'}
          icon={<TreeStructure class="size-3.5" />}
          testId="pptx-smartart-layouts"
        >
          {(close) => (
            <div class="grid w-[300px] grid-cols-3 gap-1.5">
              <For each={catalog()?.layouts ?? []}>
                {(layout) => (
                  <Tile
                    label={layout.name}
                    active={layoutShort() === layout.short}
                    testId={`pptx-smartart-layout-option-${layout.short}`}
                    onClick={() => {
                      close();
                      void s().setLayout(layout.short);
                    }}
                  >
                    <SmartArtPreview
                      paths={s().preview({
                        layout: layout.short,
                        colors: colorsShort(),
                        style: styleShort(),
                        width: 84,
                        height: 60,
                      })}
                      width={84}
                      height={60}
                      class="h-[60px] w-[84px]"
                    />
                  </Tile>
                )}
              </For>
            </div>
          )}
        </RibbonPopover>
      </RibbonGroup>
      <RibbonGroup label="SmartArt Styles">
        <RibbonPopover
          label="Change Colors"
          text="Change Colors"
          icon={<Palette class="size-3.5" />}
          testId="pptx-smartart-colors"
        >
          {(close) => (
            <div class="flex max-h-[60vh] w-[370px] flex-col gap-1 overflow-y-auto">
              <For each={colorGroups(catalog())}>
                {(group) => (
                  <>
                    <PopoverLabel>{group.label}</PopoverLabel>
                    <div class="grid grid-cols-5 gap-1.5">
                      <For each={group.items}>
                        {(item) => colorTile(item, close)}
                      </For>
                    </div>
                  </>
                )}
              </For>
            </div>
          )}
        </RibbonPopover>
        <RibbonPopover
          label="SmartArt Styles"
          text={outline()?.styleName ?? 'Styles'}
          icon={<Shapes class="size-3.5" />}
          testId="pptx-smartart-styles"
        >
          {(close) => (
            <div class="flex w-[320px] flex-col gap-1">
              <PopoverLabel>Best Match for Document</PopoverLabel>
              <div class="grid grid-cols-5 gap-1.5">
                <For each={catalog()?.styles ?? []}>
                  {(style) => (
                    <Tile
                      label={style.name}
                      active={styleShort() === style.short}
                      testId={`pptx-smartart-style-${style.short}`}
                      onClick={() => {
                        close();
                        void s().setStyle(style.short);
                      }}
                    >
                      <SmartArtPreview
                        paths={s().preview({
                          layout: 'default',
                          colors: colorsShort(),
                          style: style.short,
                          width: 48,
                          height: 40,
                        })}
                        width={48}
                        height={40}
                        class="h-10 w-12"
                      />
                    </Tile>
                  )}
                </For>
              </div>
            </div>
          )}
        </RibbonPopover>
      </RibbonGroup>
      <RibbonGroup label="Reset">
        <RibbonTextButton
          label="Reset Graphic"
          tooltip="Discard formatting changes to the graphic"
          data-testid="pptx-smartart-reset"
          disabled={!supported()}
          onClick={() => void s().reset()}
        >
          <ArrowCounterClockwise />
          Reset Graphic
        </RibbonTextButton>
        <RibbonPopover
          label="Convert"
          text="Convert"
          icon={<Swap class="size-3.5" />}
          testId="pptx-smartart-convert"
        >
          {(close) => (
            <div class="flex w-44 flex-col">
              <PopoverItem
                label="Convert to Text"
                testId="pptx-smartart-convert-text"
                onClick={() => {
                  close();
                  void s().convert('text');
                }}
              />
              <PopoverItem
                label="Convert to Shapes"
                testId="pptx-smartart-convert-shapes"
                onClick={() => {
                  close();
                  void s().convert('shapes');
                }}
              />
            </div>
          )}
        </RibbonPopover>
      </RibbonGroup>
      <Show when={outline() && !supported()}>
        <span class="px-2 text-ink-muted text-xs">
          This layout's structure can't be changed here
        </span>
      </Show>
    </>
  );
}
