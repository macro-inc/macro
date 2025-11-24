import { batch, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { themeReactive } from '../signals/themeReactive';

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
  const s = saturation * themeReactive.a0.c[0]() * 0.37 * 0.8;

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
  return ((-2 * Math.log(1 / (-(y - 0.5) / (0.5 / (1 / (1 + Math.exp(q / 2)) - 0.5)) + 0.5) - 1) - (-2 * Math.log(1 / (-(y - 0.5) / (0.5 / (1 / (1 + Math.exp(q / 2)) - 0.5)) + 0.5) - 1) < 0 ? -1 : 1)) / (q - 1) / 2 + 0.5);
}

function setContrast(contrast: number) {
  const c = (contrast - 0.5) * 2;
  const p = c < 0 ? -1 : 1;
  const b = c * (q - 1) + p;

  batch(() => {
    themeReactive.b0.l[1](sigmoid(0.0, b));
    themeReactive.b1.l[1](sigmoid(0.1, b));
    themeReactive.b2.l[1](sigmoid(0.2, b));
    themeReactive.b3.l[1](sigmoid(0.3, b));
    themeReactive.b4.l[1](sigmoid(0.4, b));

    themeReactive.c4.l[1](sigmoid(0.6, b));
    themeReactive.c3.l[1](sigmoid(0.7, b));
    themeReactive.c2.l[1](sigmoid(0.8, b));
    themeReactive.c1.l[1](sigmoid(0.9, b));
    themeReactive.c0.l[1](sigmoid(1.0, b));
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

    setContrast(randContrast);
    setChroma(randChroma, randSaturation);
    setSaturation(randSaturation);
  });
}

