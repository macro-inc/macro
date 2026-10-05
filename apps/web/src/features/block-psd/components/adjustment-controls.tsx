/**
 * The settings of an adjustment, as the Properties panel (adjustment
 * layers) and the Image > Adjustments dialogs show them: each control
 * reports the whole adjustment with one value changed (`done` false while
 * dragging). Presentational.
 */

import type { Adjustment, LevelsChannel, Rgb } from '@core/psd-engine/types';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { IDENTITY_LEVELS, twoColorGradient } from '../core/adjustments';
import { ColorSwatch } from './color-swatch';
import { CurveEditor } from './curve-editor';
import { CheckField, SelectField, SliderField } from './fields';

type Of<T extends Adjustment['type']> = Extract<Adjustment, { type: T }>;

const CHANNELS = [
  { value: '0', label: 'RGB' },
  { value: '1', label: 'Red' },
  { value: '2', label: 'Green' },
  { value: '3', label: 'Blue' },
] as const;

const BW_LABELS = ['Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas'];

export function AdjustmentControls(props: {
  adjustment: Adjustment;
  disabled?: boolean;
  onChange: (adjustment: Adjustment, done: boolean) => void;
}) {
  const [channel, setChannel] = createSignal(0);
  const [tone, setTone] = createSignal<'shadows' | 'midtones' | 'highlights'>(
    'midtones'
  );
  const a = () => props.adjustment;
  const emit = (next: Adjustment, done: boolean) => props.onChange(next, done);
  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    set: (v: number) => Adjustment,
    step = 1,
    unit?: string
  ) => (
    <SliderField
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      unit={unit}
      disabled={props.disabled}
      testId={`psd-adjust-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
      onChange={(v, done) => emit(set(v), done)}
    />
  );

  return (
    <div class="flex flex-col gap-2" data-testid="psd-adjustment-controls">
      <Switch
        fallback={
          <p class="text-ink-muted text-xs">
            This adjustment is kept as it is, but its settings can't be changed
            here.
          </p>
        }
      >
        <Match
          when={
            a().type === 'brightnessContrast' &&
            (a() as Of<'brightnessContrast'>)
          }
        >
          {(b) => (
            <>
              {slider('Brightness', b().brightness, -150, 150, (v) => ({
                ...b(),
                brightness: Math.round(v),
              }))}
              {slider('Contrast', b().contrast, -50, 100, (v) => ({
                ...b(),
                contrast: Math.round(v),
              }))}
              <CheckField
                label="Use Legacy"
                checked={b().legacy}
                disabled={props.disabled}
                onChange={(legacy) => emit({ ...b(), legacy }, true)}
              />
            </>
          )}
        </Match>
        <Match when={a().type === 'levels' && (a() as Of<'levels'>)}>
          {(l) => {
            const ch = (): LevelsChannel =>
              l().channels[channel()] ?? IDENTITY_LEVELS;
            const set = (patch: Partial<LevelsChannel>): Adjustment => {
              const channels = [...l().channels];
              while (channels.length <= channel())
                channels.push(IDENTITY_LEVELS);
              channels[channel()] = { ...ch(), ...patch };
              return { ...l(), channels };
            };
            return (
              <>
                <SelectField
                  label="Channel"
                  value={
                    String(channel()) as (typeof CHANNELS)[number]['value']
                  }
                  options={CHANNELS}
                  onChange={(v) => setChannel(Number(v))}
                />
                {slider('Input black', ch().inBlack, 0, 253, (v) =>
                  set({ inBlack: Math.min(Math.round(v), ch().inWhite - 2) })
                )}
                {slider(
                  'Gamma',
                  ch().gamma,
                  0.1,
                  9.99,
                  (v) => set({ gamma: v }),
                  0.01
                )}
                {slider('Input white', ch().inWhite, 2, 255, (v) =>
                  set({ inWhite: Math.max(Math.round(v), ch().inBlack + 2) })
                )}
                {slider('Output black', ch().outBlack, 0, 255, (v) =>
                  set({ outBlack: Math.round(v) })
                )}
                {slider('Output white', ch().outWhite, 0, 255, (v) =>
                  set({ outWhite: Math.round(v) })
                )}
              </>
            );
          }}
        </Match>
        <Match when={a().type === 'curves' && (a() as Of<'curves'>)}>
          {(c) => {
            const points = (): [number, number][] =>
              c().channels.find(([n]) => n === channel())?.[1] ?? [
                [0, 0],
                [255, 255],
              ];
            return (
              <>
                <SelectField
                  label="Channel"
                  value={
                    String(channel()) as (typeof CHANNELS)[number]['value']
                  }
                  options={CHANNELS}
                  onChange={(v) => setChannel(Number(v))}
                />
                <CurveEditor
                  points={points()}
                  disabled={props.disabled}
                  testId="psd-curves"
                  onChange={(pts, done) => {
                    const channels = c().channels.filter(
                      ([n]) => n !== channel()
                    );
                    channels.push([channel(), pts]);
                    channels.sort((x, y) => x[0] - y[0]);
                    emit({ ...c(), channels }, done);
                  }}
                />
              </>
            );
          }}
        </Match>
        <Match when={a().type === 'exposure' && (a() as Of<'exposure'>)}>
          {(x) => (
            <>
              {slider(
                'Exposure',
                x().exposure,
                -20,
                20,
                (v) => ({ ...x(), exposure: v }),
                0.01
              )}
              {slider(
                'Offset',
                x().offset,
                -0.5,
                0.5,
                (v) => ({ ...x(), offset: v }),
                0.0001
              )}
              {slider(
                'Gamma',
                x().gamma,
                0.01,
                9.99,
                (v) => ({ ...x(), gamma: v }),
                0.01
              )}
            </>
          )}
        </Match>
        <Match when={a().type === 'vibrance' && (a() as Of<'vibrance'>)}>
          {(v) => (
            <>
              {slider('Vibrance', v().vibrance, -100, 100, (n) => ({
                ...v(),
                vibrance: Math.round(n),
              }))}
              {slider('Saturation', v().saturation, -100, 100, (n) => ({
                ...v(),
                saturation: Math.round(n),
              }))}
            </>
          )}
        </Match>
        <Match
          when={a().type === 'hueSaturation' && (a() as Of<'hueSaturation'>)}
        >
          {(h) => {
            const hsl = () => (h().colorize ? h().colorization : h().master);
            const set = (i: number, v: number): Adjustment => {
              const next = [...hsl()] as [number, number, number];
              next[i] = Math.round(v);
              return h().colorize
                ? { ...h(), colorization: next }
                : { ...h(), master: next };
            };
            return (
              <>
                {slider(
                  'Hue',
                  hsl()[0],
                  h().colorize ? 0 : -180,
                  h().colorize ? 360 : 180,
                  (v) => set(0, v)
                )}
                {slider(
                  'Saturation',
                  hsl()[1],
                  h().colorize ? 0 : -100,
                  100,
                  (v) => set(1, v)
                )}
                {slider('Lightness', hsl()[2], -100, 100, (v) => set(2, v))}
                <CheckField
                  label="Colorize"
                  checked={h().colorize}
                  disabled={props.disabled}
                  testId="psd-adjust-colorize"
                  onChange={(colorize) => emit({ ...h(), colorize }, true)}
                />
              </>
            );
          }}
        </Match>
        <Match
          when={a().type === 'colorBalance' && (a() as Of<'colorBalance'>)}
        >
          {(b) => {
            const values = () => b()[tone()];
            const set = (i: number, v: number): Adjustment => {
              const next = [...values()] as [number, number, number];
              next[i] = Math.round(v);
              return { ...b(), [tone()]: next };
            };
            return (
              <>
                <SelectField
                  label="Tone"
                  value={tone()}
                  options={[
                    { value: 'shadows', label: 'Shadows' },
                    { value: 'midtones', label: 'Midtones' },
                    { value: 'highlights', label: 'Highlights' },
                  ]}
                  onChange={setTone}
                />
                {slider('Cyan–Red', values()[0], -100, 100, (v) => set(0, v))}
                {slider('Magenta–Green', values()[1], -100, 100, (v) =>
                  set(1, v)
                )}
                {slider('Yellow–Blue', values()[2], -100, 100, (v) =>
                  set(2, v)
                )}
                <CheckField
                  label="Preserve Luminosity"
                  checked={b().preserveLuminosity}
                  disabled={props.disabled}
                  onChange={(preserveLuminosity) =>
                    emit({ ...b(), preserveLuminosity }, true)
                  }
                />
              </>
            );
          }}
        </Match>
        <Match when={a().type === 'blackWhite' && (a() as Of<'blackWhite'>)}>
          {(b) => (
            <>
              <For each={BW_LABELS}>
                {(label, i) =>
                  slider(
                    label,
                    b().weights[i()],
                    -200,
                    300,
                    (v) => {
                      const weights = [
                        ...b().weights,
                      ] as Of<'blackWhite'>['weights'];
                      weights[i()] = Math.round(v);
                      return { ...b(), weights };
                    },
                    1,
                    '%'
                  )
                }
              </For>
              <CheckField
                label="Tint"
                checked={!!b().tint}
                disabled={props.disabled}
                onChange={(on) =>
                  emit(
                    { ...b(), tint: on ? { r: 0.88, g: 0.83, b: 0.69 } : null },
                    true
                  )
                }
              />
              <Show when={b().tint}>
                {(tint) => (
                  <ColorSwatch
                    label="Tint color"
                    color={tint()}
                    disabled={props.disabled}
                    onChange={(c, done) => emit({ ...b(), tint: c }, done)}
                  />
                )}
              </Show>
            </>
          )}
        </Match>
        <Match when={a().type === 'photoFilter' && (a() as Of<'photoFilter'>)}>
          {(p) => (
            <>
              <ColorSwatch
                label="Color"
                color={p().color}
                disabled={props.disabled}
                testId="psd-adjust-photo-filter-color"
                onChange={(color: Rgb, done) => emit({ ...p(), color }, done)}
              />
              {slider(
                'Density',
                Math.round(p().density * 100),
                0,
                100,
                (v) => ({ ...p(), density: v / 100 }),
                1,
                '%'
              )}
              <CheckField
                label="Preserve Luminosity"
                checked={p().preserveLuminosity}
                disabled={props.disabled}
                onChange={(preserveLuminosity) =>
                  emit({ ...p(), preserveLuminosity }, true)
                }
              />
            </>
          )}
        </Match>
        <Match
          when={a().type === 'channelMixer' && (a() as Of<'channelMixer'>)}
        >
          {(m) => {
            const row = () =>
              m().rows[Math.max(0, channel() - 1)] ?? m().rows[0];
            const set = (i: number, v: number): Adjustment => {
              const rows = m().rows.map((r) => [
                ...r,
              ]) as Of<'channelMixer'>['rows'];
              rows[Math.max(0, channel() - 1)][i] = Math.round(v);
              return { ...m(), rows };
            };
            return (
              <>
                <SelectField
                  label="Output"
                  value={String(Math.max(1, channel())) as '1' | '2' | '3'}
                  options={[
                    { value: '1', label: 'Red' },
                    { value: '2', label: 'Green' },
                    { value: '3', label: 'Blue' },
                  ]}
                  onChange={(v) => setChannel(Number(v))}
                />
                {slider('Red', row()[0], -200, 200, (v) => set(0, v), 1, '%')}
                {slider('Green', row()[1], -200, 200, (v) => set(1, v), 1, '%')}
                {slider('Blue', row()[2], -200, 200, (v) => set(2, v), 1, '%')}
                {slider(
                  'Constant',
                  row()[3],
                  -200,
                  200,
                  (v) => set(3, v),
                  1,
                  '%'
                )}
                <CheckField
                  label="Monochrome"
                  checked={m().monochrome}
                  disabled={props.disabled}
                  onChange={(monochrome) => emit({ ...m(), monochrome }, true)}
                />
              </>
            );
          }}
        </Match>
        <Match when={a().type === 'invert'}>
          <p class="text-ink-muted text-xs">Inverts the colors below.</p>
        </Match>
        <Match when={a().type === 'posterize' && (a() as Of<'posterize'>)}>
          {(p) =>
            slider('Levels', p().levels, 2, 255, (v) => ({
              ...p(),
              levels: Math.round(v),
            }))
          }
        </Match>
        <Match when={a().type === 'threshold' && (a() as Of<'threshold'>)}>
          {(t) =>
            slider('Threshold', t().level, 1, 255, (v) => ({
              ...t(),
              level: Math.round(v),
            }))
          }
        </Match>
        <Match when={a().type === 'gradientMap' && (a() as Of<'gradientMap'>)}>
          {(g) => {
            const stops = () => g().gradient.colors;
            const from = () => stops()[0]?.color ?? { r: 0, g: 0, b: 0 };
            const to = () =>
              stops()[stops().length - 1]?.color ?? { r: 1, g: 1, b: 1 };
            return (
              <>
                <ColorSwatch
                  label="Shadows"
                  color={from()}
                  disabled={props.disabled}
                  onChange={(c, done) =>
                    emit(
                      {
                        ...g(),
                        gradient: twoColorGradient(c, to(), g().gradient.name),
                      },
                      done
                    )
                  }
                />
                <ColorSwatch
                  label="Highlights"
                  color={to()}
                  disabled={props.disabled}
                  onChange={(c, done) =>
                    emit(
                      {
                        ...g(),
                        gradient: twoColorGradient(
                          from(),
                          c,
                          g().gradient.name
                        ),
                      },
                      done
                    )
                  }
                />
                <CheckField
                  label="Reverse"
                  checked={g().reverse}
                  disabled={props.disabled}
                  onChange={(reverse) => emit({ ...g(), reverse }, true)}
                />
              </>
            );
          }}
        </Match>
      </Switch>
    </div>
  );
}
