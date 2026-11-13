import ArrowDown from '@icon/system/regular/arrow-down.svg';
import ArrowLeft from '@icon/system/regular/arrow-left.svg';
import ArrowRight from '@icon/system/regular/arrow-right.svg';
import ArrowUp from '@icon/system/regular/arrow-up.svg';
import Play from '@icon/system/regular/play.svg';
import Timer from '@icon/system/regular/timer.svg';
import {
  CANVAS_TRANSITION_KINDS,
  CLASSIC_TRANSITION_KINDS,
  DIRECTIONAL_TRANSITION_KINDS,
  type ResolvedSlideTransition,
  type SlideTransition,
  type SlideTransitionKind,
  TRANSITION_DURATION_MAX_MS,
  TRANSITION_DURATION_MIN_MS,
  type TransitionDirection,
  type TransitionEasing,
} from '@macro-inc/graphics';
import { Button, Tabs, Tooltip } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { InspectorField } from './inspector-field';
import { InspectorNumberField } from './inspector-number-field';
import { InspectorSection } from './inspector-section';
import { InspectorSelect } from './inspector-select';
import { TransitionThumbnail } from './transition-thumbnail';

const KINDS: Record<SlideTransitionKind, { label: string; hint: string }> = {
  none: { label: 'Cut', hint: 'Switch instantly' },
  fade: { label: 'Fade', hint: 'Fade the next slide in' },
  fadeThroughBlack: { label: 'Dip', hint: 'Fade through black' },
  dissolve: { label: 'Dissolve', hint: 'Blur one slide into the next' },
  push: { label: 'Push', hint: 'The next slide pushes this one off' },
  cover: { label: 'Cover', hint: 'The next slide slides in over this one' },
  uncover: {
    label: 'Uncover',
    hint: 'This slide slides away to reveal the next',
  },
  wipe: {
    label: 'Wipe',
    hint: 'An edge sweeps across to reveal the next slide',
  },
  split: { label: 'Split', hint: 'Open from, or close onto, the center' },
  iris: { label: 'Iris', hint: 'A circle opens from the center' },
  zoom: { label: 'Zoom', hint: 'Zoom through to the next slide' },
  flip: { label: 'Flip', hint: 'Turn the slide over like a card' },
  cube: { label: 'Cube', hint: 'Turn to the next face of a cube' },
  pan: { label: 'Pan', hint: 'Glide across the canvas to the next slide' },
  fly: { label: 'Fly', hint: 'Pull back, travel and settle on the next slide' },
  overview: {
    label: 'Overview',
    hint: 'Zoom out to the whole canvas, then in',
  },
  path: { label: 'Path', hint: 'Follow the arrow that connects the slides' },
};

const DIRECTIONS: {
  value: TransitionDirection;
  label: string;
  icon: typeof ArrowLeft;
}[] = [
  { value: 'left', label: 'Left', icon: ArrowLeft },
  { value: 'right', label: 'Right', icon: ArrowRight },
  { value: 'up', label: 'Up', icon: ArrowUp },
  { value: 'down', label: 'Down', icon: ArrowDown },
];

const EASINGS: { value: TransitionEasing; label: string }[] = [
  { value: 'easeInOut', label: 'Smooth' },
  { value: 'easeOut', label: 'Ease out' },
  { value: 'easeIn', label: 'Ease in' },
  { value: 'ease', label: 'Ease' },
  { value: 'linear', label: 'Linear' },
];

type TileValue = SlideTransitionKind | 'default';

/** Arrow keys move focus through the four-column tile grid. */
const ARROW_STEPS: Record<string, number | undefined> = {
  ArrowRight: 1,
  ArrowLeft: -1,
  ArrowDown: 4,
  ArrowUp: -4,
};

export const transitionKindLabel = (kind: SlideTransitionKind) =>
  KINDS[kind].label;

/**
 * How the presentation moves onto this slide: a grid of live thumbnails, then
 * timing and direction for the chosen kind. Each change is one edit.
 */
