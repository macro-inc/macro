/**
 * The Home tab: clipboard, slides, font, paragraph, drawing, and editing.
 */

import { fireAndForget } from '@core/util/fireAndForget';
import AlignBottom from '@icon/system/regular/align-bottom.svg';
import AlignCenterHorizontal from '@icon/system/regular/align-center-horizontal.svg';
import AlignCenterVertical from '@icon/system/regular/align-center-vertical.svg';
import AlignLeft from '@icon/system/regular/align-left.svg';
import AlignRight from '@icon/system/regular/align-right.svg';
import AlignTop from '@icon/system/regular/align-top.svg';
import ArrowClockwise from '@icon/system/regular/arrow-clockwise.svg';
import ArrowCounterClockwise from '@icon/system/regular/arrow-counter-clockwise.svg';
import ArrowDown from '@icon/system/regular/arrow-down.svg';
import ArrowLineDown from '@icon/system/regular/arrow-line-down.svg';
import ArrowLineUp from '@icon/system/regular/arrow-line-up.svg';
import ArrowUp from '@icon/system/regular/arrow-up.svg';
import ArrowsHorizontal from '@icon/system/regular/arrows-horizontal.svg';
import ArrowsVertical from '@icon/system/regular/arrows-vertical.svg';
import ClipboardIcon from '@icon/system/regular/clipboard.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import CopySimple from '@icon/system/regular/copy-simple.svg';
import Eraser from '@icon/system/regular/eraser.svg';
import FlipHorizontal from '@icon/system/regular/flip-horizontal.svg';
import FlipVertical from '@icon/system/regular/flip-vertical.svg';
import Highlighter from '@icon/system/regular/highlighter.svg';
import ListBullets from '@icon/system/regular/list-bullets.svg';
import ListNumbers from '@icon/system/regular/list-numbers.svg';
import MagnifyingGlass from '@icon/system/regular/magnifying-glass.svg';
import PaintBrush from '@icon/system/regular/paint-brush.svg';
import PaintBucket from '@icon/system/regular/paint-bucket.svg';
import PenNib from '@icon/system/regular/pen-nib.svg';
import Plus from '@icon/system/regular/plus.svg';
import Scissors from '@icon/system/regular/scissors.svg';
import SelectionAll from '@icon/system/regular/selection-all.svg';
import ShapesIcon from '@icon/system/regular/shapes.svg';
import Stack from '@icon/system/regular/stack.svg';
import TextAa from '@icon/system/regular/text-aa.svg';
import TextAlignCenter from '@icon/system/regular/text-align-center.svg';
import TextAlignJustify from '@icon/system/regular/text-align-justify.svg';
import TextAlignLeft from '@icon/system/regular/text-align-left.svg';
import TextAlignRight from '@icon/system/regular/text-align-right.svg';
import TextB from '@icon/system/regular/text-b.svg';
import TextIndent from '@icon/system/regular/text-indent.svg';
import TextItalic from '@icon/system/regular/text-italic.svg';
import TextOutdent from '@icon/system/regular/text-outdent.svg';
import TextStrikethrough from '@icon/system/regular/text-strikethrough.svg';
import TextSubscript from '@icon/system/regular/text-subscript.svg';
import TextSuperscript from '@icon/system/regular/text-superscript.svg';
import TextUnderline from '@icon/system/regular/text-underline.svg';
import Trash from '@icon/system/regular/trash.svg';
import { For, type JSX, Show } from 'solid-js';
import { CHARACTER_SPACINGS } from '../../core/formatting';
import { swatchCss } from '../../core/palette';
import type { AlignMode } from '../../core/selection';
import {
  ColorBarIcon,
  ColorPicker,
  NumberField,
  PopoverItem,
  PopoverLabel,
  RibbonButton,
  RibbonGroup,
  RibbonPopover,
  RibbonTextButton,
} from './controls';
import { SectionMenu } from './deck-setup-controls';
import { FontPicker, FontSizePicker } from './font-controls';
import { useRibbon } from './ribbon';
import { ShapeGallery } from './shape-gallery';
import { TextDirectionMenu } from './text-direction';

const BULLETS: { char: string; label: string }[] = [
  { char: '•', label: 'Filled round' },
  { char: '○', label: 'Hollow round' },
  { char: '▪', label: 'Filled square' },
  { char: '□', label: 'Hollow square' },
  { char: '➢', label: 'Arrow' },
  { char: '✓', label: 'Check mark' },
  { char: '–', label: 'Dash' },
];

