import * as Slider from '@kobalte/core/slider';
import {
  batch,
  type ComponentProps,
  createContext,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  splitProps,
  useContext,
} from 'solid-js';
import { match } from 'ts-pattern';
import { cn } from '../utils/classname';
import {
  normalizePickerColor,
  type PickerColor,
  parsePickerColor,
  pickerColorToHex,
  preservePickerHue,
} from '../utils/color';

export type ColorPickerRootProps = Omit<ComponentProps<'div'>, 'onChange'> & {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Runs once when a drag or keyboard edit ends, or a text value is committed. */
  onChangeEnd?: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
};

type PickerContext = {
  color: () => PickerColor;
  value: () => string;
  disabled: () => boolean;
  readOnly: () => boolean;
  locked: () => boolean;
  set: (color: PickerColor) => void;
  finish: () => void;
};

const Context = createContext<PickerContext>();

function usePicker() {
  const context = useContext(Context);
  if (!context) throw new Error('ColorPicker slots require ColorPicker.Root');
  return context;
}

function Root(props: ColorPickerRootProps) {
  const [local, rest] = splitProps(props, [
    'value',
    'defaultValue',
    'onChange',
    'onChangeEnd',
    'disabled',
    'readOnly',
    'children',
    'class',
  ]);
  const fallback: PickerColor = { h: 0, s: 0, v: 0, a: 1 };
  const [internal, setInternal] = createSignal(local.defaultValue ?? '#000000');
  const [draft, setDraft] = createSignal(
    parsePickerColor(local.value ?? internal()) ?? fallback
  );
  const color = createMemo<PickerColor>((previous) => {
    const parsed = parsePickerColor(local.value ?? internal()) ?? fallback;
    const pending = draft();
    // Echoing hex loses hue in gray/black and rounds channels. Keep the exact
    // picker position until the host supplies a different color.
    if (pickerColorToHex(parsed) === pickerColorToHex(pending)) return pending;
    return preservePickerHue(parsed, previous ?? pending);
  });
  let changed = false;
  const context: PickerContext = {
    color,
    value: () => pickerColorToHex(color()),
    disabled: () => !!local.disabled,
    readOnly: () => !!local.readOnly,
    locked: () => !!local.disabled || !!local.readOnly,
    set(next) {
      if (context.locked()) return;
      const output = pickerColorToHex(next);
      const previous = context.value();
      batch(() => {
        setDraft(next);
        if (local.value === undefined) setInternal(output);
        if (output !== previous) {
          changed = true;
          local.onChange?.(output);
        }
      });
    },
    finish() {
      if (!changed) return;
      changed = false;
      local.onChangeEnd?.(context.value());
    },
  };
  return (
    <Context.Provider value={context}>
      <div
        role="group"
        aria-label="Color picker"
        data-color-picker
        data-disabled={local.disabled || undefined}
        data-readonly={local.readOnly || undefined}
        class={cn(
          'flex flex-col gap-3 text-ink data-disabled:opacity-50',
          local.class
        )}
        {...rest}
      >
        {local.children}
      </div>
    </Context.Provider>
  );
}

type SlotProps = Omit<ComponentProps<'div'>, 'children' | 'style'> & {
  style?: JSX.CSSProperties;
};

export type ColorPickerFieldProps = SlotProps;

