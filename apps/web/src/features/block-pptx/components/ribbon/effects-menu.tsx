/**
 * PowerPoint's effect galleries: Shape Effects (and Picture Effects) with
 * Shadow, Reflection, Glow, and Soft Edges flyouts, and the WordArt Text
 * Effects with Shadow and Glow. Every tile previews its effect in CSS.
 */

import type {
  EffectsOutline,
  GlowSpec,
  ShadowSpec,
} from '@core/pptx-engine/types';
import CaretRight from '@phosphor/caret-right.svg';
import { createSignal, For, type JSX, Show } from 'solid-js';
import {
  GLOW_COLORS,
  GLOW_SIZES,
  GLOW_TRANSPARENCY,
  glowCss,
  perspectiveShadowStyle,
  presetShadowCss,
  REFLECTION_PRESETS,
  reflectionMask,
  SHADOW_GROUPS,
  type ShadowPresetInfo,
  SOFT_EDGE_SIZES,
  softEdgeMask,
  textGlowCss,
  textShadowCss,
} from '../../core/effects';
import { type Swatch, swatchCss } from '../../core/palette';
import { ColorPicker, PopoverItem, RibbonPopover } from './controls';
import { type RibbonEnv, useRibbon } from './ribbon';

/** CSS pixels per point on gallery tiles (exaggerated, as PowerPoint's are). */
const TILE_SCALE = 0.9;
/** Shadows read at a larger scale on small tiles. */
const SHADOW_SCALE = 1.5;
const PAPER = '#ffffff';
const SHAPE_FILL = '#f4f4f4';
const SHAPE_BORDER = '#bdbdbd';

