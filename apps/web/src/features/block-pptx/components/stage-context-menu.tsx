/**
 * Right-click menus on the slide: what they offer depends on what was
 * clicked (empty slide, shapes, text being edited, a table, a chart, a
 * SmartArt graphic).
 */

import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import AlignBottom from '@phosphor/align-bottom.svg';
import AlignCenterHorizontal from '@phosphor/align-center-horizontal.svg';
import AlignCenterVertical from '@phosphor/align-center-vertical.svg';
import AlignLeft from '@phosphor/align-left.svg';
import AlignRight from '@phosphor/align-right.svg';
import AlignTop from '@phosphor/align-top.svg';
import ArrowClockwise from '@phosphor/arrow-clockwise.svg';
import ArrowLineDown from '@phosphor/arrow-line-down.svg';
import ArrowLineUp from '@phosphor/arrow-line-up.svg';
import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import ChartBar from '@phosphor/chart-bar.svg';
import ChatText from '@phosphor/chat-text.svg';
import CheckIcon from '@phosphor/check.svg';
import ClipboardIcon from '@phosphor/clipboard.svg';
import Columns from '@phosphor/columns.svg';
import CopyIcon from '@phosphor/copy.svg';
import CopySimple from '@phosphor/copy-simple.svg';
import CropIcon from '@phosphor/crop.svg';
import GridFour from '@phosphor/grid-four.svg';
import ImageIcon from '@phosphor/image.svg';
import ImageSquare from '@phosphor/image-square.svg';
import LinkIcon from '@phosphor/link.svg';
import LinkBreak from '@phosphor/link-break.svg';
import ListBullets from '@phosphor/list-bullets.svg';
import PaintBucket from '@phosphor/paint-bucket.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import Plus from '@phosphor/plus.svg';
import Rows from '@phosphor/rows.svg';
import Scissors from '@phosphor/scissors.svg';
import SelectionAll from '@phosphor/selection-all.svg';
import SlidersHorizontal from '@phosphor/sliders-horizontal.svg';
import Stack from '@phosphor/stack.svg';
import TableIcon from '@phosphor/table.svg';
import TextAa from '@phosphor/text-aa.svg';
import Trash from '@phosphor/trash.svg';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import type { Swatch } from '../core/palette';
import type { AlignMode } from '../core/selection';
import type { EditorCommands } from '../primitives/create-editor-commands';
import { type SpellingMenu, SpellingMenuItems } from './spelling-menu';

/** What a right-click landed on. */
export type MenuTarget =
  | { kind: 'canvas' }
  | { kind: 'shapes' }
  | { kind: 'text' }
  | { kind: 'table' }
  | { kind: 'chart' }
  /** A drawing guide (by index among the deck's guides). */
  | { kind: 'guide'; index: number }
  | { kind: 'smartArt' };

/** View ▸ Guides and grid choices, and editing the deck's guides. */
export interface GuideMenuActions {
  /** Whether drawing guides show. */
  shown: boolean;
  toggle: () => void;
  gridlines: boolean;
  toggleGridlines: () => void;
  smartGuides: boolean;
  toggleSmartGuides: () => void;
  add: (orient: 'vertical' | 'horizontal') => void;
  remove: (index: number) => void;
  recolor: (index: number, color: string) => void;
}

export interface StageMenuActions {
  commands: EditorCommands;
  readonly: boolean;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  canPaste: boolean;
  editText?: () => void;
  openFormatPane: (
    section?: 'shape' | 'effects' | 'picture' | 'text' | 'size' | 'background'
  ) => void;
  replacePicture?: () => void;
  /** Enters crop mode for the selected picture. */
  crop?: () => void;
  /** Enters Edit Points for the selected shape, when its points can be edited. */
  editPoints?: () => void;
  editChartData?: () => void;
  changeChartType?: () => void;
  /** The SmartArt items (Add Shape, Change Layout, Convert…). */
  smartArt?: () => JSX.Element;
  selectRows?: () => void;
  selectColumns?: () => void;
  selectTable?: () => void;
  layouts: string[];
  currentLayout?: string;
  swatches: Swatch[];
  newSlide: () => void;
  hideSlide: () => void;
  slideHidden: boolean;
  isPicture: boolean;
  isGroup: boolean;
  selectionCount: number;
  textShape: boolean;
  /** Saves the one selected shape as a picture. */
  savePicture?: () => void;
  /** The link of the clicked text or shape, if it has one. */
  link?: string;
  /** Opens the Insert/Edit Link dialog. */
  editLink: () => void;
  /** Follows a link (opens a web address, goes to a slide). */
  openLink: (link: string) => void;
  removeLink: () => void;
  /** Review ▸ New Comment on what was right-clicked. */
  newComment?: () => void;
  /** Corrections for a misspelled word that was right-clicked. */
  spelling?: SpellingMenu;
  /** Grid and Guides (the empty slide's menu) and a guide's own menu. */
  guides?: GuideMenuActions;
}

