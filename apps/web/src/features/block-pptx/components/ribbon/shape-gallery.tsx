/**
 * PowerPoint's shape gallery: preset shapes by category, each drawn from the
 * engine's own preset geometry.
 */

import type { PresetPath } from '@core/pptx-engine/types';
import { createResource, For, Show } from 'solid-js';

export const SHAPE_CATEGORIES: { label: string; presets: string[] }[] = [
  { label: 'Lines', presets: ['line', 'arrow'] },
  {
    label: 'Rectangles',
    presets: [
      'rect',
      'roundRect',
      'snip1Rect',
      'snip2SameRect',
      'snip2DiagRect',
      'snipRoundRect',
      'round1Rect',
      'round2SameRect',
      'round2DiagRect',
    ],
  },
  {
    label: 'Basic shapes',
    presets: [
      'ellipse',
      'triangle',
      'rtTriangle',
      'parallelogram',
      'trapezoid',
      'diamond',
      'pentagon',
      'hexagon',
      'heptagon',
      'octagon',
      'decagon',
      'dodecagon',
      'pie',
      'chord',
      'teardrop',
      'frame',
      'halfFrame',
      'corner',
      'diagStripe',
      'plus',
      'plaque',
      'can',
      'cube',
      'bevel',
      'donut',
      'noSmoking',
      'blockArc',
      'foldedCorner',
      'smileyFace',
      'heart',
      'lightningBolt',
      'sun',
      'moon',
      'cloud',
      'arc',
      'bracketPair',
      'bracePair',
      'leftBracket',
      'rightBracket',
      'leftBrace',
      'rightBrace',
    ],
  },
  {
    label: 'Block arrows',
    presets: [
      'rightArrow',
      'leftArrow',
      'upArrow',
      'downArrow',
      'leftRightArrow',
      'upDownArrow',
      'quadArrow',
      'leftRightUpArrow',
      'bentArrow',
      'uturnArrow',
      'leftUpArrow',
      'bentUpArrow',
      'curvedRightArrow',
      'curvedLeftArrow',
      'curvedUpArrow',
      'curvedDownArrow',
      'stripedRightArrow',
      'notchedRightArrow',
      'homePlate',
      'chevron',
      'rightArrowCallout',
      'downArrowCallout',
      'leftArrowCallout',
      'upArrowCallout',
      'leftRightArrowCallout',
      'quadArrowCallout',
      'circularArrow',
    ],
  },
  {
    label: 'Equation shapes',
    presets: [
      'mathPlus',
      'mathMinus',
      'mathMultiply',
      'mathDivide',
      'mathEqual',
      'mathNotEqual',
    ],
  },
  {
    label: 'Flowchart',
    presets: [
      'flowChartProcess',
      'flowChartAlternateProcess',
      'flowChartDecision',
      'flowChartInputOutput',
      'flowChartPredefinedProcess',
      'flowChartInternalStorage',
      'flowChartDocument',
      'flowChartMultidocument',
      'flowChartTerminator',
      'flowChartPreparation',
      'flowChartManualInput',
      'flowChartManualOperation',
      'flowChartConnector',
      'flowChartOffpageConnector',
      'flowChartPunchedCard',
      'flowChartPunchedTape',
      'flowChartSummingJunction',
      'flowChartOr',
      'flowChartCollate',
      'flowChartSort',
      'flowChartExtract',
      'flowChartMerge',
      'flowChartOnlineStorage',
      'flowChartDelay',
      'flowChartMagneticTape',
      'flowChartMagneticDisk',
      'flowChartMagneticDrum',
      'flowChartDisplay',
    ],
  },
  {
    label: 'Stars and banners',
    presets: [
      'irregularSeal1',
      'irregularSeal2',
      'star4',
      'star5',
      'star6',
      'star7',
      'star8',
      'star10',
      'star12',
      'star16',
      'star24',
      'star32',
      'ribbon2',
      'ribbon',
      'ellipseRibbon2',
      'ellipseRibbon',
      'verticalScroll',
      'horizontalScroll',
      'wave',
      'doubleWave',
    ],
  },
  {
    label: 'Callouts',
    presets: [
      'wedgeRectCallout',
      'wedgeRoundRectCallout',
      'wedgeEllipseCallout',
      'cloudCallout',
      'borderCallout1',
      'borderCallout2',
      'borderCallout3',
      'accentCallout1',
      'accentCallout2',
      'accentCallout3',
      'callout1',
      'callout2',
      'callout3',
    ],
  },
];

/** Readable names: `flowChartDecision` → "Flow chart decision". */
export function presetLabel(preset: string): string {
  if (preset === 'rect') return 'Rectangle';
  if (preset === 'roundRect') return 'Rounded rectangle';
  if (preset === 'ellipse') return 'Oval';
  if (preset === 'line') return 'Line';
  if (preset === 'arrow') return 'Line arrow';
  const words = preset
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const W = 22;
const H = 18;

function LinePreview(props: { arrow: boolean }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="size-full overflow-visible">
      <line
        x1="2"
        y1={H - 2}
        x2={W - 2}
        y2="2"
        class="stroke-current"
        stroke-width="1.2"
      />
      <Show when={props.arrow}>
        <path d={`M${W - 2} 2 l-5.5 1 l3 3.5 z`} class="fill-current" />
      </Show>
    </svg>
  );
}

export function ShapeGallery(props: {
  load?: (
    names: string[],
    w: number,
    h: number
  ) => Promise<Record<string, PresetPath[]>>;
  onPick: (preset: string) => void;
  /** Categories to show (all by default). */
  categories?: string[];
}) {
  const [paths] = createResource(
    () => props.load,
    (load) =>
      load(
        SHAPE_CATEGORIES.flatMap((c) => c.presets),
        W,
        H
      ).catch(() => ({}) as Record<string, PresetPath[]>)
  );
  const categories = () =>
    props.categories
      ? SHAPE_CATEGORIES.filter((c) => props.categories!.includes(c.label))
      : SHAPE_CATEGORIES;
  return (
    <div class="flex max-h-[60vh] w-[19rem] flex-col gap-1 overflow-y-auto">
      <For each={categories()}>
        {(category) => (
          <div>
            <div class="px-1 pt-1 pb-0.5 font-medium text-ink-muted text-xs">
              {category.label}
            </div>
            <div class="flex flex-wrap">
              <For each={category.presets}>
                {(preset) => (
                  <button
                    type="button"
                    title={presetLabel(preset)}
                    aria-label={presetLabel(preset)}
                    data-testid={`pptx-shape-${preset}`}
                    class="flex size-7 items-center justify-center rounded-md p-1 text-ink-muted hover:bg-ink/5 hover:text-ink"
                    onClick={() => props.onPick(preset)}
                  >
                    <Show
                      when={preset !== 'line' && preset !== 'arrow'}
                      fallback={<LinePreview arrow={preset === 'arrow'} />}
                    >
                      <svg
                        viewBox={`-1 -1 ${W + 2} ${H + 2}`}
                        class="size-full overflow-visible"
                      >
                        <For each={paths()?.[preset] ?? []}>
                          {(p) => (
                            <path
                              d={p.d}
                              class={p.fill ? 'fill-current/15' : 'fill-none'}
                              stroke={p.stroke ? 'currentColor' : 'none'}
                              stroke-width="1"
                              stroke-linejoin="round"
                            />
                          )}
                        </For>
                      </svg>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
