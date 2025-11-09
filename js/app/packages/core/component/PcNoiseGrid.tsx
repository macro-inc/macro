import {
  bindUniforms,
  boxSdf,
  compileShader,
  createProgram,
  fullScreenQuad,
  getCanvasSize,
  glsl,
  simplexNoise3d,
  type Vec3,
  vec2,
  vec3,
} from '@baby-gl';
import { oklchToRgb } from '@core/util/oklchToRgb';
import { withRecall } from '@core/util/withRecall';
import { createEffect, onCleanup, onMount } from 'solid-js';

const vert = glsl`
  precision mediump float;
  attribute vec2 aPos;

  varying vec2 vUv;

  void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

const frag = glsl`
  precision mediump float;

  varying vec2 vUv;

  uniform float uTime;
  uniform float uCellSize;
  uniform float uWarp;
  uniform float uCrunch;
  uniform float uRounding;
  uniform float uFreq;
  uniform float uFill;
  uniform float uStroke;
  uniform float uCircleMask;

  uniform vec2 uSize;
  uniform vec2 uSpeed;

  uniform vec3 uBg;
  uniform vec3 uFg;

  ${boxSdf}
  ${simplexNoise3d}

  void main() {
    vec2 p = gl_FragCoord.xy;
    vec2 cellIndex = floor(p / uCellSize);
    vec2 cellOrigin = cellIndex * uCellSize;
    vec2 cellCenter = cellOrigin + 0.5 * uCellSize;

    // Local coords in pixels centered at cell center
    vec2 local = p - cellCenter;
    vec2 offset = uTime * uSpeed;

    vec2 sampleCoord = cellCenter * uFreq;
    float noiseOffsetX = snoise(vec3( sampleCoord.x, sampleCoord.y, uTime * uSpeed + 400.0 ));
    float noiseOffsetY = snoise(vec3( sampleCoord.y, sampleCoord.y, uTime * uSpeed + 100.0 ));

    vec2 distortedSampleCoord = mix(sampleCoord, sampleCoord + vec2(noiseOffsetX, noiseOffsetY), uWarp);

    float sample = snoise(vec3( distortedSampleCoord.x, distortedSampleCoord.y, uTime * uSpeed ));
    sample = 0.5 + 0.5 * sample; // Remap noise to [0,1]
    sample = smoothstep(uCrunch, 1.0 - uCrunch, sample);

    // Apply circle mask
    vec2 screenCenter = vUv - 0.5;
    float circleDist = length(screenCenter);
    float circleRadius = 0.5;
    float circleMask = 1.0 - smoothstep(circleRadius * (1.0 - uCircleMask), circleRadius, circleDist);
    sample *= mix(1.0, circleMask, step(0.001, uCircleMask));

    float halfMin = uSize.x * uCellSize;
    float halfMax = uSize.y * uCellSize;
    float halfSize = mix(halfMin, halfMax, sample);

    float d = box(local, vec2(halfSize), min(uRounding, halfSize));
    float fill = smoothstep(0.0, 0.1, d);
    float stroke = smoothstep(0.9, 1.0, abs(abs(d) - 0.5));
    float factor = 1.0 - clamp(fill * uFill + stroke * uStroke, 0.0, 1.0);

    vec3 col = mix(uBg, uFg, factor);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const uniformConfig = {
  uTime: { type: 'float' as const, default: 0 },
  uCellSize: { type: 'float' as const, default: 100 },
  uWarp: { type: 'float' as const, default: 0.2 },
  uCrunch: { type: 'float' as const, default: 0.0 },
  uFreq: { type: 'float' as const, default: 0.0002 },
  uSpeed: { type: 'vec2' as const, default: vec2(0.4, 0.4) },
  uSize: { type: 'vec2' as const, default: vec2(0.05, 0.45) },
  uRounding: { type: 'float' as const, default: 5 },
  uBg: { type: 'vec3' as const, default: vec3(0, 0, 0) },
  uFg: { type: 'vec3' as const, default: vec3(1, 1, 1) },
  uFill: { type: 'float' as const, default: 1 },
  uStroke: { type: 'float' as const, default: 0 },
  uCircleMask: { type: 'float' as const, default: 0 },
};

export function PcNoiseGrid(props: {
  cellSize?: number;
  warp?: number;
  crunch?: number;
  freq?: number;
  size?: [number, number];
  rounding?: number;
  fill?: number;
  stroke?: number;
  speed?: [number, number];
  circleMask?: number;
}) {
  let canvas!: HTMLCanvasElement;
  let animationId: number;

  const getRgbFromOklch = withRecall((oklch: string) =>
    oklchToRgb(oklch, { gammaCorrect: true, normalized: true })
  );
  onCleanup(() => {
    getRgbFromOklch.clear();
  });

  onMount(() => {
    try {
      const gl = canvas.getContext('webgl2');
      if (!gl) {
        throw new Error('WebGL2 not supported');
      }

      const extractColors = () => {
        const computedStyle = getComputedStyle(canvas);
        const bgValue = computedStyle
          .getPropertyValue('background-color')
          .trim();
        const fgValue = computedStyle.getPropertyValue('color').trim();
        const bg = (getRgbFromOklch(bgValue) || [0, 0, 0]) as any as Vec3;
        const fg = (getRgbFromOklch(fgValue) || [1, 1, 1]) as any as Vec3;
        return { fg, bg };
      };

      const vs = compileShader(gl, 'vertex', vert);
      const fs = compileShader(gl, 'fragment', frag);
      const program = createProgram(gl, vs, fs);
      const quad = fullScreenQuad(gl, program, 'aPos');

      const { set } = bindUniforms(gl, program, uniformConfig);

      const animate = () => {
        const currentTime = performance.now() / 1000;
        const [w, h] = getCanvasSize(canvas);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        gl.viewport(0, 0, w, h);
        set({ uTime: currentTime });
        const { fg, bg } = extractColors();
        set({ uFg: fg, uBg: bg });
        quad.draw();
        animationId = requestAnimationFrame(animate);
      };

      // Start animation loop
      animate();

      onCleanup(() => {
        if (animationId) {
          cancelAnimationFrame(animationId);
        }
        quad.delete();
        gl.deleteProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      });

      createEffect(() => {
        if (props.cellSize !== undefined) set({ uCellSize: props.cellSize });
        if (props.circleMask !== undefined)
          set({ uCircleMask: props.circleMask });
        if (props.crunch !== undefined) set({ uCrunch: props.crunch });
        if (props.fill !== undefined) set({ uFill: props.fill });
        if (props.freq !== undefined) set({ uFreq: props.freq });
        if (props.rounding !== undefined) set({ uRounding: props.rounding });
        if (props.size !== undefined) set({ uSize: props.size });
        if (props.speed !== undefined) set({ uSpeed: props.speed });
        if (props.stroke !== undefined) set({ uStroke: props.stroke });
        if (props.warp !== undefined) set({ uWarp: props.warp });
      });
    } catch (error) {
      console.error(error);
    }
  });

  return (
    <canvas ref={canvas} class="pointer-none bg-inherit w-full h-full block" />
  );
}
