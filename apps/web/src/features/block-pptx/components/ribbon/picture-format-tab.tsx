/**
 * The Picture Format contextual tab, shown while pictures are selected:
 * Corrections, Color, and Transparency galleries previewing the picture
 * itself, Change and Reset Picture, Picture Border and Effects, Arrange,
 * and Crop (crop mode, Crop to Shape, Aspect Ratio, Fill, Fit) with the
 * picture's size.
 */

import type { PictureRecolor, ShapeOutline } from '@core/pptx-engine/types';
import { Popover } from '@kobalte/core/popover';
import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import ArrowDown from '@phosphor/arrow-down.svg';
import ArrowUp from '@phosphor/arrow-up.svg';
import CaretDown from '@phosphor/caret-down.svg';
import Checkerboard from '@phosphor/checkerboard.svg';
import CropIcon from '@phosphor/crop.svg';
import ImagesIcon from '@phosphor/images.svg';
import Palette from '@phosphor/palette.svg';
import PenNib from '@phosphor/pen-nib.svg';
import Stack from '@phosphor/stack.svg';
import Sun from '@phosphor/sun.svg';
import { cn } from '@ui';
import { Button } from '@ui/components/Button';
import { createSignal, For, type JSX, onMount, Show } from 'solid-js';
import {
  ASPECT_RATIOS,
  CORRECTION_STEPS,
  correctionKey,
  lookOf,
  NO_CROP,
  type PictureLook,
  RECOLOR_ROWS,
  recolorKey,
  resolveRecolor,
  signedPercent,
  TRANSPARENCY_STEPS,
} from '../../core/picture';
import type { CropMode } from '../../primitives/create-crop-mode';
import type { PictureImages } from '../../primitives/create-picture-images';
import { CHECKERBOARD, PicturePreview } from '../picture-preview';
import {
  ColorPicker,
  NumberField,
  PopoverItem,
  RibbonButton,
  RibbonGroup,
  RibbonPopover,
  RibbonTextButton,
} from './controls';
import {
  FlyoutMenu,
  GalleryHeading,
  GalleryTile,
  ShapeEffectsMenu,
} from './effects-menu';
import { ArrangeMenu, OutlineMenu } from './home-tab';
import { useRibbon } from './ribbon';
import { ShapeGallery } from './shape-gallery';

/** The picture galleries preview: the first selected one. */
function usePicture() {
  const env = useRibbon();
  return () => env.selection().find((s) => s.kind === 'picture');
}

/** Loads a picture's original image once the gallery showing it opens. */
function useImage(
  images: PictureImages,
  shape: () => ShapeOutline | undefined
) {
  const [image, setImage] = createSignal<HTMLImageElement | null>();
  const load = async () => {
    const s = shape();
    setImage(s ? ((await images.load(s.id))?.image ?? null) : null);
  };
  onMount(() => void load());
  return image;
}

/** A tile previewing the picture with a look. */
function PictureTile(props: {
  picture: ShapeOutline;
  image: HTMLImageElement | null | undefined;
  look: PictureLook;
  label: string;
  testId: string;
  active: boolean;
  size: number;
  checker?: boolean;
  onClick: () => void;
}) {
  return (
    <GalleryTile
      label={props.label}
      testId={props.testId}
      active={props.active}
      size={props.size}
      onClick={props.onClick}
    >
      <PicturePreview
        image={props.image}
        crop={props.picture.picture?.crop ?? NO_CROP}
        look={props.look}
        aspect={props.picture.w / Math.max(1, props.picture.h)}
        width={props.size - 6}
        height={props.size - 6}
        style={props.checker ? CHECKERBOARD : undefined}
      />
    </GalleryTile>
  );
}

const near = (a: number | undefined, b: number) =>
  Math.abs((a ?? 0) - b) < 0.005;

