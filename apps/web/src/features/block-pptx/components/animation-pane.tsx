/**
 * The Animation Pane, the numbered tags beside animated shapes on the
 * slide, and the in-place animation preview.
 */

import type {
  AnimationOutline,
  DeckOutline,
  ShapeOutline,
  SlideOutline,
} from '@core/pptx-engine/types';
import ArrowDown from '@phosphor/arrow-down.svg';
import ArrowUp from '@phosphor/arrow-up.svg';
import Clock from '@phosphor/clock.svg';
import Play from '@phosphor/play.svg';
import Trash from '@phosphor/trash.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';
import { clickNumbers, effectLabel } from '../core/animation-catalog';
import {
  buildTimeline,
  clickSteps,
  groupLength,
} from '../core/animation-timeline';
import { AnimationIcon } from './ribbon/animations-tab';
import type { RibbonEnv } from './ribbon/ribbon';
import { ShowCanvas } from './show-canvas';

/** A shape on the slide by id, groups searched. */
function findShape(
  shapes: ShapeOutline[],
  id: number
): ShapeOutline | undefined {
  for (const s of shapes) {
    if (s.id === id) return s;
    const inner = s.children && findShape(s.children, id);
    if (inner) return inner;
  }
  return undefined;
}

/** What a pane row says the animation acts on. */
function targetName(slide: SlideOutline, a: AnimationOutline): string {
  const shape = findShape(slide.shapes, a.shapeId);
  const name = shape?.name ?? `Shape ${a.shapeId}`;
  if (a.paragraph === undefined) return name;
  const text = shape?.paragraphs?.[a.paragraph]?.text.trim();
  return text ? `${name}: ${text}` : `${name}: paragraph ${a.paragraph + 1}`;
}

export function AnimationPane(props: {
  env: RibbonEnv;
  onSelectShape: (id: number) => void;
  onClose: () => void;
}) {
  const env = props.env;
  const anim = env.animation;
  const c = env.commands;
  const ro = () => env.readonly();
  const animations = () => env.slide()?.animations ?? [];
  const numbers = () => clickNumbers(animations());
  return (
    <aside
      class="flex w-72 shrink-0 flex-col border-edge-muted border-l bg-panel"
      data-testid="pptx-animation-pane"
      aria-label="Animation pane"
    >
      <div class="flex h-9 items-center justify-between border-edge-muted border-b px-3">
        <span class="font-semibold text-ink text-sm">Animation Pane</span>
        <Button
          size="icon-sm"
          variant="ghost"
          label="Close"
          onClick={props.onClose}
        >
          <X />
        </Button>
      </div>
      <div class="flex items-center gap-1 border-edge-muted border-b px-2 py-1.5">
        <Button
          size="sm"
          variant="outline"
          data-testid="pptx-animation-play"
          disabled={animations().length === 0}
          onClick={anim.preview}
        >
          <Play />
          Play All
        </Button>
        <div class="flex-1" />
        <Button
          size="icon-sm"
          variant="ghost"
          label="Move earlier"
          tooltip="Move Earlier"
          disabled={ro() || (anim.picked() ?? 0) === 0}
          onClick={() => {
            const i = anim.picked();
            if (i !== undefined)
              void c.moveAnimation(i, -1).then(() => anim.pick(i - 1));
          }}
        >
          <ArrowUp />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          label="Move later"
          tooltip="Move Later"
          disabled={
            ro() ||
            anim.picked() === undefined ||
            anim.picked()! >= animations().length - 1
          }
          onClick={() => {
            const i = anim.picked();
            if (i !== undefined)
              void c.moveAnimation(i, 1).then(() => anim.pick(i + 1));
          }}
        >
          <ArrowDown />
        </Button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-1" role="listbox">
        <Show
          when={animations().length > 0}
          fallback={
            <p class="p-3 text-ink-muted text-xs">
              Select an object on the slide and pick an effect on the Animations
              tab to animate it.
            </p>
          }
        >
          <For each={animations()}>
            {(a, i) => (
              <div
                role="option"
                tabIndex={-1}
                aria-selected={anim.picked() === i()}
                data-testid="pptx-animation-row"
                data-index={i()}
                class="group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-ink text-xs hover:bg-ink/5"
                classList={{ 'bg-accent-bg': anim.picked() === i() }}
                onClick={() => {
                  anim.pick(i());
                  props.onSelectShape(a.shapeId);
                }}
                onKeyDown={(e) => {
                  if ((e.key === 'Delete' || e.key === 'Backspace') && !ro())
                    void c.removeAnimations([i()]).then(() => anim.pick());
                }}
              >
                <span class="w-4 shrink-0 text-right text-ink-muted tabular-nums">
                  {a.start === 'onClick' ? numbers()[i()] : ''}
                </span>
                <span class="flex w-4 shrink-0 justify-center text-ink-muted">
                  <Show when={a.start === 'afterPrevious'}>
                    <Clock class="size-3" />
                  </Show>
                </span>
                <AnimationIcon class={a.class} />
                <span class="min-w-0 flex-1 truncate" title={effectLabel(a)}>
                  {targetName(env.slide()!, a)}
                </span>
                <span class="shrink-0 text-ink-muted">{effectLabel(a)}</span>
                <Show when={!ro()}>
                  <button
                    type="button"
                    class="hidden rounded p-0.5 text-ink-muted hover:text-ink group-hover:block"
                    aria-label="Remove animation"
                    data-testid="pptx-animation-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      void c.removeAnimations([i()]).then(() => anim.pick());
                    }}
                  >
                    <Trash class="size-3" />
                  </button>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </aside>
  );
}

