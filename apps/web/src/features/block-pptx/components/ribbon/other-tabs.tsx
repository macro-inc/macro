/**
 * The Design, Slide Show, View, and Shape Format tabs.
 */

import type { TransitionKind } from '@core/pptx-engine/types';
import ArrowDown from '@phosphor/arrow-down.svg';
import ArrowUp from '@phosphor/arrow-up.svg';
import ArrowsOut from '@phosphor/arrows-out.svg';
import EyeSlash from '@phosphor/eye-slash.svg';
import GearSix from '@phosphor/gear-six.svg';
import GridFour from '@phosphor/grid-four.svg';
import MagnifyingGlassMinus from '@phosphor/magnifying-glass-minus.svg';
import MagnifyingGlassPlus from '@phosphor/magnifying-glass-plus.svg';
import Notepad from '@phosphor/notepad.svg';
import PaintBucket from '@phosphor/paint-bucket.svg';
import PenNib from '@phosphor/pen-nib.svg';
import Play from '@phosphor/play.svg';
import Presentation from '@phosphor/presentation.svg';
import ProjectorScreen from '@phosphor/projector-screen.svg';
import Rectangle from '@phosphor/rectangle.svg';
import Ruler from '@phosphor/ruler.svg';
import ShapesIcon from '@phosphor/shapes.svg';
import SquaresFour from '@phosphor/squares-four.svg';
import Stack from '@phosphor/stack.svg';
import { For, Show } from 'solid-js';
import { boxOf } from '../../core/geometry';
import { swatchCss } from '../../core/palette';
import { GRID_SPACINGS } from '../../core/rulers';
import { unionBounds } from '../../core/selection';
import { COLOR_SETS, type ColorSet, FONT_PAIRS } from '../../core/themes';
import {
  ColorPicker,
  NumberField,
  PopoverItem,
  PopoverLabel,
  RibbonButton,
  RibbonGroup,
  RibbonPopover,
  RibbonTextButton,
} from './controls';
import { SlideSizeGroup } from './deck-setup-controls';
import { ShapeEffectsMenu, TextEffectsMenu } from './effects-menu';
import { ArrangeMenu, FillMenu, OutlineMenu } from './home-tab';
import { useRibbon } from './ribbon';
import { ShapeGallery } from './shape-gallery';
import { EditShapeMenu, MergeShapesMenu } from './shape-geometry-menus';

export function DesignTab() {
  const env = useRibbon();
  const ro = () => env.readonly();
  return (
    <>
      <RibbonGroup label="Background">
        <RibbonPopover
          label="Background color"
          text="Background"
          icon={<PaintBucket class="size-3.5" />}
          disabled={ro()}
          testId="pptx-background"
        >
          {(close) => (
            <div class="flex flex-col gap-1">
              <ColorPicker
                themeGrid={env.themeGrid()}
                standard={env.standardColors}
                noneLabel="Reset to layout background"
                onPick={(v) => {
                  close();
                  env.commands.setBackground(
                    v ? { kind: 'solid', color: v } : null
                  );
                }}
              />
            </div>
          )}
        </RibbonPopover>
        <RibbonTextButton
          label="Format background"
          disabled={ro()}
          onClick={() => env.openFormatPane('background')}
        >
          Format background…
        </RibbonTextButton>
      </RibbonGroup>
      <RibbonGroup label="Variants">
        <RibbonPopover
          label="Theme colors"
          text="Colors"
          icon={
            <span class="flex gap-px">
              <For each={accentsOf(env)}>
                {(css) => (
                  <span
                    class="h-3 w-1 rounded-sm"
                    style={{ background: css }}
                  />
                )}
              </For>
            </span>
          }
          disabled={ro()}
          testId="pptx-theme-colors"
        >
          {(close) => (
            <div class="flex max-h-[60vh] w-64 flex-col overflow-y-auto">
              <For each={COLOR_SETS}>
                {(colorSet) => (
                  <button
                    type="button"
                    class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-ink/5"
                    classList={{ 'bg-accent-bg': isCurrentSet(env, colorSet) }}
                    data-testid={`pptx-theme-colors-${colorSet.name}`}
                    onClick={() => {
                      close();
                      void env.commands.setThemeColors(
                        colorSet.colors,
                        colorSet.name
                      );
                    }}
                  >
                    <span class="flex gap-px">
                      <For
                        each={[
                          'dk2',
                          'lt2',
                          'accent1',
                          'accent2',
                          'accent3',
                          'accent4',
                          'accent5',
                          'accent6',
                        ]}
                      >
                        {(slot) => (
                          <span
                            class="size-3 border border-edge-muted"
                            style={{ background: `#${colorSet.colors[slot]}` }}
                          />
                        )}
                      </For>
                    </span>
                    {colorSet.name}
                  </button>
                )}
              </For>
            </div>
          )}
        </RibbonPopover>
        <RibbonPopover
          label="Theme fonts"
          text="Fonts"
          icon={<span class="font-serif text-sm leading-none">Aa</span>}
          disabled={ro()}
          testId="pptx-theme-fonts"
        >
          {(close) => (
            <div class="flex max-h-[60vh] w-64 flex-col overflow-y-auto">
              <For each={FONT_PAIRS}>
                {(pair) => (
                  <button
                    type="button"
                    class="flex flex-col rounded-md px-2 py-1.5 text-left hover:bg-ink/5"
                    classList={{
                      'bg-accent-bg':
                        env.deck()?.themeFonts?.major === pair.major &&
                        env.deck()?.themeFonts?.minor === pair.minor,
                    }}
                    data-testid={`pptx-theme-fonts-${pair.name}`}
                    onClick={() => {
                      close();
                      void env.commands.setThemeFonts(
                        pair.major,
                        pair.minor,
                        pair.name
                      );
                    }}
                  >
                    <span class="text-ink-muted text-xs">{pair.name}</span>
                    <span
                      class="text-base"
                      style={{ 'font-family': `"${pair.major}", serif` }}
                    >
                      {pair.major}
                    </span>
                    <span
                      class="text-xs"
                      style={{ 'font-family': `"${pair.minor}", sans-serif` }}
                    >
                      {pair.minor}
                    </span>
                  </button>
                )}
              </For>
            </div>
          )}
        </RibbonPopover>
      </RibbonGroup>
      <SlideSizeGroup />
    </>
  );
}

