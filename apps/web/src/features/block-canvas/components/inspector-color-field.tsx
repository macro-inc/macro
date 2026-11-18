import { Popover } from '@kobalte/core/popover';
import { ColorPicker, InputGroup, Layer } from '@ui';
import { PALETTE_COLORS } from '@ui/utils/palette';
import { createSignal, For, Show } from 'solid-js';
import { readSwatchColor } from '../primitives/read-swatch-color';

const swatches = [
  { label: 'None', value: 'transparent' },
  { label: 'Ink', value: 'var(--color-ink)' },
  { label: 'Surface', value: 'var(--color-panel)' },
  { label: 'Accent', value: 'var(--color-accent)' },
  ...PALETTE_COLORS.map((color) => ({
    label: color[0].toUpperCase() + color.slice(1),
    value: `var(--color-${color})`,
  })),
];

/**
 * The palette and the canvas's own colours as a row of swatches a finger can
 * pick from, scrolling sideways. For an inspector that has no room to open the
 * picker beside what is being coloured.
 */
function SwatchRow(props: {
  canvasColors: readonly string[];
  label: string;
  value: string | undefined;
  onPick: (color: string) => void;
}) {
  // Listed by value, so a swatch keeps its button (and the focus on it) when
  // picking it changes the canvas's colours.
  const values = () => [
    ...swatches.map((color) => color.value),
    // The canvas's own colours that the palette does not already offer.
    ...props.canvasColors.filter(
      (value) => !swatches.some((color) => color.value === value)
    ),
  ];
  const label = (value: string) =>
    swatches.find((color) => color.value === value)?.label ?? value;
  return (
    <div
      role="group"
      aria-label={`${props.label} colors`}
      class="-mx-1 flex gap-2 overflow-x-auto overscroll-x-contain px-1 py-1 scrollbar-hidden"
    >
      <For each={values()}>
        {(value) => (
          <button
            type="button"
            aria-label={`${props.label}: ${label(value)}`}
            aria-pressed={props.value === value}
            class="grid size-11 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ink-muted"
            onClick={() => props.onPick(value)}
          >
            <span
              class="grid size-8 place-items-center rounded-full border border-ink/10 text-xs text-ink-muted ring-offset-2 ring-offset-menu in-aria-pressed:ring-2 in-aria-pressed:ring-ink"
              style={{ background: value }}
            >
              {value === 'transparent' ? '╱' : null}
            </span>
          </button>
        )}
      </For>
    </div>
  );
}