/** Corrections: PowerPoint's 5 × 5 Brightness/Contrast grid. */
function CorrectionsGallery(props: {
  picture: ShapeOutline;
  images: PictureImages;
  close: () => void;
}) {
  const env = useRibbon();
  const image = useImage(props.images, () => props.picture);
  const look = (brightness: number, contrast: number): PictureLook => ({
    ...lookOf(props.picture.picture, env.deck()?.themeColors ?? []),
    brightness,
    contrast,
    transparency: 0,
  });
  return (
    <div class="flex flex-col" data-testid="pptx-picture-corrections-gallery">
      <GalleryHeading>Brightness/Contrast</GalleryHeading>
      <div class="grid grid-cols-5 gap-1">
        <For each={CORRECTION_STEPS}>
          {(contrast) => (
            <For each={CORRECTION_STEPS}>
              {(brightness) => (
                <PictureTile
                  picture={props.picture}
                  image={image()}
                  look={look(brightness, contrast)}
                  size={64}
                  label={`Brightness: ${signedPercent(brightness)}${brightness === 0 ? ' (Normal)' : ''} Contrast: ${signedPercent(contrast)}${contrast === 0 ? ' (Normal)' : ''}`}
                  testId={`pptx-picture-correction-${correctionKey(brightness, contrast)}`}
                  active={
                    near(props.picture.picture?.brightness, brightness) &&
                    near(props.picture.picture?.contrast, contrast)
                  }
                  onClick={() => {
                    props.close();
                    void env.commands.formatPicture({ brightness, contrast });
                  }}
                />
              )}
            </For>
          )}
        </For>
      </div>
      <div class="mt-1.5 flex flex-col border-edge-muted border-t pt-1">
        <PopoverItem
          label="Reset Corrections"
          testId="pptx-picture-corrections-reset"
          icon={<ArrowCounterClockwise />}
          onClick={() => {
            props.close();
            void env.commands.formatPicture({ brightness: 0, contrast: 0 });
          }}
        />
        <PopoverItem
          label="Picture Corrections Options…"
          onClick={() => {
            props.close();
            env.openFormatPane('picture');
          }}
        />
      </div>
    </div>
  );
}

/** Color: the Recolor gallery (presets, dark and light variations). */
function ColorGallery(props: {
  picture: ShapeOutline;
  images: PictureImages;
  close: () => void;
}) {
  const env = useRibbon();
  const image = useImage(props.images, () => props.picture);
  const [more, setMore] = createSignal(false);
  const theme = () => env.deck()?.themeColors ?? [];
  const look = (recolor: PictureRecolor): PictureLook => ({
    ...lookOf(props.picture.picture, theme()),
    recolor: resolveRecolor(recolor, theme()),
    transparency: 0,
  });
  const pick = (recolor: PictureRecolor) => {
    props.close();
    void env.commands.formatPicture({ recolor });
  };
  return (
    <div class="flex flex-col" data-testid="pptx-picture-color-gallery">
      <For each={RECOLOR_ROWS}>
        {(row, i) => (
          <>
            <Show when={i() === 0}>
              <GalleryHeading>Recolor</GalleryHeading>
            </Show>
            <div class="mb-1 grid grid-cols-7 gap-1">
              <For each={row.presets}>
                {(preset) => (
                  <PictureTile
                    picture={props.picture}
                    image={image()}
                    look={look(preset.value)}
                    size={52}
                    label={preset.label}
                    testId={`pptx-picture-recolor-${recolorKey(preset.value)}`}
                    active={
                      (props.picture.picture?.recolor ?? 'none') ===
                      preset.value
                    }
                    onClick={() => pick(preset.value)}
                  />
                )}
              </For>
            </div>
          </>
        )}
      </For>
      <div class="mt-0.5 flex flex-col border-edge-muted border-t pt-1">
        <PopoverItem
          label="More Variations"
          hint="›"
          active={more()}
          icon={
            <span class="block size-3.5 rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]" />
          }
          testId="pptx-picture-recolor-more"
          onClick={() => setMore((m) => !m)}
        />
        <Show when={more()}>
          <div class="px-1 pb-1">
            <ColorPicker
              themeGrid={env.themeGrid()}
              standard={env.standardColors}
              onPick={(v) => v && pick(`duotone:${v}`)}
            />
          </div>
        </Show>
        <PopoverItem
          label="Picture Color Options…"
          onClick={() => {
            props.close();
            env.openFormatPane('picture');
          }}
        />
      </div>
    </div>
  );
}

/** Transparency: 0% to 95%, previewed over a checkerboard. */
function TransparencyGallery(props: {
  picture: ShapeOutline;
  images: PictureImages;
  close: () => void;
}) {
  const env = useRibbon();
  const image = useImage(props.images, () => props.picture);
  return (
    <div class="flex flex-col" data-testid="pptx-picture-transparency-gallery">
      <div class="grid grid-cols-7 gap-1">
        <For each={TRANSPARENCY_STEPS}>
          {(transparency) => (
            <PictureTile
              picture={props.picture}
              image={image()}
              look={{
                ...lookOf(props.picture.picture, env.deck()?.themeColors ?? []),
                transparency,
              }}
              size={56}
              checker
              label={`Transparency: ${Math.round(transparency * 100)}%`}
              testId={`pptx-picture-transparency-${Math.round(transparency * 100)}`}
              active={near(props.picture.picture?.transparency, transparency)}
              onClick={() => {
                props.close();
                void env.commands.formatPicture({ transparency });
              }}
            />
          )}
        </For>
      </div>
      <div class="mt-1.5 border-edge-muted border-t pt-1">
        <PopoverItem
          label="Picture Transparency Options…"
          onClick={() => {
            props.close();
            env.openFormatPane('picture');
          }}
        />
      </div>
    </div>
  );
}