/** Whether the deck's accents are exactly `colorSet`'s. */
function isCurrentSet(
  env: ReturnType<typeof useRibbon>,
  colorSet: ColorSet
): boolean {
  const accents = accentsOf(env);
  return (
    accents.length === 6 &&
    accents.every(
      (css, i) =>
        css.replace('#', '').toUpperCase() === colorSet.colors[`accent${i + 1}`]
    )
  );
}

/** The deck's accent colors, for small previews. */
function accentsOf(env: ReturnType<typeof useRibbon>): string[] {
  return (env.deck()?.themeColors ?? [])
    .filter(([slot]) => slot.startsWith('accent'))
    .map(([, css]) => css);
}

export function SlideShowTab() {
  const env = useRibbon();
  return (
    <>
      <RibbonGroup label="Start slide show">
        <RibbonTextButton
          label="From beginning"
          tooltip="From beginning (F5)"
          data-testid="pptx-present-start"
          onClick={() => env.present(false)}
        >
          <Play />
          From beginning
        </RibbonTextButton>
        <RibbonTextButton
          label="From current slide"
          tooltip="From current slide (⇧F5)"
          onClick={() => env.present(true)}
        >
          <ProjectorScreen />
          From current slide
        </RibbonTextButton>
        <RibbonTextButton
          label="Presenter view"
          tooltip="Presenter view: notes, next slide, and timer here; the show in a separate window (⌥F5)"
          data-testid="pptx-present-presenter"
          onClick={() => env.present(true, true)}
        >
          <Presentation />
          Presenter view
        </RibbonTextButton>
      </RibbonGroup>
      <RibbonGroup label="Set up">
        <RibbonTextButton
          label="Hide slide"
          disabled={env.readonly()}
          onClick={() => {
            const s = env.slide();
            if (s) void env.commands.toggleHidden(s);
          }}
        >
          <EyeSlash />
          {env.slide()?.hidden ? 'Unhide slide' : 'Hide slide'}
        </RibbonTextButton>
      </RibbonGroup>
    </>
  );
}

