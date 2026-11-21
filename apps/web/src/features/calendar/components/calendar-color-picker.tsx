import ResetIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Popover } from '@kobalte/core/popover';
import { Slider } from '@kobalte/core/slider';
import { cn } from '@ui/utils/classname';
import { createSignal, For, Show } from 'solid-js';
import {
  type CalendarColor,
  calendarColorHex,
  normalizeCalendarHex,
  parseCalendarColor,
} from '../core/calendar-color';

const SWATCHES = [
  { name: 'Rose', color: '#ed6a86' },
  { name: 'Tangerine', color: '#f49259' },
  { name: 'Honey', color: '#edc35a' },
  { name: 'Sage', color: '#8bbf96' },
  { name: 'Seafoam', color: '#57b6b0' },
  { name: 'Sky', color: '#75b7e5' },
  { name: 'Blue', color: '#5c8aee' },
  { name: 'Iris', color: '#9382e8' },
  { name: 'Orchid', color: '#c48dd5' },
  { name: 'Blush', color: '#dba3b3' },
  { name: 'Clay', color: '#b39583' },
  { name: 'Slate', color: '#8d9aa9' },
];

/** Keys that move a slider; the color saves once the key is released. */
const SLIDER_KEYS = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
];

/**
 * Picks a calendar's color. Dragging previews in the picker and saves once on
 * release, so a drag is one save. `compact` draws the trigger as the small
 * square calendar rows show beside a calendar's name.
 */
