/**
 * The Animations tab: PowerPoint's animation gallery (entrance, emphasis,
 * exit, and motion path effects), effect options, Add Animation, the
 * Animation Pane, timing, reordering, and preview.
 */

import type {
  AnimationClass,
  AnimationOutline,
  AnimationStart,
} from '@core/pptx-engine/types';
import ArrowDown from '@phosphor/arrow-down.svg';
import ArrowUp from '@phosphor/arrow-up.svg';
import ListNumbers from '@phosphor/list-numbers.svg';
import Play from '@phosphor/play.svg';
import Plus from '@phosphor/plus.svg';
import Sliders from '@phosphor/sliders-horizontal.svg';
import Star from '@phosphor-fill/star-fill.svg';
import { For, type JSX, Show } from 'solid-js';
import {
  CLASS_LABELS,
  EFFECTS,
  effectInfo,
  effectLabel,
} from '../../core/animation-catalog';
import {
  NumberField,
  PopoverLabel,
  RibbonButton,
  RibbonGroup,
  RibbonPopover,
  RibbonTextButton,
} from './controls';
import { useRibbon } from './ribbon';

const CLASS_COLORS: Record<string, string> = {
  entrance: '#3fa34d',
  emphasis: '#e2a400',
  exit: '#d64545',
  path: '#7a7a7a',
  media: '#7a7a7a',
  other: '#7a7a7a',
};

/** PowerPoint's colored star for an animation class. */
export function AnimationIcon(props: { class: string }) {
  return (
    <Show
      when={props.class !== 'path'}
      fallback={
        <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true">
          <path
            d="M2 13 C6 13 6 3 13 3"
            fill="none"
            stroke={CLASS_COLORS.path}
            stroke-width="1.5"
            stroke-dasharray="2 1.5"
          />
          <circle cx="2" cy="13" r="1.6" fill="#3fa34d" />
          <circle cx="13" cy="3" r="1.6" fill="#d64545" />
        </svg>
      }
    >
      <Star class="size-4" style={{ color: CLASS_COLORS[props.class] }} />
    </Show>
  );
}

const START_LABELS: Record<AnimationStart, string> = {
  onClick: 'On Click',
  withPrevious: 'With Previous',
  afterPrevious: 'After Previous',
};

