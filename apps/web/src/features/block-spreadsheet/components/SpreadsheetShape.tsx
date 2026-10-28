import type {
  ShapeLine,
  ShapePart,
  ShapeRun,
  SheetShape,
} from '@macro-inc/spreadsheet/sheet-drawings';
import { For, Show } from 'solid-js';
import { presetOutline, type Tip } from '../core/shape-geometry';

/** The theme's text color, for shapes and text Excel draws in it. */
const INK = 'var(--color-ink)';
/** Points to pixels at 100% zoom. */
const POINT = 96 / 72;

function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map(
    (index) => Number.parseInt(color.slice(index, index + 2), 16) / 255
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * A color for text or lines drawn over a part. Black on a part without fill
 * sits on the cells, so it follows the theme's text color and stays
 * readable in dark mode; on a fill, it contrasts with the fill.
 */
function inkOn(color: string | undefined, fill: string | undefined): string {
  if (color && !(fill === undefined && luminance(color) < 0.15)) return color;
  if (fill === undefined) return INK;
  return luminance(fill) < 0.45 ? '#FFFFFF' : '#000000';
}

const DASHES: Record<NonNullable<ShapeLine['dash']>, number[]> = {
  dash: [4, 3],
  dot: [1, 1],
  dashDot: [4, 3, 1, 3],
  longDash: [8, 3],
  longDashDot: [8, 3, 1, 3],
};

/** An arrowhead at a line's tip, pointing along it. */
function arrowhead(
  type: NonNullable<ShapeLine['head']>,
  tip: Tip,
  width: number
) {
  const length = Math.max(6, width * 3);
  const half = Math.max(3, width * 1.5);
  const cos = Math.cos(tip.angle);
  const sin = Math.sin(tip.angle);
  // Points relative to the tip, with x along the line backwards.
  const at = (back: number, side: number) =>
    `${tip.x - cos * back - sin * side},${tip.y - sin * back + cos * side}`;
  if (type === 'oval')
    return {
      d: `M${at(length, 0)}A${length / 2},${half} ${(tip.angle * 180) / Math.PI} 1,1 ${tip.x},${tip.y}A${length / 2},${half} ${(tip.angle * 180) / Math.PI} 1,1 ${at(length, 0)}Z`,
      filled: true,
    };
  if (type === 'diamond')
    return {
      d: `M${tip.x},${tip.y}L${at(length / 2, half)}L${at(length, 0)}L${at(length / 2, -half)}Z`,
      filled: true,
    };
  if (type === 'arrow')
    return {
      d: `M${at(length, half)}L${tip.x},${tip.y}L${at(length, -half)}`,
      filled: false,
    };
  if (type === 'stealth')
    return {
      d: `M${tip.x},${tip.y}L${at(length, half)}L${at(length * 0.7, 0)}L${at(length, -half)}Z`,
      filled: true,
    };
  return {
    d: `M${tip.x},${tip.y}L${at(length, half)}L${at(length, -half)}Z`,
    filled: true,
  };
}

function Outline(props: {
  part: ShapePart;
  width: number;
  height: number;
  scale: number;
}) {
  const outline = () =>
    presetOutline(
      props.part.geometry,
      props.width,
      props.height,
      props.part.adjust
    );
  const line = () => props.part.line;
  const stroke = () => {
    const value = line();
    return value && value.width > 0
      ? inkOn(value.color, props.part.fill)
      : undefined;
  };
  const strokeWidth = () => Math.max(0.75, (line()?.width ?? 0) * props.scale);
  const dash = () => {
    const pattern = line()?.dash;
    return pattern
      ? DASHES[pattern].map((value) => value * strokeWidth()).join(' ')
      : undefined;
  };
  const flip = () => {
    const { flipH, flipV } = props.part;
    if (!flipH && !flipV) return undefined;
    return `translate(${flipH ? props.width : 0},${flipV ? props.height : 0}) scale(${flipH ? -1 : 1},${flipV ? -1 : 1})`;
  };
  const fill = (open?: boolean) =>
    open || !props.part.fill ? 'none' : props.part.fill;
  return (
    <svg
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 overflow-visible"
      width={props.width}
      height={props.height}
    >
      <g
        transform={flip()}
        stroke={stroke() ?? 'none'}
        stroke-width={strokeWidth()}
        stroke-dasharray={dash()}
        stroke-linejoin="round"
        fill-opacity={props.part.opacity}
      >
        <Show
          when={props.part.paths}
          fallback={
            <>
              <path
                d={outline().d}
                fill={fill(outline().open)}
                fill-rule={outline().evenOdd ? 'evenodd' : undefined}
              />
              <Show when={outline().detail}>
                {(detail) => <path d={detail()} fill="none" />}
              </Show>
              <For
                each={(
                  [
                    ['head', outline().start],
                    ['tail', outline().end],
                  ] as const
                ).flatMap(([end, tip]) => {
                  const type = line()?.[end];
                  return type && tip
                    ? [arrowhead(type, tip, strokeWidth())]
                    : [];
                })}
              >
                {(head) => (
                  <path
                    d={head.d}
                    fill={head.filled ? stroke() : 'none'}
                    stroke-dasharray="none"
                  />
                )}
              </For>
            </>
          }
        >
          {(paths) => (
            <For each={paths()}>
              {(path) => (
                <path
                  d={path.d}
                  transform={`scale(${props.width || 1},${props.height || 1})`}
                  vector-effect="non-scaling-stroke"
                  fill={path.fill === false ? 'none' : fill()}
                  stroke={path.stroke === false ? 'none' : undefined}
                />
              )}
            </For>
          )}
        </Show>
      </g>
    </svg>
  );
}

function Text(props: {
  part: ShapePart;
  scale: number;
  font?: string;
  linked?: string;
}) {
  const text = () => props.part.text!;
  const padding = () => {
    const [left, top, right, bottom] = (text().insets ?? [10, 5, 10, 5]).map(
      (value) => `${value * props.scale}px`
    );
    return `${top} ${right} ${bottom} ${left}`;
  };
  // A linked cell's value, in the look of the text's first run.
  const paragraphs = () => {
    const linked = props.linked;
    if (linked === undefined || !text().link) return text().paragraphs;
    const first = text().paragraphs.flatMap((paragraph) => paragraph.runs)[0];
    return [
      {
        align: text().paragraphs[0]?.align,
        runs: [{ ...first, text: linked }],
      },
    ];
  };
  const size = (points: number | undefined) =>
    `${(points ?? 11) * POINT * props.scale}px`;
  const runStyle = (run: ShapeRun) => ({
    'font-size': size(run.size),
    'font-weight': run.bold ? 700 : undefined,
    'font-style': run.italic ? 'italic' : undefined,
    'text-decoration':
      [run.underline && 'underline', run.strike && 'line-through']
        .filter(Boolean)
        .join(' ') || undefined,
    color: inkOn(run.color, props.part.fill),
    'font-family': run.font
      ? `${JSON.stringify(run.font)}, var(--font-sans), sans-serif`
      : undefined,
  });
  return (
    <div
      class="absolute inset-0 flex flex-col leading-[1.2]"
      classList={{ 'overflow-hidden': !!text().clip }}
      style={{
        padding: padding(),
        'justify-content':
          text().anchor === 'middle'
            ? 'center'
            : text().anchor === 'bottom'
              ? 'flex-end'
              : 'flex-start',
        'white-space': text().noWrap ? 'pre' : 'pre-wrap',

        color: inkOn(undefined, props.part.fill),
        'font-family': props.font
          ? `${JSON.stringify(props.font)}, var(--font-sans), sans-serif`
          : undefined,
        'writing-mode': text().vertical ? 'vertical-rl' : undefined,
        transform: text().vertical === 'up' ? 'rotate(180deg)' : undefined,
      }}
    >
      <For each={paragraphs()}>
        {(paragraph) => (
          <div style={{ 'text-align': paragraph.align ?? 'left' }}>
            <Show
              when={paragraph.runs.length}
              fallback={
                <span style={{ 'font-size': size(paragraph.size) }}>{'​'}</span>
              }
            >
              <For each={paragraph.runs}>
                {(run) => <span style={runStyle(run)}>{run.text}</span>}
              </For>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

/**
 * Excel shapes, text boxes and lines, and groups of them, in a box of
 * `width` by `height` pixels. `linked` reads the cells text links show.
 */
export function SpreadsheetShape(props: {
  shape: SheetShape;
  width: number;
  height: number;
  scale: number;
  font?: string;
  linked?: (reference: string) => string | undefined;
}) {
  return (
    <div class="pointer-events-none relative size-full">
      <For each={props.shape.parts}>
        {(part) => {
          const width = () => Math.max(0, part.width * props.width);
          const height = () => Math.max(0, part.height * props.height);
          return (
            <div
              class="absolute"
              style={{
                left: `${part.x * props.width}px`,
                top: `${part.y * props.height}px`,
                width: `${width()}px`,
                height: `${height()}px`,
                transform: part.rotation
                  ? `rotate(${part.rotation}deg)`
                  : undefined,
              }}
            >
              <Outline
                part={part}
                width={width()}
                height={height()}
                scale={props.scale}
              />
              <Show when={part.text}>
                <Text
                  part={part}
                  scale={props.scale}
                  font={props.font}
                  linked={
                    part.text?.link ? props.linked?.(part.text.link) : undefined
                  }
                />
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}

/**
 * A shape drawing's words, for its accessible name; `linked` reads the
 * cells text links show.
 */
export function shapeText(
  shape: SheetShape,
  linked?: (reference: string) => string | undefined
): string {
  return shape.parts
    .flatMap((part) => {
      const link = part.text?.link && linked?.(part.text.link);
      if (link !== undefined && link !== '') return [link];
      return (part.text?.paragraphs ?? []).map((paragraph) =>
        paragraph.runs.map((run) => run.text).join('')
      );
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