export function InspectorColorField(props: {
  canvasColors: readonly string[];
  label: string;
  value: string | undefined;
  onChange: (color: string) => void;
  /**
   * Also list the swatches under the field. The picker behind the swatch
   * stays, for a custom colour.
   */
  swatchRow?: boolean;
}) {
  const [invalid, setInvalid] = createSignal(false);
  const [picker, setPicker] = createSignal('#000000');
  let swatch!: HTMLSpanElement;
  const named = () =>
    swatches.find((color) => color.value === props.value)?.label;
  const display = () => {
    if (named()) return named();
    if (!props.value) return '';
    if (props.value.startsWith('#')) return props.value.slice(1).toUpperCase();
    return 'Custom';
  };
  return (
    <div class="space-y-2">
      <InputGroup
        size="sm"
        class="border-transparent bg-hover/50 hover:border-edge-muted has-[button:focus-visible]:border-edge has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-edge-muted"
      >
        <InputGroup.Addon>
          <Popover
            placement="left-start"
            gutter={8}
            onOpenChange={(open) => {
              if (open) setPicker(readSwatchColor(swatch));
            }}
          >
            <Popover.Trigger
              aria-label={`${props.label} color picker`}
              class="block rounded-sm p-0 outline-none"
            >
              <span
                ref={swatch}
                class="block size-4 rounded-sm border border-ink/10"
                style={{ background: props.value ?? 'transparent' }}
              >
                {props.value === 'transparent' && (
                  <span class="block text-center text-xs text-ink-muted">
                    ╱
                  </span>
                )}
              </span>
            </Popover.Trigger>
            <Popover.Portal>
              <Layer depth={3}>
                <Popover.Content
                  aria-label={`${props.label} color picker`}
                  class="menu-surface z-modal max-h-[min(calc(100vh-2rem),var(--kb-popper-content-available-height))] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto p-4"
                >
                  <ColorPicker.Root
                    value={picker()}
                    onChange={(color) => {
                      setPicker(color);
                      setInvalid(false);
                      props.onChange(color);
                    }}
                    class="gap-4"
                  >
                    <ColorPicker.Field class="aspect-square h-auto" />
                    <ColorPicker.HueTrack />
                    <ColorPicker.AlphaTrack />
                    <div class="flex items-center gap-2">
                      <ColorPicker.Preview />
                      <ColorPicker.Input
                        aria-label={`${props.label} picker hex color`}
                      />
                      <span class="text-[10px] text-ink-muted">HEX</span>
                    </div>
                    <For
                      each={[
                        {
                          title: 'Palette',
                          label: `${props.label} palette`,
                          colors: swatches,
                        },
                        {
                          title: 'On this canvas',
                          label: `${props.label} canvas colors`,
                          colors: props.canvasColors.map((value) => ({
                            value,
                            label:
                              swatches.find((color) => color.value === value)
                                ?.label ?? value,
                          })),
                        },
                      ]}
                    >
                      {(section) => (
                        <div class="space-y-3 border-t border-edge pt-3">
                          <p class="text-xs font-medium text-ink-muted">
                            {section.title}
                          </p>
                          <div
                            class="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1"
                            role="group"
                            aria-label={section.label}
                          >
                            <For each={section.colors}>
                              {(color) => (
                                <button
                                  type="button"
                                  aria-label={`${props.label}: ${color.label}`}
                                  title={color.label}
                                  aria-pressed={props.value === color.value}
                                  class="aspect-square min-w-0 rounded-[2px] border border-ink/10 outline-none hover:ring-1 hover:ring-ink-muted focus-visible:ring-2 focus-visible:ring-ink-muted aria-pressed:ring-1 aria-pressed:ring-ink aria-pressed:ring-offset-1 aria-pressed:ring-offset-surface"
                                  style={{ background: color.value }}
                                  onClick={(event) => {
                                    setInvalid(false);
                                    setPicker(
                                      readSwatchColor(
                                        event.currentTarget,
                                        picker()
                                      )
                                    );
                                    props.onChange(color.value);
                                  }}
                                >
                                  {color.value === 'transparent' ? (
                                    <span class="block text-[8px] leading-none text-ink-muted">
                                      ╱
                                    </span>
                                  ) : null}
                                </button>
                              )}
                            </For>
                          </div>
                          {section.colors.length === 0 && (
                            <p class="text-xs text-ink-muted">No colors yet</p>
                          )}
                        </div>
                      )}
                    </For>
                  </ColorPicker.Root>
                </Popover.Content>
              </Layer>
            </Popover.Portal>
          </Popover>
        </InputGroup.Addon>
        <InputGroup.Input
          onClick={(event) => event.currentTarget.select()}
          aria-label={`${props.label} color`}
          aria-invalid={invalid()}
          placeholder={props.value === undefined ? 'Mixed' : display()}
          spellcheck={false}
          class="text-xs"
          value={display()}
          onInput={() => setInvalid(false)}
          onChange={(event) => {
            const raw = event.currentTarget.value.trim();
            if (
              /^#?(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(raw)
            ) {
              setInvalid(false);
              props.onChange(`#${raw.replace(/^#/, '')}`);
            } else if (raw !== display()) setInvalid(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              event.stopPropagation();
              setInvalid(false);
              event.currentTarget.value = display() ?? '';
              event.currentTarget.blur();
            }
          }}
        />
        <InputGroup.Addon align="inline-end" class="text-[10px]">
          {named() ? 'Palette' : 'HEX'}
        </InputGroup.Addon>
      </InputGroup>
      {invalid() && (
        <p class="text-[10px] text-failure" role="alert">
          Enter a 3, 4, 6, or 8 digit hex color.
        </p>
      )}
      <Show when={props.swatchRow}>
        <SwatchRow
          canvasColors={props.canvasColors}
          label={props.label}
          value={props.value}
          onPick={(color) => {
            setInvalid(false);
            props.onChange(color);
          }}
        />
      </Show>
    </div>
  );
}
