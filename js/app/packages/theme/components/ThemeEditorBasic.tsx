import { batch, createEffect, createSignal, type JSX, onCleanup, onMount, untrack } from 'solid-js';
import { setThemeDepth, themeDepth } from '../signals/themeSignals';
import { themeReactive } from '../signals/themeReactive';
import { flipLightDark } from '../utils/themeUtils';
import { isMobile } from '@core/mobile/isMobile';
import IconFlip from '@phosphor-icons/core/regular/circle-half-tilt.svg?component-solid';

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

/** Numeric value box shown to the right of each slider. Displays/edits the value
 *  on a display scale (default 0-100) mapped from the control's internal range.
 *  Pass displayMin/displayMax for a centered scale, e.g. -100..100 for Contrast.
 *  Keeps its own text state while typing (mirroring ThemeEditorAdvanced) so
 *  reactive updates from the slider don't fight the user's input. */
function NumberInput(props: {
  get: () => number;
  set: (n: number) => void;
  min: number;
  max: number;
  displayMin?: number;
  displayMax?: number;
  action?: JSX.Element;
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
    <div style="display: flex; align-items: center; gap: 4px; flex: none;">
      <div
        style="
          background-color: var(--b1);
          border: 1px solid var(--b4);
          box-sizing: border-box;
          align-items: center;
          border-radius: 4px;
          padding: 3px 6px;
          display: flex;
          width: 8ch;
          gap: 3px;
        "
      >
        {props.action}
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
      </div>
      <span style="color: var(--c2); font-size: 12px;">%</span>
    </div>
  );
}

