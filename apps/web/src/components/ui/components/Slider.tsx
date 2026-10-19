import * as KobalteSlider from '@kobalte/core/slider';
import { type ComponentProps, splitProps } from 'solid-js';
import { cn } from '../utils/classname';

export type SliderRootProps = ComponentProps<typeof KobalteSlider.Root>;
export type SliderTrackProps = ComponentProps<typeof KobalteSlider.Track>;
export type SliderFillProps = ComponentProps<typeof KobalteSlider.Fill>;
export type SliderThumbProps = ComponentProps<typeof KobalteSlider.Thumb>;

function Root(props: SliderRootProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteSlider.Root
      {...rest}
      class={cn(
        'relative flex w-full touch-none select-none flex-col gap-3 data-[disabled]:opacity-50',
        local.class
      )}
    />
  );
}

function Track(props: SliderTrackProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteSlider.Track
      {...rest}
      class={cn(
        "relative my-2 h-2 w-full shrink-0 rounded-full bg-ink/15 before:absolute before:inset-x-0 before:-inset-y-3 before:content-[''] data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2",
        local.class
      )}
    />
  );
}

function Fill(props: SliderFillProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteSlider.Fill
      {...rest}
      class={cn(
        'absolute h-full rounded-full bg-accent data-[orientation=vertical]:w-full',
        local.class
      )}
    />
  );
}

function Thumb(props: SliderThumbProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteSlider.Thumb
      {...rest}
      class={cn(
        "absolute top-1/2 size-4 -translate-y-1/2 rounded-full border border-edge-muted bg-panel shadow-sm outline-none after:absolute after:-inset-3 after:content-[''] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel data-[disabled]:pointer-events-none data-[orientation=vertical]:left-1/2 data-[orientation=vertical]:top-auto data-[orientation=vertical]:-translate-x-1/2 data-[orientation=vertical]:translate-y-0",
        local.class
      )}
    />
  );
}

/**
 * Kobalte owns pointer, keyboard, form, and multi-thumb accessibility semantics.
 * @do Give each thumb an accessible name and include its Slider.Input.
 * @do Pair sliders with exact inputs when users need precise values.
 * @dont Rely on track color alone to communicate the selected value.
 */
export const Slider = Object.assign(Root, {
  Root,
  Track,
  Fill,
  Thumb,
  Input: KobalteSlider.Input,
  Label: KobalteSlider.Label,
  ValueLabel: KobalteSlider.ValueLabel,
  Description: KobalteSlider.Description,
  ErrorMessage: KobalteSlider.ErrorMessage,
});