export function TransitionInspector(props: {
  /** The slide's own transition; undefined when it uses the deck default. */
  own: SlideTransition | undefined;
  deckDefault: SlideTransition | undefined;
  /** What plays into this slide. */
  effective: ResolvedSlideTransition;
  /** Undefined makes the slide use the deck default. */
  onChange: (transition: SlideTransition | undefined) => void;
  onApplyToAll?: () => void;
  onSetDeckDefault?: () => void;
  onPreview: () => void;
  /** The preview stage, shown under the controls once previewed. */
  preview?: JSX.Element;
}) {
  const [hovered, setHovered] = createSignal<TileValue>();
  const [tap, setTap] = createSignal<{ value: TileValue; count: number }>();
  const selected = (): TileValue => props.own?.kind ?? 'default';
  const tiles: TileValue[] = [
    'default',
    ...CLASSIC_TRANSITION_KINDS,
    ...CANVAS_TRANSITION_KINDS,
  ];
  const tileButtons: HTMLButtonElement[] = [];
  const [focusIndex, setFocusIndex] = createSignal<number>();

  /** The slide's transition with one field changed; an inherited one is
   * copied first so the edit keeps what was playing. */
  const edit = (patch: Partial<SlideTransition>) =>
    props.onChange({
      ...(props.own ?? { kind: props.effective.kind }),
      ...patch,
    });

  const choose = (value: TileValue) => {
    if (value === 'default') {
      props.onChange(undefined);
      return;
    }
    if (value === props.own?.kind) return;

    // A new kind starts from its own duration; easing and direction carry over.
    const { durationMs: _duration, ...kept } = props.own ?? { kind: value };
    props.onChange({ ...kept, kind: value });
  };

  const tileKind = (value: TileValue): SlideTransitionKind =>
    value === 'default' ? (props.deckDefault?.kind ?? 'none') : value;

  const moveFocus = (event: KeyboardEvent, index: number) => {
    const step = ARROW_STEPS[event.key];
    if (!step) return;

    event.preventDefault();
    event.stopPropagation();
    const next = Math.min(tiles.length - 1, Math.max(0, index + step));
    setFocusIndex(next);
    tileButtons[next]?.focus();
  };

  const tile = (value: TileValue, index: number) => {
    const kind = () => tileKind(value);
    const label = () => (value === 'default' ? 'Default' : KINDS[value].label);
    const hint = () =>
      value === 'default'
        ? `Use the deck default: ${KINDS[kind()].label}`
        : KINDS[value].hint;
    const playing = () => hovered() === value;
    const playCount = () => (tap()?.value === value ? (tap()?.count ?? 0) : 0);
    return (
      <Tooltip label={hint()} placement="top" class="block min-w-0">
        <button
          ref={(element) => {
            tileButtons[index] = element;
          }}
          type="button"
          role="radio"
          aria-checked={selected() === value}
          aria-label={value === 'default' ? hint() : label()}
          data-transition-tile={value}
          tabIndex={
            (focusIndex() ?? tiles.indexOf(selected())) === index ? 0 : -1
          }
          class="flex w-full min-w-0 flex-col items-center gap-1 rounded-md border px-0.5 pt-1.5 pb-1 outline-none touch:min-h-[44px] focus-visible:ring-2 focus-visible:ring-edge-muted"
          classList={{
            'border-ink bg-hover': selected() === value,
            'border-transparent not-touch:hover:bg-hover/60':
              selected() !== value,
          }}
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse') setHovered(value);
          }}
          onPointerLeave={() => setHovered(undefined)}
          onFocus={() => {
            setFocusIndex(index);
            setHovered(value);
          }}
          onBlur={() => setHovered(undefined)}
          onKeyDown={(event) => moveFocus(event, index)}
          onClick={() => {
            choose(value);
            // Touch has no hover: a tap also plays the tile once.
            setTap({ value, count: (tap()?.count ?? 0) + 1 });
          }}
        >
          <TransitionThumbnail
            kind={kind()}
            direction={props.effective.direction}
            playing={playing()}
            playCount={playCount()}
          />
          <span class="w-full truncate text-center text-[10px] leading-3 text-ink-muted">
            {label()}
          </span>
        </button>
      </Tooltip>
    );
  };

  const sourceNote = () => {
    if (!props.own)
      return `Uses the deck default: ${KINDS[props.effective.kind].label}`;
    if (!props.deckDefault) return 'No deck default';
    return `Deck default: ${KINDS[props.deckDefault.kind].label}`;
  };
  const directional = () =>
    DIRECTIONAL_TRANSITION_KINDS.has(props.effective.kind);

  return (
    <InspectorSection title="Transition">
      <div
        role="radiogroup"
        aria-label="Transition into this slide"
        class="space-y-2"
      >
        <InspectorField label="Classic">
          <div class="grid grid-cols-4 gap-1">
            <For each={tiles.slice(0, CLASSIC_TRANSITION_KINDS.length + 1)}>
              {(value, index) => tile(value, index())}
            </For>
          </div>
        </InspectorField>
        <InspectorField label="Across the canvas">
          <div class="grid grid-cols-4 gap-1">
            <For each={tiles.slice(CLASSIC_TRANSITION_KINDS.length + 1)}>
              {(value, index) =>
                tile(value, index() + CLASSIC_TRANSITION_KINDS.length + 1)
              }
            </For>
          </div>
        </InspectorField>
      </div>
      <p
        class="text-[10px] text-ink-muted"
        data-testid="canvas-transition-source"
      >
        {sourceNote()}
      </p>
      <Show when={props.effective.kind !== 'none'}>
        <div class="grid grid-cols-2 gap-2">
          <InspectorField label="Duration">
            <InspectorNumberField
              label="Transition duration"
              icon={<Timer class="size-3" />}
              value={props.effective.durationMs / 1000}
              min={TRANSITION_DURATION_MIN_MS / 1000}
              max={TRANSITION_DURATION_MAX_MS / 1000}
              step={0.1}
              unit="s"
              onChange={(seconds) =>
                edit({ durationMs: Math.round(seconds * 10) * 100 })
              }
            />
          </InspectorField>
          <InspectorField label="Easing">
            <InspectorSelect
              label="Transition easing"
              value={props.effective.easing}
              options={EASINGS}
              onChange={(easing) => edit({ easing })}
            />
          </InspectorField>
        </div>
        <Show when={directional()}>
          <InspectorField label="Direction">
            <Tabs
              aria-label="Transition direction"
              size="sm"
              iconOnly
              options={DIRECTIONS}
              value={props.effective.direction}
              onChange={(direction) => edit({ direction })}
            />
          </InspectorField>
        </Show>
      </Show>
      <div class="flex flex-wrap gap-1">
        <Button variant="ghost" size="sm" onClick={props.onPreview}>
          <Play class="size-3 shrink-0" />
          Preview
        </Button>
        <Show when={props.onApplyToAll}>
          {(apply) => (
            <Button variant="ghost" size="sm" onClick={apply()}>
              Apply to all
            </Button>
          )}
        </Show>
        <Show when={props.onSetDeckDefault}>
          {(setDefault) => (
            <Button
              variant="ghost"
              size="sm"
              disabled={!props.own}
              onClick={setDefault()}
            >
              Set default
            </Button>
          )}
        </Show>
      </div>
      {props.preview}
    </InspectorSection>
  );
}