export function ViewTab() {
  const env = useRibbon();
  const view = () => env.view.options();
  const percent = () => {
    const z = env.zoom();
    return z === 'fit' ? undefined : Math.round(z * 100);
  };
  return (
    <>
      <RibbonGroup label="Presentation views">
        <RibbonTextButton
          label="Normal"
          aria-pressed={!env.sorter()}
          variant={env.sorter() ? 'ghost' : 'accent'}
          onClick={() => env.setSorter(false)}
        >
          <Rectangle />
          Normal
        </RibbonTextButton>
        <RibbonTextButton
          label="Slide Sorter"
          aria-pressed={env.sorter()}
          variant={env.sorter() ? 'accent' : 'ghost'}
          data-testid="pptx-tab-view-sorter"
          onClick={() => env.setSorter(true)}
        >
          <SquaresFour />
          Slide Sorter
        </RibbonTextButton>
      </RibbonGroup>
      <RibbonGroup label="Zoom">
        <RibbonButton
          label="Zoom out"
          tooltip="Zoom out (⌘−)"
          onClick={() =>
            env.setZoom(Math.max(0.1, (percent() ?? 100) / 100 / 1.25))
          }
        >
          <MagnifyingGlassMinus />
        </RibbonButton>
        <NumberField
          label="Zoom"
          unit="%"
          value={percent()}
          min={10}
          max={400}
          step={10}
          precision={0}
          onCommit={(v) => env.setZoom(v / 100)}
        />
        <RibbonButton
          label="Zoom in"
          tooltip="Zoom in (⌘+)"
          onClick={() =>
            env.setZoom(Math.min(4, ((percent() ?? 100) / 100) * 1.25))
          }
        >
          <MagnifyingGlassPlus />
        </RibbonButton>
        <RibbonTextButton
          label="Fit to window"
          variant={env.zoom() === 'fit' ? 'accent' : 'ghost'}
          onClick={() => env.setZoom('fit')}
        >
          <ArrowsOut />
          Fit
        </RibbonTextButton>
      </RibbonGroup>
      <RibbonGroup label="Show">
        <RibbonTextButton
          label="Ruler"
          aria-pressed={view().ruler}
          variant={view().ruler ? 'accent' : 'ghost'}
          data-testid="pptx-view-ruler"
          onClick={() => env.view.set({ ruler: !view().ruler })}
        >
          <Ruler />
          Ruler
        </RibbonTextButton>
        <RibbonTextButton
          label="Gridlines"
          aria-pressed={view().gridlines}
          variant={view().gridlines ? 'accent' : 'ghost'}
          data-testid="pptx-view-gridlines"
          onClick={() => env.view.set({ gridlines: !view().gridlines })}
        >
          <GridFour />
          Gridlines
        </RibbonTextButton>
        <RibbonPopover
          label="Grid settings"
          icon={<GearSix />}
          testId="pptx-view-grid-settings"
        >
          {() => (
            <div class="flex w-60 flex-col gap-2 p-1 text-ink text-xs">
              <PopoverLabel>Snap to</PopoverLabel>
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={view().snapToGrid}
                  data-testid="pptx-view-snap-grid"
                  onChange={(e) =>
                    env.view.set({ snapToGrid: e.currentTarget.checked })
                  }
                />
                Snap objects to grid
              </label>
              <PopoverLabel>Grid settings</PopoverLabel>
              <label class="flex items-center justify-between gap-2">
                Spacing
                <select
                  class="h-7 rounded-md border border-edge-muted bg-input px-1 text-ink text-xs"
                  data-testid="pptx-view-grid-spacing"
                  value={String(view().gridSpacing)}
                  onChange={(e) =>
                    env.view.set({
                      gridSpacing: Number(e.currentTarget.value),
                    })
                  }
                >
                  <For each={GRID_SPACINGS}>
                    {(s) => <option value={String(s.value)}>{s.label}</option>}
                  </For>
                </select>
              </label>
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={view().gridlines}
                  onChange={(e) =>
                    env.view.set({ gridlines: e.currentTarget.checked })
                  }
                />
                Display grid on screen
              </label>
              <PopoverLabel>Guide settings</PopoverLabel>
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={view().guides}
                  data-testid="pptx-view-smart-guides"
                  onChange={(e) =>
                    env.view.set({ guides: e.currentTarget.checked })
                  }
                />
                Display smart guides when shapes are aligned
              </label>
            </div>
          )}
        </RibbonPopover>
        <RibbonTextButton
          label="Notes"
          aria-pressed={env.notesVisible()}
          variant={env.notesVisible() ? 'accent' : 'ghost'}
          onClick={env.toggleNotes}
        >
          <Notepad />
          Notes
        </RibbonTextButton>
      </RibbonGroup>
    </>
  );
}

/** Size of the selection: one shape's, or the bounds of several. */
function selectionSize(env: ReturnType<typeof useRibbon>) {
  const shapes = env.selection();
  if (shapes.length === 1) return { w: shapes[0].w, h: shapes[0].h };
  const b = unionBounds(shapes.map(boxOf));
  return b ? { w: b.w, h: b.h } : undefined;
}