const NUMBERING: { scheme: string; label: string; sample: string }[] = [
  { scheme: 'arabicPeriod', label: '1. 2. 3.', sample: '1.' },
  { scheme: 'arabicParenR', label: '1) 2) 3)', sample: '1)' },
  { scheme: 'romanUcPeriod', label: 'I. II. III.', sample: 'I.' },
  { scheme: 'alphaUcPeriod', label: 'A. B. C.', sample: 'A.' },
  { scheme: 'alphaLcParenR', label: 'a) b) c)', sample: 'a)' },
  { scheme: 'alphaLcPeriod', label: 'a. b. c.', sample: 'a.' },
  { scheme: 'romanLcPeriod', label: 'i. ii. iii.', sample: 'i.' },
];

const LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3];

/** Arrange menu: order, group, align, rotate. Shared with Shape Format. */
export function ArrangeMenu(props: { close: () => void }) {
  const env = useRibbon();
  const c = env.commands;
  const count = () => env.selection().length;
  const run = (fn: () => void) => () => {
    props.close();
    fn();
  };
  const alignItems: { mode: AlignMode; label: string; icon: JSX.Element }[] = [
    { mode: 'left', label: 'Align left', icon: <AlignLeft /> },
    { mode: 'center', label: 'Align center', icon: <AlignCenterHorizontal /> },
    { mode: 'right', label: 'Align right', icon: <AlignRight /> },
    { mode: 'top', label: 'Align top', icon: <AlignTop /> },
    { mode: 'middle', label: 'Align middle', icon: <AlignCenterVertical /> },
    { mode: 'bottom', label: 'Align bottom', icon: <AlignBottom /> },
    {
      mode: 'distributeH',
      label: 'Distribute horizontally',
      icon: <AlignCenterHorizontal />,
    },
    {
      mode: 'distributeV',
      label: 'Distribute vertically',
      icon: <AlignCenterVertical />,
    },
  ];
  return (
    <div class="flex w-56 flex-col">
      <PopoverItem
        label="Selection Pane…"
        icon={<Stack />}
        hint="⌥F10"
        active={env.selectionPane.open()}
        testId="pptx-selection-pane-toggle"
        onClick={run(env.selectionPane.toggle)}
      />
      <PopoverLabel>Order objects</PopoverLabel>
      <PopoverItem
        label="Bring to front"
        disabled={count() === 0}
        icon={<ArrowLineUp />}
        hint="⇧⌘]"
        onClick={run(() => c.arrange('front'))}
      />
      <PopoverItem
        label="Send to back"
        disabled={count() === 0}
        icon={<ArrowLineDown />}
        hint="⇧⌘["
        onClick={run(() => c.arrange('back'))}
      />
      <PopoverItem
        label="Bring forward"
        disabled={count() === 0}
        icon={<ArrowUp />}
        hint="⌘]"
        onClick={run(() => c.arrange('forward'))}
      />
      <PopoverItem
        label="Send backward"
        disabled={count() === 0}
        icon={<ArrowDown />}
        hint="⌘["
        onClick={run(() => c.arrange('backward'))}
      />
      <PopoverLabel>Group objects</PopoverLabel>
      <PopoverItem
        label="Group"
        icon={<Stack />}
        hint="⌘G"
        disabled={count() < 2}
        onClick={run(() => c.group())}
      />
      <PopoverItem
        label="Ungroup"
        icon={<Stack />}
        hint="⇧⌘G"
        disabled={!env.selection().some((s) => s.kind === 'group')}
        onClick={run(() => c.ungroup())}
      />
      <PopoverLabel>Position objects</PopoverLabel>
      <For each={alignItems}>
        {(item) => (
          <PopoverItem
            label={item.label}
            icon={item.icon}
            disabled={
              item.mode.startsWith('distribute')
                ? count() < 3 && count() !== 1
                : count() === 0
            }
            onClick={run(() => c.alignShapes(item.mode))}
          />
        )}
      </For>
      <PopoverLabel>Rotate</PopoverLabel>
      <PopoverItem
        label="Rotate right 90°"
        disabled={count() === 0}
        icon={<ArrowClockwise />}
        onClick={run(() => c.rotate('right90'))}
      />
      <PopoverItem
        label="Rotate left 90°"
        disabled={count() === 0}
        icon={<ArrowCounterClockwise />}
        onClick={run(() => c.rotate('left90'))}
      />
      <PopoverItem
        label="Flip vertical"
        disabled={count() === 0}
        icon={<FlipVertical />}
        onClick={run(() => c.rotate('flipV'))}
      />
      <PopoverItem
        label="Flip horizontal"
        disabled={count() === 0}
        icon={<FlipHorizontal />}
        onClick={run(() => c.rotate('flipH'))}
      />
    </div>
  );
}