/** A gallery button that opens with the selected picture. */
function PictureGalleryMenu(props: {
  label: string;
  text: string;
  icon: JSX.Element;
  testId: string;
  children: (picture: ShapeOutline, close: () => void) => JSX.Element;
}) {
  const env = useRibbon();
  const picture = usePicture();
  return (
    <RibbonPopover
      label={props.label}
      text={props.text}
      icon={props.icon}
      testId={props.testId}
      disabled={env.readonly() || !picture()}
    >
      {(close) => (
        <Show when={picture()}>{(p) => props.children(p(), close)}</Show>
      )}
    </RibbonPopover>
  );
}

/**
 * The Crop split button: the upper part toggles crop mode, the arrow opens
 * Crop to Shape, Aspect Ratio, Fill, and Fit.
 */
function CropButton(props: { crop: CropMode }) {
  const env = useRibbon();
  const c = env.commands;
  const [open, setOpen] = createSignal(false);
  const disabled = () =>
    env.readonly() || !env.selection().some((s) => s.kind === 'picture');
  const run = (fn: () => unknown) => () => {
    setOpen(false);
    fn();
  };
  const aspect = (w: number, h: number) =>
    run(async () => {
      await c.cropToAspect(w / h);
      await props.crop.enter();
    });
  return (
    <div
      class="flex h-7 items-center rounded-md"
      classList={{ 'bg-accent-bg text-accent': props.crop.active() }}
      data-pptx-crop-toggle
    >
      <Button
        variant="ghost"
        size="sm"
        square
        class={cn(
          'h-7 gap-1 rounded-r-none rounded-l-md px-1.5 text-xs',
          props.crop.active() && 'text-accent'
        )}
        label="Crop"
        tooltip="Crop: drag the black handles; Enter or Esc finishes"
        aria-pressed={props.crop.active()}
        disabled={disabled()}
        data-testid="pptx-picture-crop"
        onClick={() => void props.crop.toggle()}
      >
        <CropIcon class="size-3.5" />
        <span>Crop</span>
      </Button>
      <Popover
        open={open()}
        onOpenChange={setOpen}
        placement="bottom-start"
        gutter={4}
      >
        <Popover.Trigger
          as={Button}
          variant="ghost"
          size="sm"
          square
          class="h-7 rounded-r-md rounded-l-none px-0.5"
          label="Crop options"
          tooltip="Crop to shape, aspect ratio, fill, or fit"
          disabled={disabled()}
          data-testid="pptx-picture-crop-menu"
        >
          <CaretDown class="size-2.5 opacity-60" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            class="z-action-menu rounded-xl border border-edge bg-menu p-2 text-ink text-xs shadow-xl outline-none"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <div class="flex w-44 flex-col">
              <PopoverItem
                label="Crop"
                icon={<CropIcon />}
                testId="pptx-crop-start"
                onClick={run(() => void props.crop.enter())}
              />
              <FlyoutMenu
                items={[
                  {
                    id: 'shape',
                    label: 'Crop to Shape',
                    testId: 'pptx-crop-to-shape',
                    content: () => (
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
                          setOpen(false);
                          void c.setGeometry(preset);
                        }}
                      />
                    ),
                  },
                  {
                    id: 'aspect',
                    label: 'Aspect Ratio',
                    testId: 'pptx-crop-aspect',
                    content: () => (
                      <div class="flex w-32 flex-col">
                        <For each={ASPECT_RATIOS}>
                          {(group) => (
                            <>
                              <GalleryHeading>{group.group}</GalleryHeading>
                              <For each={group.ratios}>
                                {(r) => (
                                  <PopoverItem
                                    label={r.label}
                                    testId={`pptx-crop-aspect-${r.w}x${r.h}`}
                                    onClick={aspect(r.w, r.h)}
                                  />
                                )}
                              </For>
                            </>
                          )}
                        </For>
                      </div>
                    ),
                  },
                ]}
              />
              <PopoverItem
                label="Fill"
                testId="pptx-crop-fill"
                onClick={run(() => void c.fitPictures('fill'))}
              />
              <PopoverItem
                label="Fit"
                testId="pptx-crop-fit"
                onClick={run(() => void c.fitPictures('fit'))}
              />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    </div>
  );
}

