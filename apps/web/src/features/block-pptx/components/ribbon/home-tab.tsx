/**
 * The Home tab: clipboard, slides, font, paragraph, drawing, and editing.
 */

import AlignBottom from '@phosphor/align-bottom.svg';
import AlignCenterHorizontal from '@phosphor/align-center-horizontal.svg';
import AlignCenterVertical from '@phosphor/align-center-vertical.svg';
import AlignLeft from '@phosphor/align-left.svg';
import AlignRight from '@phosphor/align-right.svg';
import AlignTop from '@phosphor/align-top.svg';
import ArrowClockwise from '@phosphor/arrow-clockwise.svg';
import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import ArrowDown from '@phosphor/arrow-down.svg';
import ArrowLineDown from '@phosphor/arrow-line-down.svg';
import ArrowLineUp from '@phosphor/arrow-line-up.svg';
import ArrowUp from '@phosphor/arrow-up.svg';
import ArrowsVertical from '@phosphor/arrows-vertical.svg';
import ClipboardIcon from '@phosphor/clipboard.svg';
import CopyIcon from '@phosphor/copy.svg';
import CopySimple from '@phosphor/copy-simple.svg';
import Eraser from '@phosphor/eraser.svg';
import FlipHorizontal from '@phosphor/flip-horizontal.svg';
import FlipVertical from '@phosphor/flip-vertical.svg';
import Highlighter from '@phosphor/highlighter.svg';
import ListBullets from '@phosphor/list-bullets.svg';
import ListNumbers from '@phosphor/list-numbers.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import PaintBrush from '@phosphor/paint-brush.svg';
import PaintBucket from '@phosphor/paint-bucket.svg';
import PenNib from '@phosphor/pen-nib.svg';
import Plus from '@phosphor/plus.svg';
import Scissors from '@phosphor/scissors.svg';
import SelectionAll from '@phosphor/selection-all.svg';
import ShapesIcon from '@phosphor/shapes.svg';
import Stack from '@phosphor/stack.svg';
import TextAa from '@phosphor/text-aa.svg';
import TextAlignCenter from '@phosphor/text-align-center.svg';
import TextAlignJustify from '@phosphor/text-align-justify.svg';
import TextAlignLeft from '@phosphor/text-align-left.svg';
import TextAlignRight from '@phosphor/text-align-right.svg';
import TextB from '@phosphor/text-b.svg';
import TextIndent from '@phosphor/text-indent.svg';
import TextItalic from '@phosphor/text-italic.svg';
import TextOutdent from '@phosphor/text-outdent.svg';
import TextStrikethrough from '@phosphor/text-strikethrough.svg';
import TextSubscript from '@phosphor/text-subscript.svg';
import TextSuperscript from '@phosphor/text-superscript.svg';
import TextUnderline from '@phosphor/text-underline.svg';
import Trash from '@phosphor/trash.svg';
import { For, type JSX, Show } from 'solid-js';
import { swatchCss } from '../../core/palette';
import type { AlignMode } from '../../core/selection';
import {
  ColorBarIcon,
  ColorPicker,
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
      <PopoverLabel>Order objects</PopoverLabel>
      <PopoverItem
        label="Bring to front"
        icon={<ArrowLineUp />}
        hint="⇧⌘]"
        onClick={run(() => c.arrange('front'))}
      />
      <PopoverItem
        label="Send to back"
        icon={<ArrowLineDown />}
        hint="⇧⌘["
        onClick={run(() => c.arrange('back'))}
      />
      <PopoverItem
        label="Bring forward"
        icon={<ArrowUp />}
        hint="⌘]"
        onClick={run(() => c.arrange('forward'))}
      />
      <PopoverItem
        label="Send backward"
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
                : false
            }
            onClick={run(() => c.alignShapes(item.mode))}
          />
        )}
      </For>
      <PopoverLabel>Rotate</PopoverLabel>
      <PopoverItem
        label="Rotate right 90°"
        icon={<ArrowClockwise />}
        onClick={run(() => c.rotate('right90'))}
      />
      <PopoverItem
        label="Rotate left 90°"
        icon={<ArrowCounterClockwise />}
        onClick={run(() => c.rotate('left90'))}
      />
      <PopoverItem
        label="Flip vertical"
        icon={<FlipVertical />}
        onClick={run(() => c.rotate('flipV'))}
      />
      <PopoverItem
        label="Flip horizontal"
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
          run(() => void c.setLine(v ? { color: v } : { none: true }))
        }
      />
      <PopoverLabel>Weight</PopoverLabel>
      <div class="grid grid-cols-4 gap-0.5">
        <For each={[0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6]}>
          {(w) => (
            <button
              type="button"
              class="flex h-6 items-center gap-1 rounded-md px-1 text-xs hover:bg-ink/5"
              onClick={() => run(() => void c.setLine({ width: w }))}
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
              onClick={() => run(() => void c.setLine({ dash }))}
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
              onClick={() => run(() => void c.setLine({ head, tail }))}
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
          void env.commands.fillColor(v);
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
          onClick={() =>
            env.formatPainter.active()
              ? env.formatPainter.cancel()
              : void env.formatPainter.arm(false)
          }
          onDblClick={() => void env.formatPainter.arm(true)}
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
          onClick={() => void c.addSlide()}
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
                      void c.addSlide(layout.name);
                    }}
                  />
                )}
              </For>
            </div>
          )}
        </RibbonPopover>
        <>
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
                        void c.setLayout(layout.name);
                      }}
                    />
                  )}
                </For>
              </div>
            )}
          </RibbonPopover>
        </>
        <SectionMenu />
        <RibbonButton
          label="Duplicate slide"
          tooltip="Duplicate slide"
          disabled={ro()}
          onClick={() => void c.duplicateSlide()}
        >
          <CopySimple />
        </RibbonButton>
        <RibbonButton
          label="Delete slide"
          tooltip="Delete slide"
          disabled={ro() || (env.deck()?.slides.length ?? 0) <= 1}
          onClick={() => {
            const s = env.slide();
            if (s) void c.deleteSlides([s.id]);
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
          onPick={(font) => void c.setFont(font)}
        />
        <FontSizePicker
          value={text() ? f().size : undefined}
          disabled={!text()}
          onPick={(size) => void c.setFontSize(size)}
        />
        <RibbonButton
          label="Increase font size"
          tooltip="Increase font size (⇧⌘>)"
          disabled={!text()}
          onClick={() => void c.stepSize(1)}
        >
          <span class="font-semibold text-[13px] leading-none">
            A<sup>+</sup>
          </span>
        </RibbonButton>
        <RibbonButton
          label="Decrease font size"
          tooltip="Decrease font size (⇧⌘<)"
          disabled={!text()}
          onClick={() => void c.stepSize(-1)}
        >
          <span class="font-semibold text-[11px] leading-none">
            A<sup>−</sup>
          </span>
        </RibbonButton>
        <RibbonButton
          label="Clear formatting"
          tooltip="Clear all formatting"
          disabled={!text()}
          onClick={() => void c.clearFormatting()}
        >
          <Eraser />
        </RibbonButton>
        <RibbonButton
          label="Bold"
          tooltip="Bold (⌘B)"
          data-testid="pptx-bold"
          disabled={!text()}
          active={text() && f().bold}
          onClick={() => void c.toggle('bold')}
        >
          <TextB />
        </RibbonButton>
        <RibbonButton
          label="Italic"
          tooltip="Italic (⌘I)"
          disabled={!text()}
          active={text() && f().italic}
          onClick={() => void c.toggle('italic')}
        >
          <TextItalic />
        </RibbonButton>
        <RibbonButton
          label="Underline"
          tooltip="Underline (⌘U)"
          disabled={!text()}
          active={text() && f().underline}
          onClick={() => void c.toggle('underline')}
        >
          <TextUnderline />
        </RibbonButton>
        <RibbonButton
          label="Strikethrough"
          tooltip="Strikethrough"
          disabled={!text()}
          active={text() && f().strike}
          onClick={() => void c.toggle('strike')}
        >
          <TextStrikethrough />
        </RibbonButton>
        <RibbonButton
          label="Superscript"
          tooltip="Superscript (⇧⌘=)"
          disabled={!text()}
          active={text() && (f().baseline ?? 0) > 0}
          onClick={() => void c.toggleBaseline('super')}
        >
          <TextSuperscript />
        </RibbonButton>
        <RibbonButton
          label="Subscript"
          tooltip="Subscript (⌘=)"
          disabled={!text()}
          active={text() && (f().baseline ?? 0) < 0}
          onClick={() => void c.toggleBaseline('sub')}
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
                void c.setHighlight(v);
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
                if (v) void c.setTextColor(v);
              }}
            />
          )}
        </RibbonPopover>
      </RibbonGroup>
      <RibbonGroup label="Paragraph">
        <RibbonButton
          label="Bullets"
          tooltip="Bullets"
          disabled={!text()}
          active={text() && f().bullet}
          onClick={() => void c.toggleBullets()}
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
                  void c.setBullets({ kind: 'none' });
                }}
              />
              <For each={BULLETS}>
                {(b) => (
                  <PopoverItem
                    label={b.label}
                    icon={<span class="text-sm">{b.char}</span>}
                    onClick={() => {
                      close();
                      void c.setBullets({ kind: 'char', char: b.char });
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
          onClick={() => void c.toggleNumbering()}
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
                      void c.setBullets({
                        kind: 'number',
                        scheme: n.scheme,
                        start: 1,
                      });
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
          onClick={() => void c.indent(-1)}
        >
          <TextOutdent />
        </RibbonButton>
        <RibbonButton
          label="Increase list level"
          tooltip="Increase list level (Tab)"
          disabled={!text()}
          onClick={() => void c.indent(1)}
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
                      void c.lineSpacing(n);
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
              onClick={() => void c.align(value)}
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
                      void c.body({ anchor });
                    }}
                  />
                )}
              </For>
            </div>
          )}
        </RibbonPopover>
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
                void c.insertShape(preset);
              }}
            />
          )}
        </RibbonPopover>
        <RibbonPopover
          label="Arrange"
          icon={<Stack class="size-3.5" />}
          disabled={!shapes()}
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
