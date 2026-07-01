import { batch, createEffect, createSignal, type JSX, untrack } from 'solid-js';
import { setThemeDepth, themeDepth } from '../signals/themeSignals';
import { themeReactive } from '../signals/themeReactive';
import { convertOklchTo, getOklch, validateColor } from '../utils/colorUtil';
import { ColorPickerPopover } from './ColorPickerPopover';

function setLightness(lightness: number) {
  batch(() => {
    themeReactive.a0.l[1](lightness);
    themeReactive.a1.l[1](lightness);
    themeReactive.a2.l[1](lightness);
    themeReactive.a3.l[1](lightness);
    themeReactive.a4.l[1](lightness);
  });
}

function setChroma(chroma: number, saturation: number) {
  batch(() => {
    themeReactive.a0.c[1](chroma);
    themeReactive.a1.c[1](chroma);
    themeReactive.a2.c[1](chroma);
    themeReactive.a3.c[1](chroma);
    themeReactive.a4.c[1](chroma);
    setSaturation(saturation);
  });
}

function setHue(hue: number) {
  batch(() => {
    themeReactive.a0.h[1](hue      );
    themeReactive.a1.h[1](hue +  40);
    themeReactive.a2.h[1](hue +  80);
    themeReactive.a3.h[1](hue + 120);
    themeReactive.a4.h[1](hue + 160);

    themeReactive.b0.h[1](hue);
    themeReactive.b1.h[1](hue);
    themeReactive.b2.h[1](hue);
    themeReactive.b3.h[1](hue);
    themeReactive.b4.h[1](hue);

    themeReactive.c0.h[1](hue);
    themeReactive.c1.h[1](hue);
    themeReactive.c2.h[1](hue);
    themeReactive.c3.h[1](hue);
    themeReactive.c4.h[1](hue);
  });
}

function setSaturation(saturation: number) {
  const s = saturation * themeReactive.a0.c[0]() * 0.37 * 0.6;

  batch(() => {
    themeReactive.b0.c[1](s);
    themeReactive.b1.c[1](s);
    themeReactive.b2.c[1](s);
    themeReactive.b3.c[1](s);
    themeReactive.b4.c[1](s);

    themeReactive.c0.c[1](s);
    themeReactive.c1.c[1](s);
    themeReactive.c2.c[1](s);
    themeReactive.c3.c[1](s);
    themeReactive.c4.c[1](s);
  });
}

let q = 8;
function sigmoid(x: number, b: number): number {
  return (-((1 / (1 + Math.exp(b * (x - 0.5))) - 0.5) * (0.5 / (1 / (1 + Math.exp(q / 2)) - 0.5))) + 0.5);
}

function getContrastFromY(y: number): number {
  return ((-2 * Math.log(1 / (-(y - 0.5) / (0.5 / (1 / (1 + Math.exp(q / 2)) - 0.5)) + 0.5) - 1) - (-2 * Math.log(1 / (-(y - 0.5) / (0.5 / (1 / (1 + Math.exp(q / 2)) - 0.5)) + 0.5) - 1) < 0 ? -1 : 1)) / (q - 1) / 2 + 0.4);
}

function setContrast(contrast: number) {
  const c = (contrast - 0.4) * 2;
  const p = c < 0 ? -1 : 1;
  const b = c * (q - 1) + p;

  batch(() => {
    themeReactive.b0.l[1](sigmoid(0.00, b));
    themeReactive.b1.l[1](sigmoid(0.08, b));
    themeReactive.b2.l[1](sigmoid(0.18, b));
    themeReactive.b3.l[1](sigmoid(0.22, b));
    themeReactive.b4.l[1](sigmoid(0.28, b));

    themeReactive.c4.l[1](sigmoid(0.68, b));
    themeReactive.c3.l[1](sigmoid(0.76, b));
    themeReactive.c2.l[1](sigmoid(0.84, b));
    themeReactive.c1.l[1](sigmoid(0.92, b));
    themeReactive.c0.l[1](sigmoid(1.00, b));
  });
}

export function randomizeTheme(){
  batch(() => {
    const randLightness = Math.random();
    const randHue = Math.random();
    setLightness(randLightness * 0.7 + 0.3);
    setHue(randHue * 360);

    const randSaturation = Math.random() * 0.5;
    const randContrast = 1 - randLightness;
    const randChroma = (Math.random() * 0.5 + 0.5) * 0.37;
    const randDepth = (Math.random() * 0.2 + 0.1);

    setContrast(randContrast);
    setChroma(randChroma, randSaturation);
    setSaturation(randSaturation);
    setThemeDepth(randDepth);
  });
}