/** PowerPoint's Grid and Guides submenu of the slide's menu. */
function GridAndGuides(props: {
  actions: GuideMenuActions;
  readonly: boolean;
}) {
  return (
    <Sub text="Grid and Guides" icon={<GridFour class="size-4" />}>
      <MenuItem
        text="Guides"
        icon={props.actions.shown ? CheckIcon : undefined}
        shortcut="opt+f9"
        onClick={props.actions.toggle}
      />
      <MenuItem
        text="Gridlines"
        icon={props.actions.gridlines ? CheckIcon : undefined}
        onClick={props.actions.toggleGridlines}
      />
      <MenuItem
        text="Smart Guides"
        icon={props.actions.smartGuides ? CheckIcon : undefined}
        onClick={props.actions.toggleSmartGuides}
      />
      <MenuSeparator />
      <MenuItem
        text="Add Vertical Guide"
        disabled={props.readonly}
        onClick={() => props.actions.add('vertical')}
      />
      <MenuItem
        text="Add Horizontal Guide"
        disabled={props.readonly}
        onClick={() => props.actions.add('horizontal')}
      />
    </Sub>
  );
}

/** Link…, or Edit/Open/Copy/Remove Link for something linked. */
function LinkItems(props: { a: StageMenuActions }) {
  const ro = () => props.a.readonly;
  return (
    <Show
      when={props.a.link}
      fallback={
        <MenuItem
          text="Link…"
          icon={LinkIcon}
          shortcut="cmd+k"
          disabled={ro()}
          onClick={() => props.a.editLink()}
        />
      }
    >
      {(link) => (
        <>
          <MenuItem
            text="Edit link…"
            icon={LinkIcon}
            shortcut="cmd+k"
            disabled={ro()}
            onClick={() => props.a.editLink()}
          />
          <MenuItem
            text="Open link"
            icon={ArrowSquareOut}
            onClick={() => props.a.openLink(link())}
          />
          <Show when={!link().startsWith('#')}>
            <MenuItem
              text="Copy link"
              icon={CopyIcon}
              onClick={() =>
                void navigator.clipboard.writeText(
                  link().replace(/^mailto:/i, '')
                )
              }
            />
          </Show>
          <MenuItem
            text="Remove link"
            icon={LinkBreak}
            disabled={ro()}
            onClick={() => props.a.removeLink()}
          />
        </>
      )}
    </Show>
  );
}

function Sub(props: {
  text: string;
  icon?: JSX.Element;
  disabled?: boolean;
  children: JSX.Element;
}) {
  return (
    <ContextMenu.Sub overlap gutter={2}>
      <SubTrigger
        text={props.text}
        icon={props.icon}
        disabled={props.disabled}
      />
      <ContextMenu.Portal>
        <ContextMenuContent submenu class="w-56">
          {props.children}
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  );
}

function ClipboardItems(props: { a: StageMenuActions; copyOnly?: boolean }) {
  return (
    <>
      <Show when={!props.copyOnly}>
        <MenuItem
          text="Cut"
          icon={Scissors}
          shortcut="cmd+x"
          disabled={props.a.readonly}
          onClick={props.a.cut}
        />
      </Show>
      <MenuItem
        text="Copy"
        icon={CopyIcon}
        shortcut="cmd+c"
        onClick={props.a.copy}
      />
      <MenuItem
        text="Paste"
        icon={ClipboardIcon}
        shortcut="cmd+v"
        disabled={props.a.readonly || !props.a.canPaste}
        onClick={props.a.paste}
      />
    </>
  );
}