export function ThemeEditorBasic(){
  const [canvasThumbDrag, setCanvasThumbDrag] = createSignal(false);

  let sliderSaturationRef!: HTMLInputElement;
  let sliderContrastRef!: HTMLInputElement;
  let chromaLocation: WebGLUniformLocation;
  let canvasContainerRef!: HTMLDivElement;
  let canvasThumbRef!: HTMLDivElement;
  let canvasRef!: HTMLCanvasElement;
  let gl: WebGL2RenderingContext;
  let program: WebGLProgram;

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
      const float PI = 3.14159265359;

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
        fragColor = vec4(rgb, 1.0);
      }
    `;

    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(fragmentShader);
    gl.attachShader(program, fragmentShader);

    gl.linkProgram(program);
    gl.useProgram(program);

    chromaLocation = gl.getUniformLocation(program, 'chroma')!;
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
    setChroma(
      parseFloat((e.target as HTMLInputElement).value),
      parseFloat(sliderSaturationRef.value)
    );
  }

  function handleSaturationChange(e: Event){
    setSaturation(parseFloat((e.target as HTMLInputElement).value));
  }

  function handleContrastChange(e: Event){
    setContrast(parseFloat((e.target as HTMLInputElement).value));
  }

  onMount(() => {
    setupWebGL();

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
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerUp);
  });

  return (
    <>
      <style>{`
        .theme-editor-basdic-slider::-webkit-slider-thumb {
          opacity: 0;
        }
        .theme-editor-basdic-slider::-moz-range-thumb {
          opacity: 0;
        }
      `}</style>

      <div
        style="
      font-family: var(--font-mono);
      border: 1px solid var(--b4);
      box-sizing: border-box;
      height: min-content;
      font-weight: 500;
      font-size: 12px;
      display: grid;
      padding: 20px;
      gap: 20px;
    "
      >
        <div
          onPointerDown={handleCanvasPointerDown}
          ref={canvasContainerRef}
          style="
            border: 1px solid var(--b4);
            position: relative;
            height: 250px;
            width: 100%;
          "
        >
          <canvas
            ref={canvasRef}
            style="
              touch-action: none;
              user-select: none;
              display: block;
              height: 100%;
              width: 100%;
            "
          />
          <div
            ref={canvasThumbRef}
            style="
              transform: translate(-50%, -50%);
              background-color: var(--a0);
              border: 1px solid var(--b4);
              box-sizing: border-box;
              position: absolute;
              height: 18px;
              width: 18px;
            "
          />
        </div>

        <div
          style="
            grid-template-columns: 11ch 1fr;
            height: min-content;
            display: grid;
            width: 100%;
            gap: 20px 10px;
          "
        >
          <div style="position: relative;">
            <div
              style="
                transform: translateY(-50%);
                position: absolute;
                top: 50%;
                left: 0;
              "
            >
              chroma:
            </div>
          </div>
          <div
            style="
              box-sizing: border-box;
              position: relative;
              height: 10px;
              width: 100%;
            "
          >
            <div
              style="
                background: linear-gradient(to right, oklch(from var(--a0) l 0.0 h), oklch(from var(--a0) l 0.37 h));
                transform: translate(-50%, -50%);
                border: 1px solid var(--b4);
                box-sizing: border-box;
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
                'border-radius': '0px',
                'position': 'absolute',
                'height': '18px',
                'width': '18px',
                'top': '50%',
              }}
            />

            <input
              value={themeReactive.a0.c[0]().toString()}
              onInput={(e) => {
                handleChromaChange(e);
              }}
              class="theme-editor-basdic-slider"
              style="
                -webkit-appearance: none;
                width: calc(100% + 18px);
                box-sizing: border-box;
                border-radius: 0px;
                position: absolute;
                background: #0000;
                appearance: none;
                cursor: var(--cursor-pointer);
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

          <div style="position: relative;">
            <div
              style="
                transform: translateY(-50%);
                position: absolute;
                top: 50%;
                left: 0;
              "
            >
              saturation:
            </div>
          </div>
          <div
            style="
              box-sizing: border-box;
              position: relative;
              height: 10px;
              width: 100%;
            "
          >
            <div
              style="
                grid-template-columns: 50fr 40.5fr 32fr 24.5fr 18fr 12.5fr 8fr 5fr 2fr 0.5fr;
                transform: translate(-50%, -50%);
                background-color: var(--b4);
                border: 1px solid var(--b4);
                box-sizing: border-box;
                position: absolute;
                display: grid;
                height: 10px;
                width: 100%;
                left: 50%;
                top: 50%;
                gap: 1px;
              "
            >
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
            </div>

            <div
              style={{
                'left': `${(themeReactive.b0.c[0]() / (themeReactive.a0.c[0]() * 0.8) / 0.37) * 100}%`,
                'transform': 'translate(-50%, -50%)',
                'background-color': 'var(--b1)',
                'border': '1px solid var(--b4)',
                'box-sizing': 'border-box',
                'border-radius': '0px',
                'position': 'absolute',
                'height': '18px',
                'width': '18px',
                'top': '50%',
              }}
            />

            <input
              onInput={(e) => {
                handleSaturationChange(e);
              }}
              class="theme-editor-basdic-slider"
              style="
                -webkit-appearance: none;
                width: calc(100% + 18px);
                box-sizing: border-box;
                border-radius: 0px;
                position: absolute;
                background: #0000;
                appearance: none;
                cursor: var(--cursor-pointer);
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

          <div style="position: relative;">
            <div
              style="
                transform: translateY(-50%);
                position: absolute;
                top: 50%;
                left: 0;
              "
            >
              contrast:
            </div>
          </div>
          <div
            style="
              box-sizing: border-box;
              position: relative;
              height: 10px;
              width: 100%;
            "
          >
            <div
              style="
                grid-template-columns:  0.5fr 2fr 5fr 8fr 12.5fr 18fr 50fr 50fr 18fr 12.5fr 8fr 5fr 2fr 0.5fr;
                transform: translate(-50%, -50%);
                background-color: var(--b4);
                border: 1px solid var(--b4);
                box-sizing: border-box;
                position: absolute;
                display: grid;
                height: 10px;
                width: 100%;
                left: 50%;
                top: 50%;
                gap: 1px;
              "
            >
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
              <div style="background-color: var(--b1); height: 100%; width: 100%;" />
            </div>

            <div
              style={{
                'left': `${getContrastFromY(themeReactive.b0.l[0]()) * 100}%`,
                'transform': 'translate(-50%, -50%)',
                'background-color': 'var(--b1)',
                'border': '1px solid var(--b4)',
                'box-sizing': 'border-box',
                'border-radius': '0px',
                'position': 'absolute',
                'height': '18px',
                'width': '18px',
                'top': '50%',
              }}
            />

            <input
              onInput={(e) => {
                handleContrastChange(e);
              }}
              class="theme-editor-basdic-slider"
              style="
                -webkit-appearance: none;
                width: calc(100% + 18px);
                box-sizing: border-box;
                border-radius: 0px;
                position: absolute;
                background: #0000;
                appearance: none;
                cursor: var(--cursor-pointer);
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
              max="1.0"
              min="0.0"
            />
          </div>
        </div>
      </div>
    </>
  );
}