/**
 * Numbered tags beside animated shapes, as PowerPoint shows them while the
 * Animations tab or pane is open (in slide points).
 */
export function AnimationTags(props: {
  slide: SlideOutline;
  width: number;
  height: number;
  unit: number;
  picked?: number;
}) {
  const tags = () => {
    const animations = props.slide.animations ?? [];
    const numbers = clickNumbers(animations);
    const byShape = new Map<number, { labels: number[]; picked: boolean }>();
    animations.forEach((a, i) => {
      const top = props.slide.shapes.find(
        (s) => s.id === a.shapeId || findShape(s.children ?? [], a.shapeId)
      );
      if (!top) return;
      const entry = byShape.get(top.id) ?? { labels: [], picked: false };
      if (!entry.labels.includes(numbers[i])) entry.labels.push(numbers[i]);
      entry.picked ||= props.picked === i;
      byShape.set(top.id, entry);
    });
    return [...byShape].map(([id, entry]) => {
      const shape = props.slide.shapes.find((s) => s.id === id)!;
      return { shape, text: entry.labels.join(', '), picked: entry.picked };
    });
  };
  const u = () => props.unit;
  return (
    <svg
      class="pointer-events-none absolute inset-0 size-full overflow-visible"
      viewBox={`0 0 ${props.width} ${props.height}`}
      aria-hidden="true"
    >
      <For each={tags()}>
        {(tag) => {
          const w = () => (6 + tag.text.length * 6.5) * u();
          return (
            <g data-testid="pptx-animation-tag">
              <rect
                x={tag.shape.x - w() - 2 * u()}
                y={tag.shape.y}
                width={w()}
                height={14 * u()}
                rx={2 * u()}
                class={tag.picked ? 'fill-accent' : 'fill-ink-muted'}
                fill-opacity="0.9"
              />
              <text
                x={tag.shape.x - w() / 2 - 2 * u()}
                y={tag.shape.y + 10.5 * u()}
                class="fill-page font-sans"
                style={{
                  'text-anchor': 'middle',
                  'font-size': `${10 * u()}px`,
                }}
              >
                {tag.text}
              </text>
            </g>
          );
        }}
      </For>
    </svg>
  );
}

/** Plays a slide's animations in place, click after click, then closes. */
export function AnimationPreview(props: {
  engine: PresentationEngine;
  deck: DeckOutline;
  index: number;
  width: number;
  height: number;
  onDone: () => void;
}) {
  const [step, setStep] = createSignal(0);
  onMount(() => {
    const slide = props.deck.slides[props.index];
    const timeline = slide ? buildTimeline(slide) : undefined;
    if (!timeline) {
      props.onDone();
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const next = (s: number) => {
      const wait = groupLength(timeline.groups[s] ?? []) + 250;
      timer = setTimeout(() => {
        if (s >= clickSteps(timeline)) props.onDone();
        else {
          setStep(s + 1);
          next(s + 1);
        }
      }, wait);
    };
    next(0);
    onCleanup(() => clearTimeout(timer));
  });
  return (
    <div
      class="absolute inset-0 z-10 flex items-center justify-center"
      data-testid="pptx-animation-preview-stage"
      onPointerDown={() => props.onDone()}
    >
      <ShowCanvas
        engine={props.engine}
        deck={props.deck}
        index={props.index}
        step={step()}
        width={props.width}
        height={props.height}
        pixelRatio={window.devicePixelRatio || 1}
        transitions={false}
        testId="pptx-animation-preview-canvas"
      />
    </div>
  );
}