export function ThemeEditorBasic(){
  const [canvasThumbDrag, setCanvasThumbDrag] = createSignal(false);

  let sliderSaturationRef!: HTMLInputElement;
  let sliderContrastRef!: HTMLInputElement;
  let sliderDepthRef!: HTMLInputElement;
  let chromaLocation: WebGLUniformLocation;
  let canvasContainerRef!: HTMLDivElement;
  let canvasThumbRef!: HTMLDivElement;
  let canvasRef!: HTMLCanvasElement;
  let gl: WebGL2RenderingContext;
  let program: WebGLProgram;
  let gridXLocation: WebGLUniformLocation;
  let gridYLocation: WebGLUniformLocation;
  let resizeObserver: ResizeObserver;

  function setupWebGL(){
    const context = canvasRef.getContext('webgl2', {colorSpace: 'display-p3'});
    if(!context || !(context instanceof WebGL2RenderingContext)){throw new Error('WebGL2 not supported')}
    gl = context;
    gl.viewport(0, 0, canvasRef.width, canvasRef.height);
    program = gl.createProgram()!;

    const vertBuffer = gl.createBuffer();
    const verts = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
    const vertexShaderSource = `#version 300 es
      in vec2 position;
      out vec2 vUV;
      void main(){
        gl_Position = vec4(position, 0.0, 1.0);
        vUV = (position + 1.0) * 0.5;
      }
    `;
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);
    gl.attachShader(program, vertexShader);

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;
    const fragmentShaderSource = `#version 300 es
      precision mediump float;
      in vec2 vUV;
      out vec4 fragColor;
      uniform float chroma;
      uniform float gridX;
      uniform float gridY;
      const float PI = 3.14159265359;
      const float radius = 0.135;

      vec3 OKLCH_to_OKLab(float L, float C, float h){
        return vec3(
          L,
          C * cos(h * PI / 180.0),
          C * sin(h * PI / 180.0)
        );
      }

      vec3 OKLab_to_linear_sRGB(vec3 lab){
        float l = pow(lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z, 3.0);
        float m = pow(lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z, 3.0);
        float s = pow(lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z, 3.0);
        return vec3(
          +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
          -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
        );
      }

      vec3 linear_to_sRGB(vec3 rgb){
        return mix(1.055 * pow(rgb, vec3(1.0/2.4)) - 0.055, 12.92 * rgb, lessThanEqual(rgb, vec3(0.0031308)));
      }

      void main(){
        float L = vUV.y;
        float C = chroma;
        float h = vUV.x * 360.0;
        vec3 lab = OKLCH_to_OKLab(L, C, h);
        vec3 rgb_linear = OKLab_to_linear_sRGB(lab);
        vec3 rgb = linear_to_sRGB(rgb_linear);

        /* DOT GRID */
        float smoothing = gridY * 0.0013;
        float offsetX = fract(gridX) * 0.5 / gridX;
        float offsetY = fract(gridY) * 0.5 / gridY;
        vec2 centeredUV = vUV - vec2(offsetX, offsetY);
        float dist = 1.0 - smoothstep(
          radius - smoothing,
          radius + smoothing,
          distance(vec2(mod(centeredUV.x * gridX, 1.0), mod(centeredUV.y * gridY, 1.0)), vec2(0.5))
        );

        fragColor = vec4(rgb * dist, dist);
      }
    `;

    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(fragmentShader);
    gl.attachShader(program, fragmentShader);

    gl.linkProgram(program);
    gl.useProgram(program);

    chromaLocation = gl.getUniformLocation(program, 'chroma')!;
    gridXLocation = gl.getUniformLocation(program, 'gridX')!;
    gridYLocation = gl.getUniformLocation(program, 'gridY')!;
  }

  function setCanvasColor(e: PointerEvent){
    const rect = canvasContainerRef.getBoundingClientRect();
    const x =
      Math.min(Math.max(e.clientX - rect.left, 0), rect.width) / rect.width;
    const y =
      Math.min(Math.max(e.clientY - rect.top, 0), rect.height) / rect.height;
    batch(() => {
      setLightness(1 - y);
      setHue(x * 360);
    });
  }

  function handleCanvasPointerDown(e: PointerEvent){
    setCanvasThumbDrag(true);
    setCanvasColor(e);
  }

  function handlePointerMove(e: PointerEvent){
    if(canvasThumbDrag()){
      setCanvasColor(e);
    }
  }

  function handlePointerUp(){
    setCanvasThumbDrag(false);
  }

  function handleChromaChange(e: Event){
    const value = Math.max(0.0, Math.min(0.37, parseFloat((e.target as HTMLInputElement).value)));
    setChroma(
      value,
      parseFloat(sliderSaturationRef.value)
    );
  }

  function handleSaturationChange(e: Event){
    const value = Math.max(0.0, Math.min(1.0, parseFloat((e.target as HTMLInputElement).value)));
    setSaturation(value);
  }

  function handleContrastChange(e: Event){
    const value = Math.max(0.0, Math.min(0.8, parseFloat((e.target as HTMLInputElement).value)));
    setContrast(value);
  }

  function handleDepthChange(e: Event){
    const value = Math.max(0.0, Math.min(0.4, parseFloat((e.target as HTMLInputElement).value)));
    setThemeDepth(value);
  }

  onMount(() => {
    setupWebGL();

    function updateCanvasSize(){
      const rect = canvasContainerRef.getBoundingClientRect();
      canvasRef.width = rect.width * devicePixelRatio;
      canvasRef.height = rect.height * devicePixelRatio;
      gl.viewport(0, 0, canvasRef.width, canvasRef.height);
      gl.uniform1f(gridXLocation, rect.width / 8.3);
      gl.uniform1f(gridYLocation, rect.height / 8.3);
      gl.uniform1f(chromaLocation, themeReactive.a0.c[0]());
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    resizeObserver = new ResizeObserver(updateCanvasSize);
    resizeObserver.observe(canvasContainerRef);
    updateCanvasSize();

    createEffect(() => {
      gl.uniform1f(chromaLocation, themeReactive.a0.c[0]());
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });

    createEffect(() => {
      canvasThumbRef.style.left = `${themeReactive.a0.h[0]() / 3.6}%`;
      canvasThumbRef.style.top = `${(1 - themeReactive.a0.l[0]()) * 100}%`;
    });

    document.addEventListener('pointermove', handlePointerMove, {passive: true});
    document.addEventListener('pointerup', handlePointerUp, {passive: true});
  });

  onCleanup(() => {
    resizeObserver.disconnect();
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerUp);
  });

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
        class="@container"
        style="
          font-family: var(--font-sans);
          padding: 8px 20px 12px 20px;
          background-color: var(--b0);
          box-sizing: border-box;
          height: min-content;
          font-weight: 500;
          font-size: 12px;
        "
      >
       <div class="grid gap-5 @2xl:grid-cols-2 @2xl:items-start">
        <div
          onPointerDown={handleCanvasPointerDown}
          ref={canvasContainerRef}
          class={isMobile() ? 'h-[140px]' : 'h-[250px]'}
          style={{
            'border': '1px solid var(--b4)',
            'border-radius': '6px',
            'position': 'relative',
            'width': '100%',
          }}
        >
          <canvas
            style="
              background-color: #000c; /* scuffed */
              border-radius: 5px;
              touch-action: none;
              user-select: none;
              display: block;
              height: 100%;
              width: 100%;
            "
            ref={canvasRef}
          />
          <div
            style="
              transform: translate(-50%, -50%);
              background-color: var(--a0);
              border: 1px solid var(--b4);
              box-sizing: border-box;
              border-radius: 2px;
              position: absolute;
              height: 18px;
              width: 18px;
            "
            ref={canvasThumbRef}
          />
        </div>

        <div
          class="grid h-min w-full gap-3 @2xl:gap-5"
          style="
            --b4: color-mix(in oklch, oklch(var(--b4l) var(--b4c) var(--b4h)), oklch(var(--c4l) var(--c4c) var(--c4h)) 30%);
          "
        >
          <div class="flex items-center gap-2 @2xl:flex-col @2xl:items-stretch @2xl:gap-[3px]">
          <div class="w-[9ch] shrink-0 @2xl:w-auto">Chroma</div>
          <div class="flex flex-1 items-center gap-3 min-w-0 @2xl:flex-none">
          <div
            style="
              box-sizing: border-box;
              position: relative;
              height: 10px;
              min-width: 0;
              flex: 1;
            "
          >
            <div
              style="
                background: linear-gradient(to right, oklch(from var(--a0) l 0.0 h), oklch(from var(--a0) l 0.37 h));
                transform: translate(-50%, -50%);
                border: 1px solid var(--b4);
                box-sizing: border-box;
                border-radius: 2px;
                position: absolute;
                height: 10px;
                width: 100%;
                left: 50%;
                top: 50%;
              "
            />

            <div
              style={{
                'left': `${themeReactive.a0.c[0]() * (100 / 0.37)}%`,
                'transform': 'translate(-50%, -50%)',
                'background-color': 'var(--a0)',
                'border': '1px solid var(--b4)',
                'box-sizing': 'border-box',
                'border-radius': '2px',
                'position': 'absolute',
                'height': '18px',
                'width': '9px',
                'top': '50%',
              }}
            />

            <input
              onInput={(e) => { handleChromaChange(e);}}
              value={themeReactive.a0.c[0]().toString()}
              class="theme-editor-basic-slider"
              style="
                appearance: none;
                -webkit-appearance: none;
                width: calc(100% + 18px);
                box-sizing: border-box;
                border-radius: 2px;
                position: absolute;
                background: #0000;
                outline: none;
                height: 100%;
                left: -9px;
                margin: 0;
                top: 0;
              "
              step="0.001"
              type="range"
              max="0.37"
              min="0.0"
            />
          </div>
          <NumberInput
            get={() => themeReactive.a0.c[0]()}
            set={(n) => setChroma(n, parseFloat(sliderSaturationRef.value))}
            min={0}
            max={0.37}
          />
          </div>
          </div>

          <div class="flex items-center gap-2 @2xl:flex-col @2xl:items-stretch @2xl:gap-[3px]">
          <div class="w-[9ch] shrink-0 @2xl:w-auto">Tint</div>
          <div class="flex flex-1 items-center gap-3 min-w-0 @2xl:flex-none">
          <div
            style="
              box-sizing: border-box;
              position: relative;
              height: 10px;
              min-width: 0;
              flex: 1;
            "
          >
            <div
              style="
                grid-template-columns: 50fr 40.5fr 32fr 24.5fr 18fr 12.5fr 8fr 5fr 2fr 0.5fr;
                transform: translate(-50%, -50%);
                background-color: var(--b4);
                border: 1px solid var(--b4);
                box-sizing: border-box;
                border-radius: 2px;
                position: absolute;
                overflow: clip;
                display: grid;
                height: 10px;
                width: 100%;
                left: 50%;
                top: 50%;
                gap: 1px;
              "
            >
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
            </div>

            <div
              style={{
                'left': `${(themeReactive.b0.c[0]() / (themeReactive.a0.c[0]() * 0.6) / 0.37) * 100}%`,
                'transform': 'translate(-50%, -50%)',
                'border': '1px solid var(--b4)',
                'background-color': 'var(--b0)',
                'box-sizing': 'border-box',
                'border-radius': '2px',
                'position': 'absolute',
                'height': '18px',
                'width': '9px',
                'top': '50%',
              }}
            />

            <input
              onInput={(e) => {handleSaturationChange(e);}}
              class="theme-editor-basic-slider"
              style="
                appearance: none;
                -webkit-appearance: none;
                width: calc(100% + 18px);
                box-sizing: border-box;
                border-radius: 2px;
                position: absolute;
                background: #0000;
                outline: none;
                height: 100%;
                left: -9px;
                margin: 0;
                top: 0;
              "
              ref={sliderSaturationRef}
              step="0.001"
              type="range"
              value="0"
              max="1.0"
              min="0.0"
            />
          </div>
          <NumberInput
            get={() => {
              const denom = themeReactive.a0.c[0]() * 0.37 * 0.6;
              return denom ? themeReactive.b0.c[0]() / denom : 0;
            }}
            set={(n) => setSaturation(n)}
            min={0}
            max={1}
          />
          </div>
          </div>

          <div class="flex items-center gap-2 @2xl:flex-col @2xl:items-stretch @2xl:gap-[3px]">
          <div class="w-[9ch] shrink-0 @2xl:w-auto">Contrast</div>
          <div class="flex flex-1 items-center gap-3 min-w-0 @2xl:flex-none">
          <div
            style="
              box-sizing: border-box;
              position: relative;
              height: 10px;
              min-width: 0;
              flex: 1;
            "
          >
            <div
              style="
                grid-template-columns:  0.5fr 2fr 5fr 8fr 12.5fr 18fr 50fr 50fr 18fr 12.5fr 8fr 5fr 2fr 0.5fr;
                transform: translate(-50%, -50%);
                background-color: var(--b4);
                border: 1px solid var(--b4);
                box-sizing: border-box;
                border-radius: 2px;
                position: absolute;
                overflow: clip;
                display: grid;
                height: 10px;
                width: 100%;
                left: 50%;
                top: 50%;
                gap: 1px;
              "
            >
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
            </div>

            <div
              style={{
                'left': `${(getContrastFromY(themeReactive.b0.l[0]()) / 0.8) * 100}%`,
                'transform': 'translate(-50%, -50%)',
                'background-color': 'var(--b0)',
                'border': '1px solid var(--b4)',
                'box-sizing': 'border-box',
                'border-radius': '2px',
                'position': 'absolute',
                'height': '18px',
                'width': '9px',
                'top': '50%',
              }}
            />

            <input
              onInput={(e) => {
                handleContrastChange(e);
              }}
              class="theme-editor-basic-slider"
              style="
                appearance: none;
                -webkit-appearance: none;
                width: calc(100% + 18px);
                box-sizing: border-box;
                border-radius: 2px;
                position: absolute;
                background: #0000;
                outline: none;
                height: 100%;
                left: -9px;
                margin: 0;
                top: 0;
               "
              ref={sliderContrastRef}
              type="range"
              step="0.001"
              value="0"
              max="0.8"
              min="0.0"
            />
          </div>
          <NumberInput
            get={() => getContrastFromY(themeReactive.b0.l[0]())}
            set={(n) => setContrast(n)}
            min={0}
            max={0.8}
            displayMin={-100}
            displayMax={100}
            action={
              <button
                type="button"
                aria-label="Flip light / dark"
                onPointerDown={flipLightDark}
                class="flex shrink-0 cursor-pointer items-center justify-center text-ink-muted hover:text-ink"
                style="width: 14px; height: 14px; padding: 0; border: none; background: none;"
              >
                <IconFlip style={{ width: '14px', height: '14px' }} />
              </button>
            }
          />
          </div>
          </div>

          <div class="flex items-center gap-2 @2xl:flex-col @2xl:items-stretch @2xl:gap-[3px]">
          <div class="w-[9ch] shrink-0 @2xl:w-auto">Depth</div>
          <div class="flex flex-1 items-center gap-3 min-w-0 @2xl:flex-none">
          <div
            style="
              box-sizing: border-box;
              position: relative;
              height: 10px;
              min-width: 0;
              flex: 1;
            "
          >
            <div
              style="
                grid-template-columns: 50fr 40.5fr 32fr 24.5fr 18fr 12.5fr 8fr 5fr 2fr 0.5fr;
                transform: translate(-50%, -50%);
                background-color: var(--b4);
                border: 1px solid var(--b4);
                box-sizing: border-box;
                border-radius: 2px;
                position: absolute;
                overflow: clip;
                display: grid;
                height: 10px;
                width: 100%;
                left: 50%;
                top: 50%;
                gap: 1px;
              "
            >
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
              <div style="background-color: var(--b0); height: 100%; width: 100%;" />
            </div>

            <div
              style={{
                'left': `${(themeDepth() / 0.4) * 100}%`,
                'transform': 'translate(-50%, -50%)',
                'background-color': 'var(--b0)',
                'border': '1px solid var(--b4)',
                'box-sizing': 'border-box',
                'border-radius': '2px',
                'position': 'absolute',
                'height': '18px',
                'width': '9px',
                'top': '50%',
              }}
            />

            <input
              onInput={(e) => {
                handleDepthChange(e);
              }}
              class="theme-editor-basic-slider"
              style="
                appearance: none;
                -webkit-appearance: none;
                width: calc(100% + 18px);
                box-sizing: border-box;
                border-radius: 2px;
                position: absolute;
                background: #0000;
                outline: none;
                height: 100%;
                left: -9px;
                margin: 0;
                top: 0;
              "
              value={themeDepth()}
              ref={sliderDepthRef}
              type="range"
              step="0.001"
              max="0.4"
              min="0.0"
            />
          </div>
          <NumberInput
            get={() => themeDepth()}
            set={(n) => setThemeDepth(n)}
            min={0}
            max={0.4}
          />
          </div>
          </div>
        </div>
       </div>
      </div>
    </>
  );
}