/** Shape outline menu: color, weight, dashes, arrows. Shared with Shape Format. */
export function OutlineMenu(props: { close: () => void }) {
  const env = useRibbon();
  const c = env.commands;
  const run = (fn: () => void) => {
    props.close();
    fn();
  };
  return (
    <div class="flex flex-col gap-1">
      <ColorPicker
        themeGrid={env.themeGrid()}
        standard={env.standardColors}
        noneLabel="No outline"
        onPick={(v) =>
          run(() =>
            fireAndForget(
              c.setLine(v ? { color: v } : { none: true }),
              'pptx-editor'
            )
          )
        }
      />
      <PopoverLabel>Weight</PopoverLabel>
      <div class="grid grid-cols-4 gap-0.5">
        <For each={[0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6]}>
          {(w) => (
            <button
              type="button"
              class="flex h-6 items-center gap-1 rounded-md px-1 text-xs hover:bg-ink/5"
              onClick={() =>
                run(() => fireAndForget(c.setLine({ width: w }), 'pptx-editor'))
              }
            >
              <span
                class="w-5 bg-ink"
                style={{ height: `${Math.max(1, w * 0.9)}px` }}
              />
              {w}
            </button>
          )}
        </For>
      </div>
      <PopoverLabel>Dashes</PopoverLabel>
      <div class="grid grid-cols-4 gap-0.5">
        <For
          each={[
            ['solid', 'none'],
            ['sysDot', '1 2'],
            ['sysDash', '3 2'],
            ['dash', '4 3'],
            ['dashDot', '4 2 1 2'],
            ['lgDash', '8 3'],
            ['lgDashDot', '8 3 1 3'],
            ['lgDashDotDot', '8 2 1 2 1 2'],
          ]}
        >
          {([dash, pattern]) => (
            <button
              type="button"
              title={dash}
              class="flex h-6 items-center justify-center rounded-md px-1 hover:bg-ink/5"
              onClick={() =>
                run(() => fireAndForget(c.setLine({ dash }), 'pptx-editor'))
              }
            >
              <svg viewBox="0 0 28 4" class="h-1 w-7">
                <line
                  x1="0"
                  y1="2"
                  x2="28"
                  y2="2"
                  class="stroke-ink"
                  stroke-width="2"
                  stroke-dasharray={pattern === 'none' ? undefined : pattern}
                />
              </svg>
            </button>
          )}
        </For>
      </div>
      <PopoverLabel>Arrows</PopoverLabel>
      <div class="grid grid-cols-3 gap-0.5">
        <For
          each={[
            ['none', 'none', 'No arrows'],
            ['none', 'triangle', 'Arrow at end'],
            ['triangle', 'none', 'Arrow at start'],
            ['triangle', 'triangle', 'Arrows at both ends'],
            ['none', 'stealth', 'Stealth arrow'],
            ['oval', 'oval', 'Round ends'],
          ]}
        >
          {([head, tail, label]) => (
            <button
              type="button"
              title={label}
              class="flex h-6 items-center justify-center rounded-md hover:bg-ink/5"
              onClick={() =>
                run(() =>
                  fireAndForget(c.setLine({ head, tail }), 'pptx-editor')
                )
              }
            >
              <svg viewBox="0 0 28 8" class="h-2 w-7">
                <line
                  x1="3"
                  y1="4"
                  x2="25"
                  y2="4"
                  class="stroke-ink"
                  stroke-width="1.5"
                />
                <Show when={tail !== 'none'}>
                  <path
                    d={
                      tail === 'oval'
                        ? 'M25 4m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0'
                        : 'M28 4 L22 1 L22 7 Z'
                    }
                    class="fill-ink"
                  />
                </Show>
                <Show when={head !== 'none'}>
                  <path
                    d={
                      head === 'oval'
                        ? 'M3 4m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0'
                        : 'M0 4 L6 1 L6 7 Z'
                    }
                    class="fill-ink"
                  />
                </Show>
              </svg>
            </button>
          )}
        </For>
      </div>
      <PopoverItem
        label="More outline options…"
        onClick={() => run(() => env.openFormatPane('shape'))}
      />
    </div>
  );
}

