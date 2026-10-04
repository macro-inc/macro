/**
 * The Design, Slide Show, View, and Shape Format tabs.
 */

import ArrowDown from '@phosphor/arrow-down.svg';
import ArrowUp from '@phosphor/arrow-up.svg';
import ArrowsOut from '@phosphor/arrows-out.svg';
import EyeSlash from '@phosphor/eye-slash.svg';
import MagnifyingGlassMinus from '@phosphor/magnifying-glass-minus.svg';
import MagnifyingGlassPlus from '@phosphor/magnifying-glass-plus.svg';
import Notepad from '@phosphor/notepad.svg';
import PaintBucket from '@phosphor/paint-bucket.svg';
import PenNib from '@phosphor/pen-nib.svg';
import Play from '@phosphor/play.svg';
import ProjectorScreen from '@phosphor/projector-screen.svg';
import ShapesIcon from '@phosphor/shapes.svg';
import Stack from '@phosphor/stack.svg';
import { For } from 'solid-js';
import { boxOf } from '../../core/geometry';
import { swatchCss } from '../../core/palette';
import { unionBounds } from '../../core/selection';
import {
  ColorPicker,
  NumberField,
  RibbonButton,
  RibbonGroup,
  RibbonPopover,
  RibbonTextButton,
} from './controls';
import { ArrangeMenu, FillMenu, OutlineMenu } from './home-tab';
import { useRibbon } from './ribbon';
import { ShapeGallery } from './shape-gallery';

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
      <RibbonGroup label="Theme colors">
        <div class="flex items-center gap-0.5 px-1" title="Theme colors">
          <For
            each={(env.deck()?.themeColors ?? []).filter(([s]) =>
              s.startsWith('accent')
            )}
          >
            {([slot, css]) => (
              <span
                title={slot}
                class="size-4 rounded-sm border border-edge-muted"
                style={{ background: css }}
              />
            )}
          </For>
        </div>
      </RibbonGroup>
    </>
  );
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
  const percent = () => {
    const z = env.zoom();
    return z === 'fit' ? undefined : Math.round(z * 100);
  };
  return (
    <>
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
        <RibbonPopover
          label="Change shape"
          text="Change shape"
          icon={<span class="sr-only">Change shape</span>}
          disabled={ro() || !env.selection().some((s) => s.geometry)}
        >
          {(close) => (
            <ShapeGallery
              load={env.presetPaths}
              categories={[
                'Rectangles',
                'Basic shapes',
                'Block arrows',
                'Flowchart',
                'Stars and banners',
                'Callouts',
              ]}
              onPick={(preset) => {
                close();
                void c.setGeometry(preset);
              }}
            />
          )}
        </RibbonPopover>
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
        <RibbonTextButton
          label="Format pane"
          disabled={ro()}
          onClick={() => env.openFormatPane('shape')}
        >
          Format pane
        </RibbonTextButton>
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