export function ShapeFormatTab() {
  const env = useRibbon();
  const c = env.commands;
  const ro = () => env.readonly();
  const one = () =>
    env.selection().length === 1 ? env.selection()[0] : undefined;
  const fillCss = () =>
    swatchCss(one()?.fill?.replace('#', ''), env.deck()?.themeColors ?? []);
  return (
    <>
      <RibbonGroup label="Insert shapes">
        <RibbonPopover
          label="Insert shape"
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
        <EditShapeMenu />
        <MergeShapesMenu />
      </RibbonGroup>
      <RibbonGroup label="Shape styles">
        <ShapeStyles />
        <RibbonPopover
          label="Shape fill"
          icon={
            <span class="flex flex-col items-center">
              <PaintBucket class="size-3.5" />
              <span
                class="-mt-0.5 h-[3px] w-3.5 rounded-sm"
                style={{ background: fillCss() ?? 'transparent' }}
              />
            </span>
          }
          disabled={ro()}
        >
          {(close) => <FillMenu close={close} />}
        </RibbonPopover>
        <RibbonPopover
          label="Shape outline"
          icon={<PenNib class="size-3.5" />}
          disabled={ro()}
        >
          {(close) => <OutlineMenu close={close} />}
        </RibbonPopover>
        <ShapeEffectsMenu label="Shape effects" testId="pptx-shape-effects" />
        <RibbonTextButton
          label="Format pane"
          disabled={ro()}
          onClick={() => env.openFormatPane('shape')}
        >
          Format pane
        </RibbonTextButton>
      </RibbonGroup>
      <RibbonGroup label="WordArt styles">
        <TextEffectsMenu />
      </RibbonGroup>
      <RibbonGroup label="Arrange">
        <RibbonButton
          label="Bring forward"
          tooltip="Bring forward (⌘])"
          disabled={ro()}
          onClick={() => c.arrange('forward')}
        >
          <ArrowUp />
        </RibbonButton>
        <RibbonButton
          label="Send backward"
          tooltip="Send backward (⌘[)"
          disabled={ro()}
          onClick={() => c.arrange('backward')}
        >
          <ArrowDown />
        </RibbonButton>
        <RibbonPopover
          label="Arrange"
          icon={<Stack class="size-3.5" />}
          disabled={ro()}
        >
          {(close) => <ArrangeMenu close={close} />}
        </RibbonPopover>
      </RibbonGroup>
      <RibbonGroup label="Size">
        <NumberField
          label="Shape height"
          unit="pt"
          value={selectionSize(env)?.h}
          min={1}
          max={10000}
          disabled={ro()}
          testId="pptx-shape-height"
          onCommit={(h) => c.resize({ h })}
        />
        <NumberField
          label="Shape width"
          unit="pt"
          value={selectionSize(env)?.w}
          min={1}
          max={10000}
          disabled={ro()}
          testId="pptx-shape-width"
          onCommit={(w) => c.resize({ w })}
        />
      </RibbonGroup>
    </>
  );
}

/**
 * Theme quick styles, as in PowerPoint's Shape Styles gallery: a filled
 * row per accent and an outlined row.
 */