export function CalendarColorPicker(props: {
  label: string;
  color: string;
  overridden: boolean;
  onChange: (color: string | undefined) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const [color, setColor] = createSignal<CalendarColor>({
    hue: 210,
    saturation: 0.6,
    brightness: 0.9,
  });
  const [draft, setDraft] = createSignal<string>();
  const [invalid, setInvalid] = createSignal(false);
  let swatch!: HTMLSpanElement;
  let dragging: number | undefined;
  const hex = () => calendarColorHex(color());
  const hueColor = () => `hsl(${color().hue} 100% 50%)`;
  const preview = (next: CalendarColor) => {
    setColor(next);
    setDraft(undefined);
    setInvalid(false);
  };
  const commit = () => props.onChange(hex());
  const change = (next: CalendarColor) => {
    preview(next);
    commit();
  };
  const changeHex = (value: string) => {
    const next = parseCalendarColor(value);
    // Keep the chosen hue when the color field reaches gray, white, or black.
    if (next.saturation === 0) next.hue = color().hue;
    change(next);
  };
  const commitHex = () => {
    const value = draft();
    if (value === undefined) return;
    const normalized = normalizeCalendarHex(value);
    if (!normalized) {
      setInvalid(true);
      return;
    }
    changeHex(normalized);
  };
  const colorAtPointer = (
    event: PointerEvent & { currentTarget: HTMLDivElement }
  ): CalendarColor | undefined => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    return {
      ...color(),
      saturation: Math.max(
        0,
        Math.min(1, (event.clientX - rect.left) / rect.width)
      ),
      brightness:
        1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };
  const previewAtPointer = (
    event: PointerEvent & { currentTarget: HTMLDivElement }
  ) => {
    const next = colorAtPointer(event);
    if (next) preview(next);
  };
  return (
    <Popover
      placement={props.compact ? 'bottom-start' : 'bottom-end'}
      gutter={props.compact ? 6 : 10}
      open={open()}
      onOpenChange={(value) => {
        if (value) {
          setColor(
            parseCalendarColor(
              normalizeCalendarHex(props.color) ??
                getComputedStyle(swatch).backgroundColor
            )
          );
          setDraft(undefined);
          setInvalid(false);
        }
        setOpen(value);
      }}
    >
      <Popover.Trigger
        aria-label={props.label}
        title={props.label}
        class={cn(
          'flex shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-accent',
          props.compact
            ? 'size-5 rounded-md not-touch:hover:bg-ink/10 data-expanded:bg-ink/10 touch:size-11 touch:rounded-full'
            : 'size-8 rounded-full hover:bg-ink/5 data-expanded:bg-ink/5'
        )}
      >
        <Show
          when={props.compact}
          fallback={
            <span
              ref={swatch}
              class="size-5 rounded-full border border-ink/10 transition-transform hover:scale-110"
              style={{ 'background-color': props.color }}
            />
          }
        >
          <span
            ref={swatch}
            class="size-2.5 rounded-sm"
            style={{ 'background-color': props.color }}
          />
        </Show>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="menu-surface z-action-menu w-72 max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto p-3 outline-none menu-open-animation">
          <div class="mb-3 flex items-start justify-between gap-2 px-1">
            <div class="min-w-0">
              <Popover.Title class="text-sm font-medium">
                Calendar color
              </Popover.Title>
              <Popover.Description
                class="mt-0.5 truncate text-xs text-ink-muted"
                title={props.label}
              >
                {props.label}
              </Popover.Description>
            </div>
            <Popover.CloseButton
              aria-label="Close color picker"
              class="flex size-6 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
            >
              <CloseIcon class="size-3.5" />
            </Popover.CloseButton>
          </div>
          <div
            role="slider"
            tabIndex={0}
            aria-label="Saturation and brightness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(color().saturation * 100)}
            aria-valuetext={`${Math.round(color().saturation * 100)}% saturation, ${Math.round(color().brightness * 100)}% brightness`}
            class="relative h-44 w-full touch-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ring-offset-menu"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hueColor()}`,
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.focus({ preventScroll: true });
              event.currentTarget.setPointerCapture(event.pointerId);
              dragging = event.pointerId;
              previewAtPointer(event);
            }}
            onPointerMove={(event) => {
              if (dragging === event.pointerId) previewAtPointer(event);
            }}
            onPointerUp={(event) => {
              if (dragging !== event.pointerId) return;
              previewAtPointer(event);
              commit();
              dragging = undefined;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              dragging = undefined;
            }}
            onLostPointerCapture={() => {
              dragging = undefined;
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 0.1 : 0.01;
              const next = { ...color() };
              switch (event.key) {
                case 'ArrowLeft':
                  next.saturation = Math.max(0, next.saturation - step);
                  break;
                case 'ArrowRight':
                  next.saturation = Math.min(1, next.saturation + step);
                  break;
                case 'ArrowUp':
                  next.brightness = Math.min(1, next.brightness + step);
                  break;
                case 'ArrowDown':
                  next.brightness = Math.max(0, next.brightness - step);
                  break;
                default:
                  return;
              }
              event.preventDefault();
              preview(next);
            }}
            onKeyUp={(event) => {
              if (SLIDER_KEYS.includes(event.key)) commit();
            }}
          >
            <span
              class="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-md"
              style={{
                left: `${color().saturation * 100}%`,
                top: `${(1 - color().brightness) * 100}%`,
                'background-color': hex(),
                'border-color': '#fff',
                'box-shadow': '0 0 0 1px #0003, 0 2px 5px #0004',
              }}
            />
          </div>
          <Slider
            minValue={0}
            maxValue={360}
            step={1}
            value={[color().hue]}
            aria-label="Hue"
            onChange={([hue]) => preview({ ...color(), hue: hue ?? 0 })}
            onChangeEnd={commit}
            onKeyUp={(event) => {
              if (SLIDER_KEYS.includes(event.key)) commit();
            }}
            class="my-4 flex h-5 touch-none items-center px-1.5"
          >
            <Slider.Track
              class="relative h-2.5 w-full rounded-full"
              style={{
                background:
                  'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
              }}
            >
              <Slider.Thumb
                aria-label="Hue"
                class="top-1/2 size-4 -translate-y-1/2 rounded-full border-2 outline-none focus-visible:ring-2 focus-visible:ring-accent"
                style={{
                  'background-color': hueColor(),
                  'border-color': '#fff',
                  'box-shadow': '0 1px 4px #0006',
                }}
              >
                <Slider.Input />
              </Slider.Thumb>
            </Slider.Track>
          </Slider>
          <div class="flex items-center gap-3 rounded-lg border border-edge-muted px-3 py-2 focus-within:border-accent">
            <span
              class="size-5 shrink-0 rounded-md border border-ink/10"
              style={{ 'background-color': hex() }}
            />
            <span class="text-xs text-ink-muted">HEX</span>
            <input
              aria-label="Hex color"
              aria-invalid={invalid()}
              class="min-w-0 flex-1 bg-transparent text-right font-mono text-sm uppercase outline-none aria-invalid:text-failure"
              value={draft() ?? hex()}
              spellcheck={false}
              maxLength={7}
              onInput={(event) => {
                setDraft(event.currentTarget.value);
                setInvalid(false);
              }}
              onBlur={commitHex}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitHex();
                }
              }}
            />
          </div>
          <div
            class="mt-4 grid grid-cols-6 gap-2"
            aria-label="Suggested colors"
          >
            <For each={SWATCHES}>
              {(item) => (
                <button
                  type="button"
                  aria-label={item.name}
                  title={item.name}
                  aria-pressed={hex().toLowerCase() === item.color}
                  onClick={() => changeHex(item.color)}
                  class="flex size-8 items-center justify-center justify-self-center rounded-full border border-ink/10 outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ring-offset-menu aria-pressed:ring-2 aria-pressed:ring-ink/40 aria-pressed:ring-offset-2"
                >
                  <span
                    class="flex size-full items-center justify-center rounded-full"
                    style={{ 'background-color': item.color }}
                  >
                    <CheckIcon
                      class="size-4"
                      style={{
                        color: '#111',
                        visibility:
                          hex().toLowerCase() === item.color
                            ? 'visible'
                            : 'hidden',
                      }}
                    />
                  </span>
                </button>
              )}
            </For>
          </div>
          <button
            type="button"
            disabled={!props.overridden}
            aria-label={`Reset ${props.label}`}
            onClick={() => {
              props.onChange(undefined);
              setOpen(false);
            }}
            class="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs text-ink-muted hover:bg-hover disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ResetIcon class="size-3.5" /> Reset to default
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