export function PictureFormatTab(props: {
  images: PictureImages;
  crop: CropMode;
  /** Opens the file picker for Change Picture. */
  onChangePicture: () => void;
}) {
  const env = useRibbon();
  const c = env.commands;
  const ro = () => env.readonly();
  const one = () =>
    env.selection().length === 1 ? env.selection()[0] : undefined;
  const size = () => {
    const s = one();
    return s ? { w: s.w, h: s.h } : undefined;
  };
  return (
    <>
      <RibbonGroup label="Adjust">
        <PictureGalleryMenu
          label="Corrections: brightness and contrast"
          text="Corrections"
          icon={<Sun class="size-3.5" />}
          testId="pptx-picture-corrections"
        >
          {(p, close) => (
            <CorrectionsGallery
              picture={p}
              images={props.images}
              close={close}
            />
          )}
        </PictureGalleryMenu>
        <PictureGalleryMenu
          label="Color: recolor the picture"
          text="Color"
          icon={<Palette class="size-3.5" />}
          testId="pptx-picture-color"
        >
          {(p, close) => (
            <ColorGallery picture={p} images={props.images} close={close} />
          )}
        </PictureGalleryMenu>
        <PictureGalleryMenu
          label="Transparency"
          text="Transparency"
          icon={<Checkerboard class="size-3.5" />}
          testId="pptx-picture-transparency"
        >
          {(p, close) => (
            <TransparencyGallery
              picture={p}
              images={props.images}
              close={close}
            />
          )}
        </PictureGalleryMenu>
        <RibbonButton
          label="Change picture"
          tooltip="Change picture: keep the size and format, use another image"
          disabled={ro() || one()?.kind !== 'picture'}
          data-testid="pptx-picture-change"
          onClick={props.onChangePicture}
        >
          <ImagesIcon />
        </RibbonButton>
        <RibbonPopover
          label="Reset picture"
          icon={<ArrowCounterClockwise class="size-3.5" />}
          disabled={ro()}
          testId="pptx-picture-reset"
        >
          {(close) => (
            <div class="flex w-52 flex-col">
              <PopoverItem
                label="Reset Picture"
                hint="keeps the crop"
                testId="pptx-picture-reset-picture"
                onClick={() => {
                  close();
                  void c.resetPictures(false);
                }}
              />
              <PopoverItem
                label="Reset Picture & Size"
                testId="pptx-picture-reset-size"
                onClick={() => {
                  close();
                  void c.resetPictures(true);
                }}
              />
            </div>
          )}
        </RibbonPopover>
      </RibbonGroup>
      <RibbonGroup label="Picture styles">
        <RibbonPopover
          label="Picture border"
          icon={<PenNib class="size-3.5" />}
          disabled={ro()}
          testId="pptx-picture-border"
        >
          {(close) => <OutlineMenu close={close} />}
        </RibbonPopover>
        <ShapeEffectsMenu
          label="Picture effects"
          text="Effects"
          testId="pptx-picture-effects"
        />
      </RibbonGroup>
      <RibbonGroup label="Accessibility">
        <RibbonTextButton
          label="Alt text"
          disabled={ro()}
          onClick={() => env.openFormatPane('size')}
        >
          Alt Text
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
        <CropButton crop={props.crop} />
        <NumberField
          label="Picture height"
          unit="pt"
          value={size()?.h}
          min={1}
          max={10000}
          disabled={ro() || !one()}
          testId="pptx-picture-height"
          onCommit={(h) => {
            const s = size();
            // Pictures keep their aspect ratio, as in PowerPoint.
            c.resize(s && s.h > 0 ? { h, w: (s.w * h) / s.h } : { h });
          }}
        />
        <NumberField
          label="Picture width"
          unit="pt"
          value={size()?.w}
          min={1}
          max={10000}
          disabled={ro() || !one()}
          testId="pptx-picture-width"
          onCommit={(w) => {
            const s = size();
            c.resize(s && s.w > 0 ? { w, h: (s.h * w) / s.w } : { w });
          }}
        />
      </RibbonGroup>
    </>
  );
}