function ShapeStyles() {
  const env = useRibbon();
  const c = env.commands;
  const accents = () =>
    (env.deck()?.themeColors ?? []).filter(([slot]) =>
      /^(dk1|accent\d)$/.test(slot)
    );
  const value = (slot: string) => (slot === 'dk1' ? 'tx1' : slot);
  return (
    <RibbonPopover
      label="Shape styles"
      text="Styles"
      icon={<span class="size-3 rounded-sm bg-accent" />}
      disabled={env.readonly()}
    >
      {(close) => (
        <div class="flex flex-col gap-1.5">
          <div class="px-1 text-ink-muted text-xs">Theme styles</div>
          <For each={['solid', 'outline', 'light'] as const}>
            {(kind) => (
              <div class="flex gap-1 px-1">
                <For each={accents()}>
                  {([slot, css]) => (
                    <button
                      type="button"
                      title={`${kind} ${slot}`}
                      class="flex h-6 w-9 items-center justify-center rounded-sm border-2 font-semibold text-[9px]"
                      style={{
                        background:
                          kind === 'solid'
                            ? css
                            : kind === 'light'
                              ? `color-mix(in srgb, ${css} 20%, white)`
                              : 'white',
                        'border-color': css,
                        color: kind === 'solid' ? 'white' : css,
                      }}
                      onClick={() => {
                        close();
                        const v = value(slot);
                        void c.styleShapes(kind, v);
                      }}
                    >
                      Abc
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      )}
    </RibbonPopover>
  );
}

const TRANSITIONS: { kind: TransitionKind; label: string }[] = [
  { kind: 'none', label: 'None' },
  { kind: 'morph', label: 'Morph' },
  { kind: 'fade', label: 'Fade' },
  { kind: 'push', label: 'Push' },
  { kind: 'wipe', label: 'Wipe' },
  { kind: 'split', label: 'Split' },
  { kind: 'reveal', label: 'Reveal' },
  { kind: 'cut', label: 'Cut' },
  { kind: 'randomBar', label: 'Random bars' },
  { kind: 'shape', label: 'Shape' },
  { kind: 'uncover', label: 'Uncover' },
  { kind: 'cover', label: 'Cover' },
  { kind: 'zoom', label: 'Zoom' },
  { kind: 'flash', label: 'Flash' },
  { kind: 'dissolve', label: 'Dissolve' },
];

/** Effect options per transition, as PowerPoint names them. */
const EFFECT_OPTIONS: Partial<Record<TransitionKind, [string, string][]>> = {
  fade: [
    ['smooth', 'Smoothly'],
    ['black', 'Through black'],
  ],
  push: [
    ['u', 'From bottom'],
    ['l', 'From right'],
    ['d', 'From top'],
    ['r', 'From left'],
  ],
  wipe: [
    ['l', 'From right'],
    ['u', 'From bottom'],
    ['r', 'From left'],
    ['d', 'From top'],
  ],
  cover: [
    ['l', 'From right'],
    ['u', 'From bottom'],
    ['r', 'From left'],
    ['d', 'From top'],
    ['lu', 'From bottom-right'],
    ['ru', 'From bottom-left'],
    ['ld', 'From top-right'],
    ['rd', 'From top-left'],
  ],
  uncover: [
    ['l', 'To left'],
    ['u', 'To top'],
    ['r', 'To right'],
    ['d', 'To bottom'],
  ],
  split: [
    ['vertOut', 'Vertical out'],
    ['vertIn', 'Vertical in'],
    ['horzOut', 'Horizontal out'],
    ['horzIn', 'Horizontal in'],
  ],
  reveal: [
    ['l', 'From right'],
    ['r', 'From left'],
  ],
  randomBar: [
    ['vert', 'Vertical'],
    ['horz', 'Horizontal'],
  ],
  shape: [
    ['circle', 'Circle'],
    ['diamond', 'Diamond'],
    ['plus', 'Plus'],
  ],
  zoom: [
    ['in', 'In'],
    ['out', 'Out'],
  ],
  morph: [
    ['byObject', 'Objects'],
    ['byWord', 'Words'],
    ['byChar', 'Characters'],
  ],
};

/** A thumbnail of how a transition moves. */
function TransitionIcon(props: { kind: TransitionKind }) {
  const k = () => props.kind;
  return (
    <svg viewBox="0 0 24 16" class="h-4 w-6">
      <rect
        x="0.5"
        y="0.5"
        width="23"
        height="15"
        rx="1.5"
        class="fill-none stroke-current/40"
      />
      <Show when={k() === 'fade' || k() === 'dissolve' || k() === 'flash'}>
        <rect
          x="3"
          y="3"
          width="18"
          height="10"
          rx="1"
          class="fill-current/30"
        />
      </Show>
      <Show
        when={
          k() === 'push' ||
          k() === 'cover' ||
          k() === 'uncover' ||
          k() === 'reveal'
        }
      >
        <rect
          x="9"
          y="3"
          width="12"
          height="10"
          rx="1"
          class="fill-current/40"
        />
        <path
          d="M4 8h4M6 6l2 2-2 2"
          class="fill-none stroke-current"
          stroke-width="1.2"
        />
      </Show>
      <Show when={k() === 'wipe' || k() === 'randomBar'}>
        <rect x="3" y="3" width="9" height="10" class="fill-current/40" />
        <path d="M12 3v10" class="stroke-current" stroke-width="1.2" />
      </Show>
      <Show when={k() === 'split'}>
        <path
          d="M12 3v10M8 8H4M16 8h4"
          class="fill-none stroke-current"
          stroke-width="1.2"
        />
      </Show>
      <Show when={k() === 'shape' || k() === 'zoom'}>
        <circle
          cx="12"
          cy="8"
          r="4"
          class="fill-current/40 stroke-current"
          stroke-width="1"
        />
      </Show>
      <Show when={k() === 'morph'}>
        <path
          d="M5 11 Q12 1 19 11"
          class="fill-none stroke-current"
          stroke-width="1.2"
        />
      </Show>
      <Show when={k() === 'cut'}>
        <path d="M12 2v12" class="stroke-current" stroke-width="1.5" />
      </Show>
    </svg>
  );
}

export function TransitionsTab() {
  const env = useRibbon();
  const c = env.commands;
  const ro = () => env.readonly();
  const current = () => env.slide()?.transition;
  const kind = () => (current()?.kind ?? 'none') as TransitionKind;
  const options = () => EFFECT_OPTIONS[kind()];
  return (
    <>
      <RibbonGroup label="Transition to this slide">
        <div class="flex items-center gap-0.5" data-testid="pptx-transitions">
          <For each={TRANSITIONS}>
            {(t) => (
              <button
                type="button"
                title={t.label}
                aria-pressed={kind() === t.kind}
                data-testid={`pptx-transition-${t.kind}`}
                disabled={ro()}
                class="flex h-8 w-12 flex-col items-center justify-center rounded-md text-[9px] leading-tight hover:bg-ink/5 disabled:opacity-50"
                classList={{ 'bg-accent-bg text-accent': kind() === t.kind }}
                onClick={() => void c.setTransition({ kind: t.kind })}
              >
                <TransitionIcon kind={t.kind} />
                {t.label}
              </button>
            )}
          </For>
        </div>
        <Show when={options()}>
          {(list) => (
            <RibbonPopover
              label="Effect options"
              text="Effect options"
              icon={<span class="sr-only">Effect options</span>}
              disabled={ro()}
            >
              {(close) => (
                <div class="flex w-44 flex-col">
                  <For each={list()}>
                    {([direction, label]) => (
                      <PopoverItem
                        label={label}
                        active={current()?.direction === direction}
                        onClick={() => {
                          close();
                          void c.setTransition({ kind: kind(), direction });
                        }}
                      />
                    )}
                  </For>
                </div>
              )}
            </RibbonPopover>
          )}
        </Show>
      </RibbonGroup>
      <RibbonGroup label="Timing">
        <span class="px-1 text-ink-muted text-xs">Duration</span>
        <NumberField
          label="Duration (seconds)"
          unit="s"
          value={(current()?.durationMs ?? 0) / 1000 || undefined}
          min={0.01}
          max={59.99}
          step={0.25}
          precision={2}
          disabled={ro() || kind() === 'none'}
          testId="pptx-transition-duration"
          onCommit={(s) =>
            void c.setTransition({
              kind: kind(),
              durationMs: Math.round(s * 1000),
            })
          }
        />
        <label class="flex items-center gap-1 px-1 text-xs">
          <input
            type="checkbox"
            class="accent-accent"
            disabled={ro()}
            checked={current()?.advanceOnClick ?? true}
            onChange={(e) =>
              void c.setTransition({
                kind: kind(),
                advanceOnClick: e.currentTarget.checked,
              })
            }
          />
          On click
        </label>
        <label class="flex items-center gap-1 px-1 text-xs">
          <input
            type="checkbox"
            class="accent-accent"
            disabled={ro()}
            checked={current()?.advanceAfterMs !== undefined}
            onChange={(e) =>
              void c.setTransition({
                kind: kind(),
                advanceAfterMs: e.currentTarget.checked ? 5000 : 0,
              })
            }
          />
          After
        </label>
        <NumberField
          label="Advance after (seconds)"
          unit="s"
          value={
            current()?.advanceAfterMs !== undefined
              ? current()!.advanceAfterMs! / 1000
              : undefined
          }
          min={0}
          max={3600}
          precision={2}
          disabled={ro() || current()?.advanceAfterMs === undefined}
          onCommit={(s) =>
            void c.setTransition({
              kind: kind(),
              advanceAfterMs: Math.round(s * 1000),
            })
          }
        />
        <RibbonTextButton
          label="Apply to all"
          disabled={ro()}
          data-testid="pptx-transition-all"
          onClick={() =>
            void c.setTransition({ kind: kind(), applyToAll: true })
          }
        >
          Apply to all
        </RibbonTextButton>
      </RibbonGroup>
    </>
  );
}