/** The effect gallery: None, then each class's effects. */
function Gallery(props: {
  current?: AnimationOutline;
  showNone: boolean;
  onPick: (cls: AnimationClass, effect: string) => void;
  testId: string;
}) {
  const groups = ['entrance', 'emphasis', 'exit', 'path'] as const;
  return (
    <div
      class="flex max-h-[70vh] w-[34rem] flex-col gap-2 overflow-y-auto"
      data-testid={props.testId}
    >
      <Show when={props.showNone}>
        <div class="grid grid-cols-6 gap-1">
          <Tile
            label="None"
            testId="pptx-animation-none"
            onClick={() => props.onPick('entrance', 'none')}
            icon={<span class="size-4 rounded-full border border-edge" />}
          />
        </div>
      </Show>
      <For each={groups}>
        {(cls) => (
          <div>
            <PopoverLabel>{CLASS_LABELS[cls]}</PopoverLabel>
            <div class="grid grid-cols-6 gap-1">
              <For each={EFFECTS.filter((e) => e.class === cls)}>
                {(e) => (
                  <Tile
                    label={e.label}
                    active={
                      props.current?.class === e.class &&
                      props.current.effect === e.effect
                    }
                    testId={`pptx-animation-${e.class}-${e.effect}`}
                    onClick={() => props.onPick(e.class, e.effect)}
                    icon={<AnimationIcon class={e.class} />}
                  />
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

function Tile(props: {
  label: string;
  icon: JSX.Element;
  active?: boolean;
  testId?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class="flex h-14 flex-col items-center justify-center gap-1 rounded-md px-1 text-center text-[11px] text-ink leading-tight hover:bg-ink/5"
      classList={{ 'bg-accent-bg text-accent': props.active }}
      data-testid={props.testId}
      onClick={() => props.onClick()}
    >
      {props.icon}
      {props.label}
    </button>
  );
}

export function AnimationsTab() {
  const env = useRibbon();
  const c = env.commands;
  const ro = () => env.readonly();
  const anim = env.animation;
  const hasTarget = () => env.selection().length > 0;
  const current = () => {
    const i = anim.current();
    return i === undefined ? undefined : env.slide()?.animations?.[i];
  };
  /** The current animation and those of the same shape set (timing edits). */
  const indexes = () => anim.selected();
  const info = () => {
    const a = current();
    return a ? effectInfo(a.class, a.effect) : undefined;
  };
  const textShape = () => {
    const a = current();
    const shape = env.selection().find((s) => s.id === a?.shapeId);
    return shape?.textEditable && (shape.paragraphs?.length ?? 0) > 1
      ? shape
      : undefined;
  };
  return (
    <>
      <RibbonGroup label="Preview">
        <RibbonTextButton
          label="Preview"
          tooltip="Preview the slide's animations"
          data-testid="pptx-animation-preview"
          disabled={!env.slide()?.animations?.length}
          onClick={anim.preview}
        >
          <Play />
          Preview
        </RibbonTextButton>
      </RibbonGroup>
      <RibbonGroup label="Animation">
        <RibbonPopover
          label="Animation styles"
          text={current() ? effectLabel(current()!) : 'Animations'}
          icon={<AnimationIcon class={current()?.class ?? 'entrance'} />}
          disabled={ro() || !hasTarget()}
          testId="pptx-animation-gallery"
        >
          {(close) => (
            <Gallery
              current={current()}
              showNone
              testId="pptx-animation-gallery-panel"
              onPick={(cls, effect) => {
                close();
                void c.animate(cls, effect, 'replace', anim.picked());
              }}
            />
          )}
        </RibbonPopover>
        <RibbonPopover
          label="Effect options"
          text="Effect Options"
          icon={<Sliders />}
          disabled={ro() || !current() || (!info()?.options && !textShape())}
          testId="pptx-animation-options"
        >
          {(close) => (
            <div class="flex w-56 flex-col">
              <Show when={info()?.options}>
                {(options) => (
                  <>
                    <PopoverLabel>Direction</PopoverLabel>
                    <For each={options()}>
                      {(o) => (
                        <button
                          type="button"
                          class="rounded-md px-2 py-1.5 text-left text-ink text-xs hover:bg-ink/5"
                          classList={{
                            'bg-accent-bg text-accent':
                              (current()?.direction ?? options()[0].value) ===
                              o.value,
                          }}
                          data-testid={`pptx-animation-option-${o.value}`}
                          onClick={() => {
                            close();
                            void c.updateAnimations(indexes(), {
                              direction: o.value,
                            });
                          }}
                        >
                          {o.label}
                        </button>
                      )}
                    </For>
                  </>
                )}
              </Show>
              <Show when={textShape()}>
                {(shape) => (
                  <>
                    <PopoverLabel>Sequence</PopoverLabel>
                    <button
                      type="button"
                      class="rounded-md px-2 py-1.5 text-left text-ink text-xs hover:bg-ink/5"
                      data-testid="pptx-animation-sequence-object"
                      onClick={() => {
                        close();
                        void c.setSequence(shape(), false);
                      }}
                    >
                      As One Object
                    </button>
                    <button
                      type="button"
                      class="rounded-md px-2 py-1.5 text-left text-ink text-xs hover:bg-ink/5"
                      data-testid="pptx-animation-sequence-paragraph"
                      onClick={() => {
                        close();
                        void c.setSequence(shape(), true);
                      }}
                    >
                      By Paragraph
                    </button>
                  </>
                )}
              </Show>
            </div>
          )}
        </RibbonPopover>
      </RibbonGroup>
      <RibbonGroup label="Advanced Animation">
        <RibbonPopover
          label="Add animation"
          text="Add Animation"
          icon={<Plus />}
          disabled={ro() || !hasTarget()}
          testId="pptx-animation-add"
        >
          {(close) => (
            <Gallery
              showNone={false}
              testId="pptx-animation-add-panel"
              onPick={(cls, effect) => {
                close();
                void c.animate(cls, effect, 'add');
              }}
            />
          )}
        </RibbonPopover>
        <RibbonTextButton
          label="Animation pane"
          variant={anim.pane() ? 'accent' : 'ghost'}
          aria-pressed={anim.pane()}
          data-testid="pptx-animation-pane-toggle"
          onClick={anim.togglePane}
        >
          <ListNumbers />
          Animation Pane
        </RibbonTextButton>
      </RibbonGroup>
      <RibbonGroup label="Timing">
        <label class="flex items-center gap-1 text-ink-muted text-xs">
          Start
          <select
            class="h-7 rounded-md border border-edge-muted bg-input px-1 text-ink text-xs"
            data-testid="pptx-animation-start"
            disabled={ro() || !current()}
            value={current()?.start ?? 'onClick'}
            onChange={(e) =>
              void c.updateAnimations(indexes(), {
                start: e.currentTarget.value as AnimationStart,
              })
            }
          >
            <For each={Object.entries(START_LABELS)}>
              {([value, label]) => <option value={value}>{label}</option>}
            </For>
          </select>
        </label>
        <span class="text-ink-muted text-xs">Duration</span>
        <NumberField
          label="Duration"
          unit="s"
          value={current() ? current()!.durationMs / 1000 : undefined}
          min={0.01}
          max={59}
          step={0.25}
          precision={2}
          width="4.5rem"
          disabled={ro() || !current() || current()!.durationMs === 0}
          testId="pptx-animation-duration"
          onCommit={(v) =>
            void c.updateAnimations(indexes(), {
              durationMs: Math.round(v * 1000),
            })
          }
        />
        <span class="text-ink-muted text-xs">Delay</span>
        <NumberField
          label="Delay"
          unit="s"
          value={current() ? current()!.delayMs / 1000 : undefined}
          min={0}
          max={59}
          step={0.25}
          precision={2}
          width="4.5rem"
          disabled={ro() || !current()}
          testId="pptx-animation-delay"
          onCommit={(v) =>
            void c.updateAnimations(indexes(), {
              delayMs: Math.round(v * 1000),
            })
          }
        />
        <RibbonButton
          label="Move earlier"
          tooltip="Move Earlier"
          data-testid="pptx-animation-earlier"
          disabled={ro() || (anim.current() ?? 0) === 0}
          onClick={() => {
            const i = anim.current();
            if (i === undefined) return;
            void c.moveAnimation(i, -1).then(() => anim.pick(i - 1));
          }}
        >
          <ArrowUp />
        </RibbonButton>
        <RibbonButton
          label="Move later"
          tooltip="Move Later"
          data-testid="pptx-animation-later"
          disabled={
            ro() ||
            anim.current() === undefined ||
            anim.current()! >= (env.slide()?.animations?.length ?? 0) - 1
          }
          onClick={() => {
            const i = anim.current();
            if (i === undefined) return;
            void c.moveAnimation(i, 1).then(() => anim.pick(i + 1));
          }}
        >
          <ArrowDown />
        </RibbonButton>
      </RibbonGroup>
    </>
  );
}