/** Numeric value box shown to the right of each slider, on a display scale
 *  (default 0-100). Pass displayMin/displayMax for a centered scale (e.g.
 *  -100..100 for Contrast). Keeps its own text state while typing. */
function NumberInput(props: {
  get: () => number;
  set: (n: number) => void;
  min: number;
  max: number;
  displayMin?: number;
  displayMax?: number;
}) {
  const dMin = () => props.displayMin ?? 0;
  const dMax = () => props.displayMax ?? 100;
  const toDisplay = (v: number) =>
    dMin() + ((v - props.min) / (props.max - props.min)) * (dMax() - dMin());
  const fromDisplay = (d: number) =>
    props.min + ((d - dMin()) / (dMax() - dMin())) * (props.max - props.min);

  const [text, setText] = createSignal('');
  const [isSetByInput, setIsSetByInput] = createSignal(false);

  createEffect(() => {
    const value = props.get();
    if (untrack(isSetByInput)) { setIsSetByInput(false); }
    else { setText(Math.round(toDisplay(value)).toString()); }
  });

  return (
    <div
      style="
        background-color: oklch(from var(--c0) l c h / 0.05);
        box-sizing: border-box;
        align-items: center;
        border-radius: 6px;
        padding: 3px 6px;
        display: flex;
        gap: 1px;
        flex: none;
        width: 6ch;
      "
    >
        <input
          class="theme-editor-basic-num"
          type="number"
          value={text()}
          min={dMin()}
          max={dMax()}
          step={1}
          onInput={(e) => {
            const raw = e.currentTarget.value;
            setIsSetByInput(true);
            setText(raw);
            const d = parseFloat(raw);
            if (!Number.isNaN(d)) { props.set(fromDisplay(Math.max(dMin(), Math.min(dMax(), d)))); }
          }}
          onBlur={() => setText(Math.round(toDisplay(props.get())).toString())}
          style="
            font-family: var(--font-mono);
            background: transparent;
            box-sizing: border-box;
            text-align: right;
            color: var(--c0);
            font-size: 12px;
            min-width: 0;
            outline: none;
            border: none;
            padding: 0;
            flex: 1;
          "
        />
      <span style="color: var(--c2); font-size: 12px; flex: none;">%</span>
    </div>
  );
}

/** Accent control: a clickable circle swatch (opens the color picker) beside a
 *  validated, editable hex field. Both read/write the same accent color. */
function AccentControl(props: {
  l: () => number;
  c: () => number;
  h: () => number;
  onL: (n: number) => void;
  onC: (n: number) => void;
  onH: (n: number) => void;
}) {
  const [hexText, setHexText] = createSignal('');
  const [invalid, setInvalid] = createSignal(false);
  const [bySelf, setBySelf] = createSignal(false);

  createEffect(() => {
    const next = convertOklchTo(props.l(), props.c(), props.h(), 'hex');
    if (untrack(bySelf)) {
      setBySelf(false);
    } else {
      setHexText(next);
    }
  });

  const apply = (value: string) => {
    setBySelf(true);
    setHexText(value);
    if (!value || value.trim().length < 6 || !validateColor(value)) {
      setInvalid(true);
      return;
    }
    try {
      const next = getOklch(value);
      batch(() => {
        props.onL(next.l || 0);
        props.onC(next.c || 0);
        props.onH(next.h || 0);
      });
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  };

  return (
    <>
      <ColorPickerPopover
        l={props.l}
        c={props.c}
        h={props.h}
        onL={props.onL}
        onC={props.onC}
        onH={props.onH}
        ariaLabel="Edit accent color"
        trigger={
          <div
            class="size-6 rounded-full border border-ink/[0.15]"
            style={{
              'background-color': `oklch(${props.l()} ${props.c()} ${props.h()}deg)`,
            }}
          />
        }
      />
      <input
        type="text"
        value={hexText()}
        onInput={(e) => apply(e.currentTarget.value)}
        spellcheck={false}
        aria-label="Accent hex color"
        class="w-[11ch] rounded-md bg-ink/5 px-2 py-1 text-right font-mono text-xs uppercase text-ink outline-none focus:bg-ink/8"
        classList={{ 'text-failure': invalid() }}
      />
    </>
  );
}

/** A stacked row: label on the left, control(s) right-aligned. The control
 *  cluster is capped (~half the row on wide layouts) so sliders don't run all
 *  the way back to the label. */
function Control(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-h-10 items-center gap-3">
      <div class="w-[8ch] shrink-0 text-ink-muted">{props.label}</div>
      <div class="flex-1" />
      <div class="flex w-1/2 min-w-0 max-w-72 items-center justify-end gap-2.5">
        {props.children}
      </div>
    </div>
  );
}