/** A flyout menu: categories on the left, the hovered one's gallery beside it. */
export function FlyoutMenu(props: {
  items: {
    id: string;
    label: string;
    icon?: JSX.Element;
    testId: string;
    content: () => JSX.Element;
  }[];
}) {
  const [open, setOpen] = createSignal<string | null>(null);
  return (
    <div class="flex w-44 flex-col" role="menu">
      <For each={props.items}>
        {(item) => {
          const [flip, setFlip] = createSignal(false);
          return (
            <div
              class="relative"
              onPointerEnter={() => setOpen(item.id)}
              onFocusIn={() => setOpen(item.id)}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={open() === item.id}
                data-testid={item.testId}
                class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink text-xs hover:bg-ink/5"
                classList={{ 'bg-ink/5': open() === item.id }}
                onClick={() => setOpen(item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') setOpen(item.id);
                  if (e.key === 'ArrowLeft') setOpen(null);
                }}
              >
                <span class="flex size-4 shrink-0 items-center justify-center">
                  {item.icon}
                </span>
                <span class="flex-1">{item.label}</span>
                <CaretRight class="size-3 opacity-60" />
              </button>
              <Show when={open() === item.id}>
                <div
                  ref={(el) =>
                    queueMicrotask(() => {
                      const r = el.getBoundingClientRect();
                      if (r.right > window.innerWidth - 8) setFlip(true);
                    })
                  }
                  class="absolute -top-2 z-10 w-max rounded-xl border border-edge bg-menu p-2 text-ink text-xs shadow-xl"
                  classList={{
                    'left-full ml-2': !flip(),
                    'right-full mr-2': flip(),
                  }}
                >
                  {item.content()}
                </div>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}

/** A gallery section heading, as PowerPoint's gray bars. */
export function GalleryHeading(props: { children: JSX.Element }) {
  return (
    <div class="mt-1 mb-1 rounded-sm bg-ink/5 px-2 py-0.5 font-semibold text-ink-muted text-xs first:mt-0">
      {props.children}
    </div>
  );
}

/** One tile of a gallery: a preview on white paper, outlined on hover. */
export function GalleryTile(props: {
  label: string;
  testId: string;
  active?: boolean;
  size?: number;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active ?? false}
      data-testid={props.testId}
      class="flex shrink-0 items-center justify-center overflow-hidden rounded-sm border outline-none hover:border-accent hover:ring-2 hover:ring-accent/40 focus-visible:ring-2 focus-visible:ring-accent"
      classList={{
        'border-accent ring-2 ring-accent/60': !!props.active,
        'border-edge-muted': !props.active,
      }}
      style={{
        width: `${props.size ?? 48}px`,
        height: `${props.size ?? 48}px`,
        background: PAPER,
      }}
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  );
}

/** A small square shape on a tile, styled by `style`. */
function TileShape(props: { style?: JSX.CSSProperties; size?: number }) {
  return (
    <span
      class="block shrink-0"
      style={{
        width: `${props.size ?? 26}px`,
        height: `${props.size ?? 26}px`,
        background: SHAPE_FILL,
        border: `1px solid ${SHAPE_BORDER}`,
        ...props.style,
      }}
    />
  );
}

/** A tile previewing a shadow preset on a square. */
function ShadowSwatch(props: { preset: ShadowPresetInfo }) {
  return (
    <span class="relative block size-[26px]">
      <Show when={props.preset.kind === 'perspective'}>
        <span
          class="absolute inset-0"
          style={{
            background: `rgba(0, 0, 0, ${props.preset.alpha * 2})`,
            ...perspectiveShadowStyle(props.preset, SHADOW_SCALE),
          }}
        />
      </Show>
      <TileShape
        style={{
          position: 'relative',
          'box-shadow':
            props.preset.kind === 'perspective'
              ? undefined
              : presetShadowCss(props.preset, SHADOW_SCALE, 1.6),
        }}
      />
    </span>
  );
}

/** A tile previewing a shadow preset on a letter. */
function TextShadowSwatch(props: { preset: ShadowPresetInfo }) {
  const style = (): JSX.CSSProperties =>
    props.preset.kind === 'inner'
      ? {
          color: 'transparent',
          'background-color': '#7a7a7a',
          '-webkit-background-clip': 'text',
          'background-clip': 'text',
          'text-shadow': `${-Math.cos((props.preset.angleDeg * Math.PI) / 180)}px ${-Math.sin((props.preset.angleDeg * Math.PI) / 180)}px 1px rgba(255,255,255,0.6)`,
        }
      : props.preset.kind === 'perspective'
        ? {
            color: '#3b3b3b',
            'text-shadow': `0 ${props.preset.sy < 0 ? 3 : -2}px 3px rgba(0,0,0,0.35)`,
          }
        : {
            color: '#3b3b3b',
            'text-shadow': textShadowCss(props.preset, TILE_SCALE),
          };
  return <LetterA style={style()} />;
}

function LetterA(props: { style?: JSX.CSSProperties }) {
  return (
    <span
      class="font-bold font-serif text-[28px] leading-none"
      style={{ color: '#3b3b3b', ...props.style }}
    >
      A
    </span>
  );
}

/** The Shadow gallery: No Shadow, Outer, Inner, Perspective. */
export function ShadowGallery(props: {
  current?: EffectsOutline['shadow'];
  text?: boolean;
  testPrefix: string;
  onPick: (spec: ShadowSpec) => void;
  onOptions?: () => void;
}) {
  return (
    <div
      class="flex w-[172px] flex-col"
      data-testid={`${props.testPrefix}-gallery`}
    >
      <GalleryHeading>No Shadow</GalleryHeading>
      <div class="flex gap-1">
        <GalleryTile
          label="No Shadow"
          testId={`${props.testPrefix}-none`}
          active={!props.current}
          onClick={() => props.onPick('none')}
        >
          {props.text ? <LetterA /> : <TileShape />}
        </GalleryTile>
      </div>
      <For each={SHADOW_GROUPS}>
        {(group) => (
          <>
            <GalleryHeading>{group.label}</GalleryHeading>
            <div class="grid grid-cols-3 gap-1">
              <For each={group.presets}>
                {(preset) => (
                  <GalleryTile
                    label={preset.label}
                    testId={`${props.testPrefix}-${preset.id}`}
                    active={props.current?.preset === preset.id}
                    onClick={() => props.onPick(preset.id)}
                  >
                    {props.text ? (
                      <TextShadowSwatch preset={preset} />
                    ) : (
                      <ShadowSwatch preset={preset} />
                    )}
                  </GalleryTile>
                )}
              </For>
            </div>
          </>
        )}
      </For>
      <Show when={props.onOptions}>
        <div class="mt-1.5 border-edge-muted border-t pt-1">
          <PopoverItem
            label="Shadow Options…"
            testId={`${props.testPrefix}-options`}
            onClick={() => props.onOptions?.()}
          />
        </div>
      </Show>
    </div>
  );
}

/** The Reflection gallery: No Reflection and nine variations. */
export function ReflectionGallery(props: {
  current?: EffectsOutline['reflection'];
  accent: string;
  testPrefix: string;
  onPick: (spec: 'none' | (typeof REFLECTION_PRESETS)[number]['id']) => void;
  onOptions?: () => void;
}) {
  const tile = (sizePct: number, distancePt: number, none = false) => (
    <span class="flex h-[42px] flex-col items-center">
      <TileShape
        size={19}
        style={{ background: props.accent, border: 'none' }}
      />
      <Show when={!none}>
        {/* Drawn upright with the fade reversed, as if mirrored. */}
        <TileShape
          size={19}
          style={{
            background: props.accent,
            border: 'none',
            'margin-top': `${distancePt * TILE_SCALE * 0.6}px`,
            'mask-image': reflectionMask(0.45, sizePct),
            '-webkit-mask-image': reflectionMask(0.45, sizePct),
          }}
        />
      </Show>
    </span>
  );
  return (
    <div
      class="flex w-[172px] flex-col"
      data-testid={`${props.testPrefix}-gallery`}
    >
      <GalleryHeading>No Reflection</GalleryHeading>
      <div class="flex gap-1">
        <GalleryTile
          label="No Reflection"
          testId={`${props.testPrefix}-none`}
          active={!props.current}
          onClick={() => props.onPick('none')}
        >
          {tile(0, 0, true)}
        </GalleryTile>
      </div>
      <GalleryHeading>Reflection Variations</GalleryHeading>
      <div class="grid grid-cols-3 gap-1">
        <For each={REFLECTION_PRESETS}>
          {(preset) => (
            <GalleryTile
              label={preset.label}
              testId={`${props.testPrefix}-${preset.id}`}
              active={props.current?.preset === preset.id}
              onClick={() => props.onPick(preset.id)}
            >
              {tile(preset.sizePct, preset.distancePt)}
            </GalleryTile>
          )}
        </For>
      </div>
      <Show when={props.onOptions}>
        <div class="mt-1.5 border-edge-muted border-t pt-1">
          <PopoverItem
            label="Reflection Options…"
            testId={`${props.testPrefix}-options`}
            onClick={() => props.onOptions?.()}
          />
        </div>
      </Show>
    </div>
  );
}

const ACCENT_NAMES: Record<string, string> = {
  accent1: 'Accent color 1',
  accent2: 'Accent color 2',
  accent3: 'Accent color 3',
  accent4: 'Accent color 4',
  accent5: 'Accent color 5',
  accent6: 'Accent color 6',
};

/** The colors galleries offer: the deck's theme and the standard colors. */
export interface GalleryColors {
  themeColors: [string, string][];
  themeGrid: Swatch[][];
  standard: Swatch[];
}

/** The Glow gallery: No Glow, accents × sizes, More Glow Colors. */
export function GlowGallery(props: {
  current?: EffectsOutline['glow'];
  text?: boolean;
  colors: GalleryColors;
  testPrefix: string;
  onPick: (spec: GlowSpec) => void;
  onOptions?: () => void;
}) {
  const [more, setMore] = createSignal(false);
  const css = (slot: string) =>
    swatchCss(slot, props.colors.themeColors) ?? '#4472C4';
  // Tiles show glows stronger than they are, as PowerPoint's gallery does.
  const preview = (slot: string, size: number) =>
    props.text ? (
      <LetterA
        style={{
          'text-shadow': textGlowCss(
            css(slot),
            size,
            GLOW_TRANSPARENCY - 0.25,
            TILE_SCALE * 0.7
          ),
        }}
      />
    ) : (
      <TileShape
        size={20}
        style={{
          'box-shadow': glowCss(
            css(slot),
            size,
            GLOW_TRANSPARENCY - 0.3,
            TILE_SCALE * 0.6
          ),
        }}
      />
    );
  return (
    <div class="flex flex-col" data-testid={`${props.testPrefix}-gallery`}>
      <GalleryHeading>No Glow</GalleryHeading>
      <div class="flex gap-1">
        <GalleryTile
          label="No Glow"
          size={42}
          testId={`${props.testPrefix}-none`}
          active={!props.current}
          onClick={() => props.onPick('none')}
        >
          {props.text ? <LetterA /> : <TileShape size={22} />}
        </GalleryTile>
      </div>
      <GalleryHeading>Glow Variations</GalleryHeading>
      <div class="grid grid-cols-6 gap-1">
        <For each={GLOW_SIZES}>
          {(size) => (
            <For each={GLOW_COLORS}>
              {(slot) => (
                <GalleryTile
                  label={`Glow: ${size} pt; ${ACCENT_NAMES[slot]}`}
                  size={42}
                  testId={`${props.testPrefix}-${slot}-${size}`}
                  active={
                    !!props.current &&
                    Math.abs(props.current.sizePt - size) < 0.05 &&
                    hueClose(props.current.color, css(slot))
                  }
                  onClick={() =>
                    props.onPick({
                      color: slot,
                      sizePt: size,
                      transparency: GLOW_TRANSPARENCY,
                    })
                  }
                >
                  {preview(slot, size)}
                </GalleryTile>
              )}
            </For>
          )}
        </For>
      </div>
      <div class="mt-1.5 flex flex-col border-edge-muted border-t pt-1">
        <PopoverItem
          label="More Glow Colors"
          testId={`${props.testPrefix}-more`}
          icon={
            <span class="block size-3.5 rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]" />
          }
          hint="›"
          active={more()}
          onClick={() => setMore((m) => !m)}
        />
        <Show when={more()}>
          <div class="px-1 pb-1">
            <ColorPicker
              themeGrid={props.colors.themeGrid}
              standard={props.colors.standard}
              testId={`${props.testPrefix}-colors`}
              onPick={(v) => {
                if (v)
                  props.onPick({
                    color: v,
                    sizePt: props.current?.sizePt ?? 10,
                    transparency: props.current?.transparency ?? 0.6,
                  });
              }}
            />
          </div>
        </Show>
        <Show when={props.onOptions}>
          <PopoverItem
            label="Glow Options…"
            testId={`${props.testPrefix}-options`}
            onClick={() => props.onOptions?.()}
          />
        </Show>
      </div>
    </div>
  );
}

/** Whether two colors are alike (a glow's saturated theme color and the swatch). */
function hueClose(a: string, b: string): boolean {
  const rgb = (hex: string) => {
    const n = Number.parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const hue = ([r, g, b]: number[]) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return -1;
    const d = max - min;
    const h =
      max === r
        ? ((g - b) / d + (g < b ? 6 : 0)) * 60
        : max === g
          ? ((b - r) / d + 2) * 60
          : ((r - g) / d + 4) * 60;
    return h;
  };
  const ha = hue(rgb(a));
  const hb = hue(rgb(b));
  if (ha < 0 || hb < 0) return a.toUpperCase() === b.toUpperCase();
  const diff = Math.abs(ha - hb);
  return Math.min(diff, 360 - diff) < 8;
}

/** The Soft Edges gallery: No Soft Edges and six sizes. */
export function SoftEdgeGallery(props: {
  current?: EffectsOutline['softEdge'];
  accent: string;
  testPrefix: string;
  onPick: (sizePt: number | 'none') => void;
  onOptions?: () => void;
}) {
  const tile = (size: number) => (
    <TileShape
      size={30}
      style={{
        background: props.accent,
        border: 'none',
        'mask-image': size > 0 ? softEdgeMask(size, 0.3) : undefined,
        '-webkit-mask-image': size > 0 ? softEdgeMask(size, 0.3) : undefined,
        'mask-composite': 'intersect',
        '-webkit-mask-composite': 'source-in',
      }}
    />
  );
  return (
    <div
      class="flex w-[172px] flex-col"
      data-testid={`${props.testPrefix}-gallery`}
    >
      <GalleryHeading>No Soft Edges</GalleryHeading>
      <div class="flex gap-1">
        <GalleryTile
          label="No Soft Edges"
          testId={`${props.testPrefix}-none`}
          active={!props.current}
          onClick={() => props.onPick('none')}
        >
          {tile(0)}
        </GalleryTile>
      </div>
      <GalleryHeading>Soft Edge Variations</GalleryHeading>
      <div class="grid grid-cols-3 gap-1">
        <For each={SOFT_EDGE_SIZES}>
          {(size) => (
            <GalleryTile
              label={`${size} Point`}
              testId={`${props.testPrefix}-${size}`}
              active={
                !!props.current && Math.abs(props.current.sizePt - size) < 0.05
              }
              onClick={() => props.onPick(size)}
            >
              {tile(size)}
            </GalleryTile>
          )}
        </For>
      </div>
      <Show when={props.onOptions}>
        <div class="mt-1.5 border-edge-muted border-t pt-1">
          <PopoverItem
            label="Soft Edges Options…"
            testId={`${props.testPrefix}-options`}
            onClick={() => props.onOptions?.()}
          />
        </div>
      </Show>
    </div>
  );
}

/** The gallery colors of the ribbon's deck. */
export function galleryColors(env: RibbonEnv): GalleryColors {
  return {
    themeColors: env.deck()?.themeColors ?? [],
    themeGrid: env.themeGrid(),
    standard: env.standardColors,
  };
}

/** A square with a soft glow, the Shape and Picture Effects icon. */
export function EffectsIcon() {
  return (
    <span
      class="block size-3 rounded-[2px] bg-accent"
      style={{ 'box-shadow': '0 0 3px 1px var(--color-accent)' }}
    />
  );
}

/**
 * Shape Effects (or, for pictures, Picture Effects): Shadow, Reflection,
 * Glow, and Soft Edges for every selected shape.
 */
export function ShapeEffectsMenu(props: {
  label: string;
  text?: string;
  testId: string;
  disabled?: boolean;
}) {
  const env = useRibbon();
  const c = env.commands;
  const current = () => env.selection()[0]?.effects;
  const accent = () =>
    swatchCss('accent1', env.deck()?.themeColors ?? []) ?? '#4472C4';
  const options = (close: () => void) => () => {
    close();
    env.openFormatPane('effects');
  };
  return (
    <RibbonPopover
      label={props.label}
      text={props.text}
      icon={<EffectsIcon />}
      disabled={
        props.disabled || env.readonly() || env.selection().length === 0
      }
      testId={props.testId}
      class="overflow-visible"
    >
      {(close) => (
        <FlyoutMenu
          items={[
            {
              id: 'shadow',
              label: 'Shadow',
              testId: 'pptx-effects-shadow',
              icon: (
                <TileShape
                  size={11}
                  style={{ 'box-shadow': '1px 1px 1px rgba(0,0,0,.6)' }}
                />
              ),
              content: () => (
                <ShadowGallery
                  current={current()?.shadow}
                  testPrefix="pptx-effect-shadow"
                  onPick={(shadow) => {
                    close();
                    void c.setShapeEffects({ shadow });
                  }}
                  onOptions={options(close)}
                />
              ),
            },
            {
              id: 'reflection',
              label: 'Reflection',
              testId: 'pptx-effects-reflection',
              icon: (
                <span class="flex flex-col items-center">
                  <span class="block h-1.5 w-2.5 bg-accent" />
                  <span class="block h-1 w-2.5 bg-accent/40" />
                </span>
              ),
              content: () => (
                <ReflectionGallery
                  current={current()?.reflection}
                  accent={accent()}
                  testPrefix="pptx-effect-reflection"
                  onPick={(reflection) => {
                    close();
                    void c.setShapeEffects({ reflection });
                  }}
                  onOptions={options(close)}
                />
              ),
            },
            {
              id: 'glow',
              label: 'Glow',
              testId: 'pptx-effects-glow',
              icon: <EffectsIcon />,
              content: () => (
                <GlowGallery
                  current={current()?.glow}
                  colors={galleryColors(env)}
                  testPrefix="pptx-effect-glow"
                  onPick={(glow) => {
                    close();
                    void c.setShapeEffects({ glow });
                  }}
                  onOptions={options(close)}
                />
              ),
            },
            {
              id: 'soft-edges',
              label: 'Soft Edges',
              testId: 'pptx-effects-soft-edges',
              icon: (
                <span
                  class="block size-3 rounded-[3px] bg-accent"
                  style={{ filter: 'blur(1px)' }}
                />
              ),
              content: () => (
                <SoftEdgeGallery
                  current={current()?.softEdge}
                  accent={accent()}
                  testPrefix="pptx-effect-soft-edge"
                  onPick={(size) => {
                    close();
                    void c.setShapeEffects({
                      softEdge: size === 'none' ? 'none' : { sizePt: size },
                    });
                  }}
                  onOptions={options(close)}
                />
              ),
            },
          ]}
        />
      )}
    </RibbonPopover>
  );
}

/** A glowing letter, the Text Effects icon. */
function TextEffectsIcon() {
  return (
    <span
      class="font-bold font-serif text-[13px] text-accent leading-none"
      style={{ 'text-shadow': '0 0 3px var(--color-accent)' }}
    >
      A
    </span>
  );
}

/** WordArt Text Effects: Shadow and Glow of the selected text. */
export function TextEffectsMenu() {
  const env = useRibbon();
  const c = env.commands;
  const current = () => {
    const src = c.format();
    return src.effects;
  };
  return (
    <RibbonPopover
      label="Text effects"
      icon={<TextEffectsIcon />}
      disabled={env.readonly() || !c.textActive()}
      testId="pptx-text-effects"
      class="overflow-visible"
    >
      {(close) => (
        <FlyoutMenu
          items={[
            {
              id: 'shadow',
              label: 'Shadow',
              testId: 'pptx-text-effects-shadow',
              icon: (
                <span
                  class="font-bold font-serif text-xs leading-none"
                  style={{ 'text-shadow': '1px 1px 1px rgba(0,0,0,.5)' }}
                >
                  A
                </span>
              ),
              content: () => (
                <ShadowGallery
                  current={current()?.shadow}
                  text
                  testPrefix="pptx-text-effect-shadow"
                  onPick={(shadow) => {
                    close();
                    void c.setTextEffects({ shadow });
                  }}
                />
              ),
            },
            {
              id: 'glow',
              label: 'Glow',
              testId: 'pptx-text-effects-glow',
              icon: <TextEffectsIcon />,
              content: () => (
                <GlowGallery
                  current={current()?.glow}
                  text
                  colors={galleryColors(env)}
                  testPrefix="pptx-text-effect-glow"
                  onPick={(glow) => {
                    close();
                    void c.setTextEffects({ glow });
                  }}
                />
              ),
            },
          ]}
        />
      )}
    </RibbonPopover>
  );
}