export function FillMenu(props: { close: () => void }) {
  const env = useRibbon();
  return (
    <div class="flex flex-col gap-1">
      <ColorPicker
        themeGrid={env.themeGrid()}
        standard={env.standardColors}
        noneLabel="No fill"
        testId="pptx-fill-colors"
        onPick={(v) => {
          props.close();
          fireAndForget(env.commands.fillColor(v), 'pptx-editor');
        }}
      />
      <PopoverItem
        label="Gradient and more fill options…"
        onClick={() => {
          props.close();
          env.openFormatPane('shape');
        }}
      />
    </div>
  );
}

export function HomeTab() {
  const env = useRibbon();
  const c = env.commands;
  const f = () => c.format();
  const text = () => c.textActive() && !env.readonly();
  const shapes = () => env.selection().length > 0 && !env.readonly();
  const ro = () => env.readonly();
  const colors = () => env.deck()?.themeColors ?? [];
  return (
    <>
      <RibbonGroup label="Clipboard">
        <RibbonButton
          label="Paste"
          tooltip="Paste (⌘V)"
          disabled={ro()}
          onClick={env.paste}
        >
          <ClipboardIcon />
        </RibbonButton>
        <RibbonButton
          label="Cut"
          tooltip="Cut (⌘X)"
          disabled={ro()}
          onClick={env.cut}
        >
          <Scissors />
        </RibbonButton>
        <RibbonButton label="Copy" tooltip="Copy (⌘C)" onClick={env.copy}>
          <CopyIcon />
        </RibbonButton>
        <RibbonButton
          label="Format Painter"
          tooltip="Format Painter: click to paint once, double-click to keep painting (⇧⌘C / ⇧⌘V)"
          disabled={ro() || env.selection().length === 0}
          active={env.formatPainter.active()}
          data-testid="pptx-format-painter"
          onClick={() => {
            if (env.formatPainter.active()) env.formatPainter.cancel();
            else fireAndForget(env.formatPainter.arm(false), 'pptx-editor');
          }}
          onDblClick={() =>
            fireAndForget(env.formatPainter.arm(true), 'pptx-editor')
          }
        >
          <PaintBrush />
        </RibbonButton>
      </RibbonGroup>
      <RibbonGroup label="Slides">
        <RibbonTextButton
          label="New slide"
          tooltip="New slide (⌘M)"
          disabled={ro()}
          data-testid="pptx-new-slide"
          onClick={() => fireAndForget(c.addSlide(), 'pptx-editor')}
        >
          <Plus />
          New slide
        </RibbonTextButton>
        <RibbonPopover
          label="New slide with layout"
          icon={<span class="sr-only">Layouts</span>}
          disabled={ro()}
          testId="pptx-new-slide-layout"
        >
          {(close) => (
            <div class="flex max-h-[60vh] w-56 flex-col overflow-y-auto">
              <PopoverLabel>Layouts</PopoverLabel>
              <For each={env.deck()?.layouts ?? []}>
                {(layout) => (
                  <PopoverItem
                    label={layout.name}
                    onClick={() => {
                      close();
                      fireAndForget(c.addSlide(layout.name), 'pptx-editor');
                    }}
                  />
                )}
              </For>
            </div>
          )}
        </RibbonPopover>
        <RibbonPopover
          label="Layout"
          icon={<span>Layout</span>}
          disabled={ro()}
        >
          {(close) => (
            <div class="flex max-h-[60vh] w-56 flex-col overflow-y-auto">
              <For each={env.deck()?.layouts ?? []}>
                {(layout) => (
                  <PopoverItem
                    label={layout.name}
                    active={layout.name === env.slide()?.layout}
                    onClick={() => {
                      close();
                      fireAndForget(c.setLayout(layout.name), 'pptx-editor');
                    }}
                  />
                )}
              </For>
            </div>
          )}
        </RibbonPopover>
        <SectionMenu />
        <RibbonButton
          label="Duplicate slide"
          tooltip="Duplicate slide"
          disabled={ro()}
          onClick={() => fireAndForget(c.duplicateSlide(), 'pptx-editor')}
        >
          <CopySimple />
        </RibbonButton>
        <RibbonButton
          label="Delete slide"
          tooltip="Delete slide"
          disabled={ro() || (env.deck()?.slides.length ?? 0) <= 1}
          onClick={() => {
            const s = env.slide();
            if (s) fireAndForget(c.deleteSlides([s.id]), 'pptx-editor');
          }}
        >
          <Trash />
        </RibbonButton>
      </RibbonGroup>
      <RibbonGroup label="Font">
        <FontPicker
          value={text() ? f().font : undefined}
          disabled={!text()}
          recent={env.recentFonts()}
          themeFonts={env.deck()?.themeFonts}
          onPick={(font) => fireAndForget(c.setFont(font), 'pptx-editor')}
        />
        <FontSizePicker
          value={text() ? f().size : undefined}
          disabled={!text()}
          onPick={(size) => fireAndForget(c.setFontSize(size), 'pptx-editor')}
        />
        <RibbonButton
          label="Increase font size"
          tooltip="Increase font size (⇧⌘>)"
          disabled={!text()}
          onClick={() => fireAndForget(c.stepSize(1), 'pptx-editor')}
        >
          <span class="font-semibold text-[13px] leading-none">
            A<sup>+</sup>
          </span>
        </RibbonButton>
        <RibbonButton
          label="Decrease font size"
          tooltip="Decrease font size (⇧⌘<)"
          disabled={!text()}
          onClick={() => fireAndForget(c.stepSize(-1), 'pptx-editor')}
        >
          <span class="font-semibold text-[11px] leading-none">
            A<sup>−</sup>
          </span>
        </RibbonButton>
        <RibbonButton
          label="Clear formatting"
          tooltip="Clear all formatting"
          disabled={!text()}
          onClick={() => fireAndForget(c.clearFormatting(), 'pptx-editor')}
        >
          <Eraser />
        </RibbonButton>
        <RibbonButton
          label="Bold"
          tooltip="Bold (⌘B)"
          data-testid="pptx-bold"
          disabled={!text()}
          active={text() && f().bold}
          onClick={() => fireAndForget(c.toggle('bold'), 'pptx-editor')}
        >
          <TextB />
        </RibbonButton>
        <RibbonButton
          label="Italic"
          tooltip="Italic (⌘I)"
          disabled={!text()}
          active={text() && f().italic}
          onClick={() => fireAndForget(c.toggle('italic'), 'pptx-editor')}
        >
          <TextItalic />
        </RibbonButton>
        <RibbonButton
          label="Underline"
          tooltip="Underline (⌘U)"
          disabled={!text()}
          active={text() && f().underline}
          onClick={() => fireAndForget(c.toggle('underline'), 'pptx-editor')}
        >
          <TextUnderline />
        </RibbonButton>
        <RibbonButton
          label="Strikethrough"
          tooltip="Strikethrough"
          disabled={!text()}
          active={text() && f().strike}
          onClick={() => fireAndForget(c.toggle('strike'), 'pptx-editor')}
        >
          <TextStrikethrough />
        </RibbonButton>
        <RibbonButton
          label="Superscript"
          tooltip="Superscript (⇧⌘=)"
          disabled={!text()}
          active={text() && (f().baseline ?? 0) > 0}
          onClick={() =>
            fireAndForget(c.toggleBaseline('super'), 'pptx-editor')
          }
        >
          <TextSuperscript />
        </RibbonButton>
        <RibbonButton
          label="Subscript"
          tooltip="Subscript (⌘=)"
          disabled={!text()}
          active={text() && (f().baseline ?? 0) < 0}
          onClick={() => fireAndForget(c.toggleBaseline('sub'), 'pptx-editor')}
        >
          <TextSubscript />
        </RibbonButton>
        <RibbonPopover
          label="Text highlight color"
          disabled={!text()}
          icon={
            <ColorBarIcon
              icon={<Highlighter class="size-3.5" />}
              color={f().highlight ?? '#FFFF00'}
            />
          }
        >
          {(close) => (
            <ColorPicker
              themeGrid={[]}
              standard={env.standardColors}
              noneLabel="No color"
              onPick={(v) => {
                close();
                fireAndForget(c.setHighlight(v), 'pptx-editor');
              }}
            />
          )}
        </RibbonPopover>
        <RibbonPopover
          label="Font color"
          testId="pptx-text-color"
          disabled={!text()}
          icon={
            <ColorBarIcon
              icon={<TextAa class="size-3.5" />}
              color={swatchCss(f().color, colors()) ?? '#C00000'}
            />
          }
        >
          {(close) => (
            <ColorPicker
              themeGrid={env.themeGrid()}
              standard={env.standardColors}
              onPick={(v) => {
                close();
                if (v) fireAndForget(c.setTextColor(v), 'pptx-editor');
              }}
            />
          )}
        </RibbonPopover>
        <RibbonPopover
          label="Character spacing"
          testId="pptx-char-spacing"
          disabled={!text()}
          icon={<ArrowsHorizontal class="size-3.5" />}
        >
          {(close) => (
            <div class="flex w-48 flex-col">
              <For each={CHARACTER_SPACINGS}>
                {(s) => (
                  <PopoverItem
                    label={s.label}
                    active={(f().spacing ?? 0) === s.value}
                    testId={`pptx-char-spacing-${s.value}`}
                    onClick={() => {
                      close();
                      fireAndForget(c.setCharSpacing(s.value), 'pptx-editor');
                    }}
                  />
                )}
              </For>
              <div class="mt-1 flex items-center justify-between gap-2 border-edge-muted border-t px-2 pt-2 text-ink-muted text-xs">
                More spacing
                <NumberField
                  label="Character spacing"
                  unit="pt"
                  value={f().spacing ?? 0}
                  min={-100}
                  max={400}
                  step={0.5}
                  precision={1}
                  width="4.5rem"
                  testId="pptx-char-spacing-custom"
                  onCommit={(v) =>
                    fireAndForget(c.setCharSpacing(v), 'pptx-editor')
                  }
                />
              </div>
            </div>
          )}
        </RibbonPopover>
      </RibbonGroup>
      <RibbonGroup label="Paragraph">
        <RibbonButton
          label="Bullets"
          tooltip="Bullets"
          disabled={!text()}
          active={text() && f().bullet}
          onClick={() => fireAndForget(c.toggleBullets(), 'pptx-editor')}
        >
          <ListBullets />
        </RibbonButton>
        <RibbonPopover
          label="Bullet styles"
          icon={<span class="sr-only">Bullet styles</span>}
          disabled={!text()}
        >
          {(close) => (
            <div class="flex w-48 flex-col">
              <PopoverItem
                label="None"
                onClick={() => {
                  close();
                  fireAndForget(c.setBullets({ kind: 'none' }), 'pptx-editor');
                }}
              />
              <For each={BULLETS}>
                {(b) => (
                  <PopoverItem
                    label={b.label}
                    icon={<span class="text-sm">{b.char}</span>}
                    onClick={() => {
                      close();
                      fireAndForget(
                        c.setBullets({ kind: 'char', char: b.char }),
                        'pptx-editor'
                      );
                    }}
                  />
                )}
              </For>
            </div>
          )}
        </RibbonPopover>
        <RibbonButton
          label="Numbering"
          tooltip="Numbering"
          disabled={!text()}
          onClick={() => fireAndForget(c.toggleNumbering(), 'pptx-editor')}
        >
          <ListNumbers />
        </RibbonButton>
        <RibbonPopover
          label="Numbering styles"
          icon={<span class="sr-only">Numbering styles</span>}
          disabled={!text()}
        >
          {(close) => (
            <div class="flex w-44 flex-col">
              <For each={NUMBERING}>
                {(n) => (
                  <PopoverItem
                    label={n.label}
                    icon={<span class="text-[10px]">{n.sample}</span>}
                    onClick={() => {
                      close();
                      fireAndForget(
                        c.setBullets({
                          kind: 'number',
                          scheme: n.scheme,
                          start: 1,
                        }),
                        'pptx-editor'
                      );
                    }}
                  />
                )}
              </For>
            </div>
          )}
        </RibbonPopover>
        <RibbonButton
          label="Decrease list level"
          tooltip="Decrease list level (⇧Tab)"
          disabled={!text()}
          onClick={() => fireAndForget(c.indent(-1), 'pptx-editor')}
        >
          <TextOutdent />
        </RibbonButton>
        <RibbonButton
          label="Increase list level"
          tooltip="Increase list level (Tab)"
          disabled={!text()}
          onClick={() => fireAndForget(c.indent(1), 'pptx-editor')}
        >
          <TextIndent />
        </RibbonButton>
        <RibbonPopover
          label="Line spacing"
          icon={<ArrowsVertical class="size-3.5" />}
          disabled={!text()}
        >
          {(close) => (
            <div class="flex w-40 flex-col">
              <For each={LINE_SPACINGS}>
                {(n) => (
                  <PopoverItem
                    label={n.toFixed(n % 1 === 0 ? 1 : 2)}
                    onClick={() => {
                      close();
                      fireAndForget(c.lineSpacing(n), 'pptx-editor');
                    }}
                  />
                )}
              </For>
              <PopoverItem
                label="Line spacing options…"
                onClick={() => {
                  close();
                  env.openFormatPane('text');
                }}
              />
            </div>
          )}
        </RibbonPopover>
        <For
          each={
            [
              ['left', 'Align left (⌘L)', TextAlignLeft],
              ['center', 'Center (⌘E)', TextAlignCenter],
              ['right', 'Align right (⌘R)', TextAlignRight],
              ['justify', 'Justify (⌘J)', TextAlignJustify],
            ] as const
          }
        >
          {([value, label, Icon]) => (
            <RibbonButton
              label={label.split(' (')[0]}
              tooltip={label}
              disabled={!text()}
              active={text() && f().align === value}
              onClick={() => fireAndForget(c.align(value), 'pptx-editor')}
            >
              <Icon />
            </RibbonButton>
          )}
        </For>
        <RibbonPopover
          label="Align text"
          icon={<AlignCenterVertical class="size-3.5" />}
          disabled={!text()}
        >
          {(close) => (
            <div class="flex w-36 flex-col">
              <For
                each={
                  [
                    ['top', 'Top', AlignTop],
                    ['middle', 'Middle', AlignCenterVertical],
                    ['bottom', 'Bottom', AlignBottom],
                  ] as const
                }
              >
                {([anchor, label, Icon]) => (
                  <PopoverItem
                    label={label}
                    icon={<Icon />}
                    onClick={() => {
                      close();
                      fireAndForget(c.body({ anchor }), 'pptx-editor');
                    }}
                  />
                )}
              </For>
            </div>
          )}
        </RibbonPopover>
        <TextDirectionMenu
          current={c.textDirection()}
          disabled={!text()}
          testId="pptx-text-direction"
          onPick={(direction) =>
            fireAndForget(c.setTextDirection(direction), 'pptx-editor')
          }
          onMore={() => env.openFormatPane('text')}
        />
      </RibbonGroup>
      <RibbonGroup label="Drawing">
        <RibbonPopover
          label="Shapes"
          icon={<ShapesIcon class="size-3.5" />}
          disabled={ro()}
          testId="pptx-insert-shape"
        >
          {(close) => (
            <ShapeGallery
              load={env.presetPaths}
              onPick={(preset) => {
                close();
                fireAndForget(c.insertShape(preset), 'pptx-editor');
              }}
            />
          )}
        </RibbonPopover>
        <RibbonPopover
          label="Arrange"
          icon={<Stack class="size-3.5" />}
          testId="pptx-arrange"
        >
          {(close) => <ArrangeMenu close={close} />}
        </RibbonPopover>
        <RibbonPopover
          label="Shape fill"
          icon={<PaintBucket class="size-3.5" />}
          disabled={!shapes()}
          testId="pptx-fill"
        >
          {(close) => <FillMenu close={close} />}
        </RibbonPopover>
        <RibbonPopover
          label="Shape outline"
          icon={<PenNib class="size-3.5" />}
          disabled={!shapes()}
          testId="pptx-outline"
        >
          {(close) => <OutlineMenu close={close} />}
        </RibbonPopover>
      </RibbonGroup>
      <RibbonGroup label="Editing">
        <RibbonButton
          label="Find"
          tooltip="Find (⌘F)"
          onClick={() => env.find(false)}
        >
          <MagnifyingGlass />
        </RibbonButton>
        <RibbonTextButton
          label="Replace"
          tooltip="Replace (⌘H)"
          disabled={ro()}
          onClick={() => env.find(true)}
        >
          Replace
        </RibbonTextButton>
        <RibbonButton
          label="Select all"
          tooltip="Select all (⌘A)"
          onClick={() => c.selectAll()}
        >
          <SelectionAll />
        </RibbonButton>
      </RibbonGroup>
    </>
  );
}