function ArrangeItems(props: { a: StageMenuActions }) {
  const c = () => props.a.commands;
  const align = (mode: AlignMode) => () => c().alignShapes(mode);
  return (
    <>
      <Sub
        text="Group"
        icon={<Stack class="size-4" />}
        disabled={props.a.readonly}
      >
        <MenuItem
          text="Group"
          shortcut="cmd+g"
          disabled={props.a.selectionCount < 2}
          onClick={() => void c().group()}
        />
        <MenuItem
          text="Ungroup"
          shortcut="cmd+shift+g"
          disabled={!props.a.isGroup}
          onClick={() => void c().ungroup()}
        />
      </Sub>
      <Sub
        text="Bring to front"
        icon={<ArrowLineUp class="size-4" />}
        disabled={props.a.readonly}
      >
        <MenuItem
          text="Bring to front"
          shortcut="cmd+shift+]"
          onClick={() => c().arrange('front')}
        />
        <MenuItem
          text="Bring forward"
          shortcut="cmd+]"
          onClick={() => c().arrange('forward')}
        />
      </Sub>
      <Sub
        text="Send to back"
        icon={<ArrowLineDown class="size-4" />}
        disabled={props.a.readonly}
      >
        <MenuItem
          text="Send to back"
          shortcut="cmd+shift+["
          onClick={() => c().arrange('back')}
        />
        <MenuItem
          text="Send backward"
          shortcut="cmd+["
          onClick={() => c().arrange('backward')}
        />
      </Sub>
      <Sub
        text="Align"
        icon={<AlignLeft class="size-4" />}
        disabled={props.a.readonly}
      >
        <MenuItem text="Align left" icon={AlignLeft} onClick={align('left')} />
        <MenuItem
          text="Align center"
          icon={AlignCenterHorizontal}
          onClick={align('center')}
        />
        <MenuItem
          text="Align right"
          icon={AlignRight}
          onClick={align('right')}
        />
        <MenuSeparator />
        <MenuItem text="Align top" icon={AlignTop} onClick={align('top')} />
        <MenuItem
          text="Align middle"
          icon={AlignCenterVertical}
          onClick={align('middle')}
        />
        <MenuItem
          text="Align bottom"
          icon={AlignBottom}
          onClick={align('bottom')}
        />
        <MenuSeparator />
        <MenuItem
          text="Distribute horizontally"
          disabled={props.a.selectionCount === 2}
          onClick={align('distributeH')}
        />
        <MenuItem
          text="Distribute vertically"
          disabled={props.a.selectionCount === 2}
          onClick={align('distributeV')}
        />
      </Sub>
      <Sub
        text="Rotate"
        icon={<ArrowClockwise class="size-4" />}
        disabled={props.a.readonly}
      >
        <MenuItem
          text="Rotate right 90°"
          onClick={() => c().rotate('right90')}
        />
        <MenuItem text="Rotate left 90°" onClick={() => c().rotate('left90')} />
        <MenuItem text="Flip vertical" onClick={() => c().rotate('flipV')} />
        <MenuItem text="Flip horizontal" onClick={() => c().rotate('flipH')} />
      </Sub>
    </>
  );
}

function ColorSub(props: {
  text: string;
  icon: JSX.Element;
  swatches: Swatch[];
  noneLabel?: string;
  disabled?: boolean;
  onPick: (value: string | null) => void;
}) {
  return (
    <Sub text={props.text} icon={props.icon} disabled={props.disabled}>
      <div class="grid grid-cols-8 gap-1 p-1.5">
        <For each={props.swatches}>
          {(s) => (
            <ContextMenu.Item
              class="size-5 rounded-sm border border-edge-muted outline-none data-[highlighted]:ring-2 data-[highlighted]:ring-accent"
              style={{ background: s.css }}
              aria-label={s.label}
              title={s.label}
              onSelect={() => props.onPick(s.value)}
            />
          )}
        </For>
      </div>
      <Show when={props.noneLabel}>
        <MenuItem text={props.noneLabel} onClick={() => props.onPick(null)} />
      </Show>
    </Sub>
  );
}