function Field(props: ColorPickerFieldProps) {
  const context = usePicker();
  const [local, rest] = splitProps(props, ['class', 'style', 'aria-label']);
  let saturationInput!: HTMLInputElement;
  let pointer:
    | { id: number; start: PickerColor; target: HTMLDivElement }
    | undefined;
  const updatePointer = (event: PointerEvent, target: HTMLDivElement) => {
    const bounds = target.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const clamp = (number: number) => Math.max(0, Math.min(1, number));
    context.set({
      ...context.color(),
      s: clamp((event.clientX - bounds.left) / bounds.width),
      v: 1 - clamp((event.clientY - bounds.top) / bounds.height),
    });
  };
  const endPointer = (cancel = false) => {
    if (!pointer) return;
    const active = pointer;
    pointer = undefined;
    if (cancel) context.set(active.start);
    if (active.target.hasPointerCapture?.(active.id))
      active.target.releasePointerCapture(active.id);
    context.finish();
  };
  onCleanup(() => endPointer());
  const keyDown = (event: KeyboardEvent, channel: 's' | 'v') => {
    if (event.key === 'Escape' && pointer) {
      event.preventDefault();
      event.stopPropagation();
      endPointer(true);
      return;
    }
    const step = event.shiftKey ? 0.1 : 0.01;
    const current = context.color()[channel];
    const next = match(event.key)
      .with('ArrowRight', 'ArrowUp', () => current + step)
      .with('ArrowLeft', 'ArrowDown', () => current - step)
      .with('PageUp', () => current + 0.1)
      .with('PageDown', () => current - 0.1)
      .with('Home', () => 0)
      .with('End', () => 1)
      .otherwise(() => undefined);
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (context.locked()) return;
    context.set({
      ...context.color(),
      [channel]: Math.max(0, Math.min(1, next)),
    });
  };
  return (
    <div
      {...rest}
      role="group"
      aria-label={local['aria-label'] ?? 'Saturation and brightness'}
      data-color-picker-field
      data-slot="color-picker-field"
      class={cn(
        'group/color-picker-field relative h-40 w-full touch-none rounded-md border border-edge-muted',
        local.class
      )}
      style={{
        background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${context.color().h} 100% 50%)`,
        ...local.style,
      }}
      onPointerDown={(event) => {
        if (context.locked() || event.button !== 0 || pointer) return;
        event.preventDefault();
        saturationInput.focus({ preventScroll: true });
        pointer = {
          id: event.pointerId,
          start: context.color(),
          target: event.currentTarget,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        updatePointer(event, event.currentTarget);
      }}
      onPointerMove={(event) => {
        if (pointer?.id === event.pointerId)
          updatePointer(event, event.currentTarget);
      }}
      onPointerUp={(event) => {
        if (pointer?.id !== event.pointerId) return;
        updatePointer(event, event.currentTarget);
        endPointer();
      }}
      onPointerCancel={() => endPointer(true)}
      onLostPointerCapture={() => endPointer()}
    >
      <span
        aria-hidden="true"
        class="pointer-events-none absolute size-3.5 rounded-full border-2 shadow-sm group-has-[:focus-visible]/color-picker-field:outline-2 group-has-[:focus-visible]/color-picker-field:outline-offset-2 group-has-[:focus-visible]/color-picker-field:outline-accent"
        style={{
          left: `${context.color().s * 100}%`,
          top: `${(1 - context.color().v) * 100}%`,
          transform: 'translate(-50%, -50%)',
          'border-color': '#fff',
          background: pickerColorToHex({ ...context.color(), a: 1 }),
          'box-shadow': '0 0 0 1px #0008',
        }}
      />
      <input
        ref={saturationInput}
        type="range"
        class="sr-only"
        aria-label="Saturation"
        aria-valuetext={`${Math.round(context.color().s * 100)}% saturation`}
        min="0"
        max="100"
        step="1"
        value={context.color().s * 100}
        disabled={context.disabled()}
        aria-readonly={context.readOnly() || undefined}
        onInput={(event) =>
          context.set({
            ...context.color(),
            s: Number(event.currentTarget.value) / 100,
          })
        }
        onKeyDown={(event) => keyDown(event, 's')}
        onKeyUp={() => context.finish()}
        onChange={() => context.finish()}
        onBlur={() => context.finish()}
      />
      <input
        type="range"
        class="sr-only"
        aria-label="Brightness"
        aria-valuetext={`${Math.round(context.color().v * 100)}% brightness`}
        min="0"
        max="100"
        step="1"
        value={context.color().v * 100}
        disabled={context.disabled()}
        aria-readonly={context.readOnly() || undefined}
        onInput={(event) =>
          context.set({
            ...context.color(),
            v: Number(event.currentTarget.value) / 100,
          })
        }
        onKeyDown={(event) => keyDown(event, 'v')}
        onKeyUp={() => context.finish()}
        onChange={() => context.finish()}
        onBlur={() => context.finish()}
      />
    </div>
  );
}

const checkerStyle: JSX.CSSProperties = {
  'background-image':
    'repeating-conic-gradient(var(--color-surface-2) 0 25%, var(--color-surface-4) 0 50%)',
  'background-size': '8px 8px',
};

export type ColorPickerTrackProps = SlotProps;

function TrackParts(props: { channel: 'h' | 'a'; label: string }) {
  const context = usePicker();
  const slider = Slider.useSliderContext();
  let start:
    | { color: PickerColor; target: HTMLElement; id: number }
    | undefined;
  const cancel = () => {
    if (!start) return;
    const original = start;
    start = undefined;
    context.set(original.color);
    if (original.target.hasPointerCapture?.(original.id))
      original.target.releasePointerCapture(original.id);
    slider.onSlideEnd?.();
    context.finish();
  };
  return (
    <div
      class="contents"
      on:pointerdown={{
        capture: true,
        handleEvent: (event) => {
          if (context.locked() || event.button !== 0 || start) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          start = {
            color: context.color(),
            target: event.target as HTMLElement,
            id: event.pointerId,
          };
        },
      }}
      onPointerUp={() => {
        start = undefined;
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={() => {
        start = undefined;
        slider.onSlideEnd?.();
      }}
      on:keydown={{
        capture: true,
        handleEvent: (event) => {
          if (event.key === 'Escape' && start) {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }
        },
      }}
    >
      <Slider.Track
        class="relative h-3 w-full rounded-full border border-edge-muted"
        style={props.channel === 'a' ? checkerStyle : undefined}
      >
        <div
          class="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              props.channel === 'h'
                ? 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)'
                : `linear-gradient(to right, ${pickerColorToHex({ ...context.color(), a: 0 })}, ${pickerColorToHex({ ...context.color(), a: 1 })})`,
          }}
        />
        <Slider.Thumb
          aria-label={props.label}
          class="top-1/2 -mt-2 size-4 rounded-full border-2 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={{
            'border-color': '#fff',
            background:
              props.channel === 'h'
                ? `hsl(${context.color().h} 100% 50%)`
                : context.value(),
            'box-shadow': '0 0 0 1px #0008',
          }}
          onKeyUp={() => context.finish()}
        >
          <Slider.Input aria-label={props.label} />
        </Slider.Thumb>
      </Slider.Track>
    </div>
  );
}

function Track(props: ColorPickerTrackProps & { channel: 'h' | 'a' }) {
  const context = usePicker();
  const [local, rest] = splitProps(props, ['channel', 'class', 'aria-label']);
  const label = () =>
    local['aria-label'] ?? (local.channel === 'h' ? 'Hue' : 'Opacity');
  return (
    <Slider.Root
      {...rest}
      data-slot={
        local.channel === 'h'
          ? 'color-picker-hue-track'
          : 'color-picker-alpha-track'
      }
      class={cn(
        'relative flex h-5 w-full touch-none items-center',
        local.class
      )}
      value={[context.color()[local.channel]]}
      minValue={0}
      maxValue={local.channel === 'h' ? 360 : 1}
      step={local.channel === 'h' ? 1 : 0.01}
      disabled={context.locked()}
      getValueLabel={({ values }) =>
        local.channel === 'h'
          ? `${Math.round(values[0])}°`
          : `${Math.round(values[0] * 100)}%`
      }
      onChange={(values) =>
        context.set({ ...context.color(), [local.channel]: values[0] })
      }
      onChangeEnd={() => context.finish()}
    >
      <TrackParts channel={local.channel} label={label()} />
    </Slider.Root>
  );
}

function HueTrack(props: ColorPickerTrackProps) {
  return <Track {...props} channel="h" />;
}

function AlphaTrack(props: ColorPickerTrackProps) {
  return <Track {...props} channel="a" />;
}

export type ColorPickerInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'onInput'
>;

function Input(props: ColorPickerInputProps) {
  const context = usePicker();
  const [local, rest] = splitProps(props, [
    'class',
    'onKeyDown',
    'onBlur',
    'disabled',
    'readOnly',
  ]);
  const [draft, setDraft] = createSignal<string>();
  const commit = (input: HTMLInputElement) => {
    if (
      draft() === undefined ||
      context.locked() ||
      local.disabled ||
      local.readOnly
    )
      return;
    const value = draft()!.trim();
    const color = parsePickerColor(value.startsWith('#') ? value : `#${value}`);
    if (!color) return;
    context.set(preservePickerHue(color, context.color()));
    context.finish();
    setDraft(undefined);
    input.value = context.value();
  };
  return (
    <input
      type="text"
      aria-label="Hex color"
      spellcheck={false}
      autocomplete="off"
      {...rest}
      disabled={context.disabled() || local.disabled}
      readOnly={context.readOnly() || local.readOnly}
      class={cn(
        'h-8 w-full min-w-0 rounded-md border border-edge-muted bg-input px-2 font-mono text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent aria-invalid:border-failure aria-invalid:ring-2 aria-invalid:ring-failure/20 disabled:opacity-50',
        local.class
      )}
      value={draft() ?? context.value()}
      aria-invalid={
        (draft() !== undefined &&
          normalizePickerColor(
            draft()!.startsWith('#') ? draft()! : `#${draft()}`
          ) === undefined) ||
        undefined
      }
      onInput={(event) => {
        if (!context.locked() && !local.disabled && !local.readOnly)
          setDraft(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          commit(event.currentTarget);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setDraft(undefined);
          event.currentTarget.value = context.value();
        }
        if (typeof local.onKeyDown === 'function') local.onKeyDown(event);
      }}
      onBlur={(event) => {
        commit(event.currentTarget);
        if (typeof local.onBlur === 'function') local.onBlur(event);
      }}
    />
  );
}

export type ColorPickerPreviewProps = SlotProps;

function Preview(props: ColorPickerPreviewProps) {
  const context = usePicker();
  const [local, rest] = splitProps(props, ['class', 'style']);
  return (
    <div
      role="img"
      aria-label={`Current color ${context.value()}`}
      {...rest}
      class={cn(
        'relative size-8 shrink-0 overflow-hidden rounded-md border border-edge-muted',
        local.class
      )}
      style={{ ...checkerStyle, ...local.style }}
    >
      <div class="absolute inset-0" style={{ background: context.value() }} />
    </div>
  );
}

export const ColorPicker = {
  Root,
  Field,
  HueTrack,
  AlphaTrack,
  Input,
  Preview,
};