/** A simple, borderless slider: a rounded neutral track, an accent fill up to
 *  the value, and a round thumb. `fraction` (0..1) positions the thumb/fill;
 *  `value` drives the underlying range input on its own min/max scale. */
function BasicSlider(props: {
  fraction: number;
  onInput: (e: Event) => void;
  min: number;
  max: number;
  step?: number;
  value?: string;
}) {
  const f = () => {
    const v = props.fraction;
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  };
  return (
    <div style="position:relative;height:16px;flex:1;min-width:0;">
      {/* track */}
      <div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:4px;border-radius:999px;background:oklch(from var(--c0) l c h / 0.1);" />
      {/* filled portion — muted ink */}
      <div
        style={{
          position: 'absolute',
          left: '0',
          top: '50%',
          transform: 'translateY(-50%)',
          height: '4px',
          'border-radius': '999px',
          background: 'oklch(from var(--c0) l c h / 0.25)',
          width: `${f() * 100}%`,
        }}
      />
      {/* thumb — ink */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: `${f() * 100}%`,
          transform: 'translate(-50%, -50%)',
          width: '16px',
          height: '16px',
          'border-radius': '50%',
          'background-color': 'var(--c0)',
          'box-shadow': '0 1px 2px oklch(0 0 0 / 0.25)',
        }}
      />
      <input
        class="theme-editor-basic-slider"
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 0.001}
        value={props.value}
        onInput={props.onInput}
        style="appearance:none;-webkit-appearance:none;position:absolute;inset:0;width:100%;height:100%;margin:0;background:#0000;outline:none;cursor:pointer;"
      />
    </div>
  );
}

export function ThemeEditorBasic(){
  const a0 = themeReactive.a0;

  // Saturation is stored as a fraction of the accent's chroma; recover it so
  // accent-chroma edits keep the same tint ratio.
  const satFraction = () => {
    const denom = a0.c[0]() * 0.37 * 0.6;
    return denom ? themeReactive.b0.c[0]() / denom : 0;
  };

  const clamp = (n: number, min: number, max: number) =>
    Math.max(min, Math.min(max, n));

  const handleSaturationChange = (e: Event) =>
    setSaturation(clamp(parseFloat((e.target as HTMLInputElement).value), 0, 1));
  const handleContrastChange = (e: Event) =>
    setContrast(clamp(parseFloat((e.target as HTMLInputElement).value), 0, 0.8));
  const handleDepthChange = (e: Event) =>
    setThemeDepth(clamp(parseFloat((e.target as HTMLInputElement).value), 0, 0.4));

  return (
    <>
      <style>{`
        .theme-editor-basic-slider::-webkit-slider-thumb {
          opacity: 0;
        }
        .theme-editor-basic-slider::-moz-range-thumb {
          opacity: 0;
        }
        .theme-editor-basic-num::-webkit-inner-spin-button,
        .theme-editor-basic-num::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .theme-editor-basic-num {
          -moz-appearance: textfield;
        }
      `}</style>

      <div
        style="
          font-family: var(--font-sans);
          padding: 10px 16px 12px 16px;
          background-color: var(--b0);
          box-sizing: border-box;
          height: min-content;
          font-weight: 500;
          font-size: 12px;
        "
      >
        <div class="flex flex-col divide-y divide-ink/[0.05]">
          <Control label="Accent">
            <AccentControl
              l={() => a0.l[0]()}
              c={() => a0.c[0]()}
              h={() => a0.h[0]()}
              onL={(n) => setLightness(n)}
              onC={(n) => setChroma(n, satFraction())}
              onH={(n) => setHue(n)}
            />
          </Control>

          <Control label="Tint">
            <BasicSlider
              fraction={satFraction()}
              value={satFraction().toString()}
              onInput={handleSaturationChange}
              min={0}
              max={1}
            />
            <NumberInput get={satFraction} set={setSaturation} min={0} max={1} />
          </Control>

          <Control label="Lightness">
            <BasicSlider
              fraction={getContrastFromY(themeReactive.b0.l[0]()) / 0.8}
              value={getContrastFromY(themeReactive.b0.l[0]()).toString()}
              onInput={handleContrastChange}
              min={0}
              max={0.8}
            />
            <NumberInput
              get={() => getContrastFromY(themeReactive.b0.l[0]())}
              set={setContrast}
              min={0}
              max={0.8}
            />
          </Control>

          <Control label="Contrast">
            <BasicSlider
              fraction={themeDepth() / 0.4}
              value={themeDepth().toString()}
              onInput={handleDepthChange}
              min={0}
              max={0.4}
            />
            <NumberInput get={themeDepth} set={setThemeDepth} min={0} max={0.4} />
          </Control>
        </div>
      </div>
    </>
  );
}