/** The menu for a target. */
export function StageMenuItems(props: {
  target: MenuTarget;
  a: StageMenuActions;
}) {
  const a = () => props.a;
  const c = () => props.a.commands;
  const ro = () => props.a.readonly;
  return (
    <>
      <Show when={a().spelling}>
        {(menu) => <SpellingMenuItems menu={menu()} />}
      </Show>
      <Switch>
        <Match when={props.target.kind === 'canvas'}>
          <ClipboardItems a={a()} copyOnly />
          <MenuSeparator />
          <MenuItem
            text="Select all"
            icon={SelectionAll}
            shortcut="cmd+a"
            onClick={() => c().selectAll()}
          />
          <MenuSeparator />
          <MenuItem
            text="New slide"
            icon={Plus}
            shortcut="cmd+m"
            disabled={ro()}
            onClick={a().newSlide}
          />
          <Show when={a().layouts.length > 0}>
            <Sub text="Layout" disabled={ro()}>
              <For each={a().layouts}>
                {(layout) => (
                  <MenuItem
                    text={layout}
                    icon={layout === a().currentLayout ? CheckIcon : undefined}
                    onClick={() => void c().setLayout(layout)}
                  />
                )}
              </For>
            </Sub>
          </Show>
          <MenuItem
            text={a().slideHidden ? 'Unhide slide' : 'Hide slide'}
            disabled={ro()}
            onClick={a().hideSlide}
          />
          <MenuSeparator />
          <Show when={a().guides}>
            {(actions) => <GridAndGuides actions={actions()} readonly={ro()} />}
          </Show>
          <MenuItem
            text="Format background…"
            icon={PaintBucket}
            disabled={ro()}
            onClick={() => a().openFormatPane('background')}
          />
        </Match>
        <Match
          when={
            props.target.kind === 'guide' && a().guides
              ? { actions: a().guides!, index: props.target.index }
              : undefined
          }
        >
          {(guide) => (
            <>
              <MenuItem
                text="Add Vertical Guide"
                disabled={ro()}
                onClick={() => guide().actions.add('vertical')}
              />
              <MenuItem
                text="Add Horizontal Guide"
                disabled={ro()}
                onClick={() => guide().actions.add('horizontal')}
              />
              <MenuSeparator />
              <ColorSub
                text="Color"
                icon={<PaintBucket class="size-4" />}
                swatches={a().swatches}
                disabled={ro()}
                onPick={(v) => v && guide().actions.recolor(guide().index, v)}
              />
              <MenuItem
                text="Delete"
                icon={Trash}
                disabled={ro()}
                onClick={() => guide().actions.remove(guide().index)}
              />
            </>
          )}
        </Match>
        <Match when={props.target.kind === 'text'}>
          <ClipboardItems a={a()} />
          <MenuSeparator />
          <MenuItem
            text="Font…"
            icon={TextAa}
            disabled={ro()}
            onClick={() => a().openFormatPane('text')}
          />
          <MenuItem
            text="Paragraph…"
            icon={ListBullets}
            disabled={ro()}
            onClick={() => a().openFormatPane('text')}
          />
          <Sub
            text="Bullets"
            icon={<ListBullets class="size-4" />}
            disabled={ro()}
          >
            <MenuItem
              text="None"
              onClick={() => void c().setBullets({ kind: 'none' })}
            />
            <For each={['•', '○', '▪', '➢', '✓', '–']}>
              {(char) => (
                <MenuItem
                  text={`${char}  Bullet`}
                  onClick={() => void c().setBullets({ kind: 'char', char })}
                />
              )}
            </For>
          </Sub>
          <Sub text="Numbering" disabled={ro()}>
            <MenuItem
              text="None"
              onClick={() => void c().setBullets({ kind: 'none' })}
            />
            <For
              each={[
                ['arabicPeriod', '1. 2. 3.'],
                ['arabicParenR', '1) 2) 3)'],
                ['romanUcPeriod', 'I. II. III.'],
                ['alphaUcPeriod', 'A. B. C.'],
                ['alphaLcParenR', 'a) b) c)'],
              ]}
            >
              {([scheme, label]) => (
                <MenuItem
                  text={label}
                  onClick={() =>
                    void c().setBullets({ kind: 'number', scheme, start: 1 })
                  }
                />
              )}
            </For>
          </Sub>
          <LinkItems a={a()} />
          <MenuSeparator />
          <MenuItem
            text="Select all"
            icon={SelectionAll}
            shortcut="cmd+a"
            onClick={() => c().selectAll()}
          />
        </Match>
        <Match when={props.target.kind === 'table'}>
          <ClipboardItems a={a()} />
          <MenuSeparator />
          <Sub text="Insert" icon={<Plus class="size-4" />} disabled={ro()}>
            <MenuItem
              text="Insert rows above"
              icon={Rows}
              onClick={() => void c().insertRows('above')}
            />
            <MenuItem
              text="Insert rows below"
              icon={Rows}
              onClick={() => void c().insertRows('below')}
            />
            <MenuItem
              text="Insert columns left"
              icon={Columns}
              onClick={() => void c().insertColumns('left')}
            />
            <MenuItem
              text="Insert columns right"
              icon={Columns}
              onClick={() => void c().insertColumns('right')}
            />
          </Sub>
          <Sub text="Delete" icon={<Trash class="size-4" />} disabled={ro()}>
            <MenuItem
              text="Delete rows"
              onClick={() => void c().deleteRows()}
            />
            <MenuItem
              text="Delete columns"
              onClick={() => void c().deleteColumns()}
            />
            <MenuItem
              text="Delete table"
              onClick={() => void c().deleteTable()}
            />
          </Sub>
          <Sub text="Select" icon={<TableIcon class="size-4" />}>
            <MenuItem text="Select row" onClick={() => a().selectRows?.()} />
            <MenuItem
              text="Select column"
              onClick={() => a().selectColumns?.()}
            />
            <MenuItem text="Select table" onClick={() => a().selectTable?.()} />
          </Sub>
          <MenuItem
            text="Merge cells"
            disabled={ro() || !c().canMerge()}
            onClick={() => void c().mergeCells()}
          />
          <MenuItem
            text="Split cells"
            disabled={ro() || !c().canSplit()}
            onClick={() => void c().splitCells()}
          />
          <MenuSeparator />
          <ColorSub
            text="Shading"
            icon={<PaintBucket class="size-4" />}
            swatches={a().swatches}
            noneLabel="No fill"
            disabled={ro()}
            onPick={(v) => void c().fillCells(v)}
          />
          <Sub text="Borders" disabled={ro()}>
            <For
              each={
                [
                  ['all', 'All borders'],
                  ['outside', 'Outside borders'],
                  ['inside', 'Inside borders'],
                  ['top', 'Top border'],
                  ['bottom', 'Bottom border'],
                  ['left', 'Left border'],
                  ['right', 'Right border'],
                  ['insideHorizontal', 'Inside horizontal border'],
                  ['insideVertical', 'Inside vertical border'],
                ] as const
              }
            >
              {([edges, label]) => (
                <MenuItem
                  text={label}
                  onClick={() => void c().borderCells(edges)}
                />
              )}
            </For>
            <MenuSeparator />
            <MenuItem
              text="No border"
              onClick={() => void c().borderCells('all', true)}
            />
          </Sub>
          <Sub text="Align text" disabled={ro()}>
            <MenuItem
              text="Left"
              icon={AlignLeft}
              onClick={() => void c().alignCells('left')}
            />
            <MenuItem
              text="Center"
              icon={AlignCenterHorizontal}
              onClick={() => void c().alignCells('center')}
            />
            <MenuItem
              text="Right"
              icon={AlignRight}
              onClick={() => void c().alignCells('right')}
            />
            <MenuSeparator />
            <MenuItem
              text="Top"
              icon={AlignTop}
              onClick={() => void c().anchorCells('top')}
            />
            <MenuItem
              text="Middle"
              icon={AlignCenterVertical}
              onClick={() => void c().anchorCells('middle')}
            />
            <MenuItem
              text="Bottom"
              icon={AlignBottom}
              onClick={() => void c().anchorCells('bottom')}
            />
          </Sub>
          <MenuItem
            text="Distribute rows"
            disabled={ro()}
            onClick={() => void c().distributeRows()}
          />
          <MenuItem
            text="Distribute columns"
            disabled={ro()}
            onClick={() => void c().distributeColumns()}
          />
          <MenuSeparator />
          <ArrangeItems a={a()} />
          <MenuItem
            text="Format shape…"
            icon={SlidersHorizontal}
            disabled={ro()}
            onClick={() => a().openFormatPane('shape')}
          />
        </Match>
        <Match when={props.target.kind === 'chart'}>
          <ClipboardItems a={a()} />
          <MenuSeparator />
          <Show when={a().editChartData}>
            <MenuItem
              text="Edit data…"
              icon={TableIcon}
              disabled={ro()}
              onClick={() => a().editChartData?.()}
            />
          </Show>
          <Show when={a().changeChartType}>
            <MenuItem
              text="Change chart type…"
              icon={ChartBar}
              disabled={ro()}
              onClick={() => a().changeChartType?.()}
            />
          </Show>
          <MenuSeparator />
          <ArrangeItems a={a()} />
          <MenuItem
            text="Format chart area…"
            icon={SlidersHorizontal}
            disabled={ro()}
            onClick={() => a().openFormatPane('shape')}
          />
          <MenuSeparator />
          <MenuItem
            text="Delete"
            icon={Trash}
            shortcut="delete"
            disabled={ro()}
            onClick={() => void a().commands.deleteSelection()}
          />
        </Match>
        <Match when={props.target.kind === 'smartArt'}>
          <ClipboardItems a={a()} />
          <MenuSeparator />
          {a().smartArt?.()}
          <MenuSeparator />
          <ArrangeItems a={a()} />
          <MenuItem
            text="Size and position…"
            disabled={ro()}
            onClick={() => a().openFormatPane('size')}
          />
          <MenuSeparator />
          <MenuItem
            text="Delete"
            icon={Trash}
            shortcut="delete"
            disabled={ro()}
            onClick={() => void a().commands.deleteSelection()}
          />
        </Match>
        <Match when={props.target.kind === 'shapes'}>
          <ClipboardItems a={a()} />
          <MenuItem
            text="Duplicate"
            icon={CopySimple}
            shortcut="cmd+d"
            disabled={ro()}
            onClick={() => void c().duplicateSelection()}
          />
          <MenuSeparator />
          <Show
            when={a().editText && a().textShape && a().selectionCount === 1}
          >
            <MenuItem
              text="Edit text"
              icon={PencilSimple}
              shortcut="enter"
              disabled={ro()}
              onClick={() => a().editText?.()}
            />
          </Show>
          <Show when={a().editPoints && a().selectionCount === 1}>
            <MenuItem
              text="Edit Points"
              icon={PencilSimple}
              disabled={ro()}
              onClick={() => a().editPoints?.()}
            />
          </Show>
          <Show when={a().isPicture && a().replacePicture}>
            <MenuItem
              text="Change picture…"
              icon={ImageIcon}
              disabled={ro()}
              onClick={() => a().replacePicture?.()}
            />
          </Show>
          <Show when={a().isPicture && a().crop}>
            <MenuItem
              text="Crop"
              icon={CropIcon}
              disabled={ro()}
              onClick={() => a().crop?.()}
            />
          </Show>
          <ArrangeItems a={a()} />
          <Show when={a().selectionCount > 0}>
            <MenuSeparator />
            <LinkItems a={a()} />
          </Show>
          <MenuSeparator />
          <ColorSub
            text="Fill"
            icon={<PaintBucket class="size-4" />}
            swatches={a().swatches}
            noneLabel="No fill"
            disabled={ro()}
            onPick={(v) => void c().fillColor(v)}
          />
          <ColorSub
            text="Outline"
            icon={<PencilSimple class="size-4" />}
            swatches={a().swatches}
            noneLabel="No outline"
            disabled={ro()}
            onPick={(v) => void c().setLine(v ? { color: v } : { none: true })}
          />
          <MenuItem
            text="Size and position…"
            disabled={ro()}
            onClick={() => a().openFormatPane('size')}
          />
          <Show when={a().savePicture && a().selectionCount === 1}>
            <MenuItem
              text="Save as picture…"
              icon={ImageSquare}
              onClick={() => a().savePicture?.()}
            />
          </Show>
          <MenuItem
            text={a().isPicture ? 'Format picture…' : 'Format shape…'}
            icon={SlidersHorizontal}
            disabled={ro()}
            onClick={() =>
              a().openFormatPane(a().isPicture ? 'picture' : 'shape')
            }
          />
          <MenuSeparator />
          <MenuItem
            text="Delete"
            icon={Trash}
            shortcut="delete"
            disabled={ro()}
            onClick={() => void c().deleteSelection()}
          />
        </Match>
      </Switch>
      <Show when={a().newComment}>
        {(newComment) => (
          <>
            <MenuSeparator />
            <MenuItem
              text="New Comment"
              icon={ChatText}
              disabled={ro()}
              onClick={() => newComment()()}
            />
          </>
        )}
      </Show>
    </>
  );
}
