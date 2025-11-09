import { DebugSlider } from '@core/component/Slider';
import { Bar } from '@core/component/TopBar/Bar';
import { createSignal } from 'solid-js';

/**
 * Generates animated SVG noise grids with configurable parameters
 */
interface SvgNoiseGridParams {
  /** Number of pixels horizontally */
  xCount?: number;
  /** Number of pixels vertically */
  yCount?: number;
  /** Random seed for reproducible patterns */
  seed?: number;
  /** Total width of the SVG viewBox */
  w?: number;
  /** Total height of the SVG viewBox */
  h?: number;
  /** Size of each pixel (width and height) */
  size?: number;
  /** Corner radius for rounded pixels */
  cornerRadius?: number;
  /** Animation speed multiplier */
  speed?: number;
}

/**
 * Simple pseudo-random number generator using seed
 */
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed % 2147483647;
    if (this.seed <= 0) this.seed += 2147483646;
  }

  next(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

/**
 * Generates an animated SVG noise grid
 */
function generateSvgNoiseGrid(params: SvgNoiseGridParams = {}): string {
  const {
    xCount = 4,
    yCount = 4,
    seed = 12345,
    w = 32,
    h = 32,
    size = 6,
    cornerRadius = 6,
    speed = 1.0,
  } = params;

  const rng = new SeededRandom(seed);

  // Calculate spacing between pixels
  const spacingX = (w - size) / (xCount - 1);
  const spacingY = (h - size) / (yCount - 1);

  // Generate pixels with random animation properties
  const pixels: Array<{
    x: number;
    y: number;
    duration: number;
    delay: number;
  }> = [];

  for (let row = 0; row < yCount; row++) {
    for (let col = 0; col < xCount; col++) {
      const x = col * spacingX;
      const y = row * spacingY;

      // Generate random animation properties
      const baseDuration = 0.35;
      const duration = baseDuration + rng.range(-0.1, 0.1);
      const delay = rng.range(0, 0.15);

      pixels.push({
        x: Math.round(x),
        y: Math.round(y),
        duration: duration * (1 / speed),
        delay: delay * (1 / speed),
      });
    }
  }

  // Generate SVG
  const svgContent = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="background: transparent">
  <style>
    .px { fill: currentColor; pointer-events: none; }
    .a { animation-timing-function: steps(1, end); animation-iteration-count: infinite; }

    @keyframes flick {
      0%, 100% { opacity: 1; }
      71% { opacity: 0; }
    }
  </style>

  <defs>
    <rect id="pixel" width="${size}" height="${size}" class="px a" rx="${cornerRadius}" ry="${cornerRadius}" />
  </defs>

${pixels
  .map((pixel, index) => {
    const row = Math.floor(index / xCount);
    const isFirstInRow = index % xCount === 0;
    const rowComment = isFirstInRow ? `\n  <!-- Row ${row} -->` : '';

    return `${rowComment}
  <use href="#pixel" x="${pixel.x}" y="${pixel.y}" style="animation: flick ${pixel.duration.toFixed(2)}s infinite; animation-delay: ${pixel.delay.toFixed(2)}s"/>`;
  })
  .join('')}
</svg>`;

  return svgContent;
}

export default function SvgNoiseGridDemo() {
  const [xCount, setXCount] = createSignal(4);
  const [yCount, setYCount] = createSignal(4);
  const [w, setW] = createSignal(32);
  const [h, setH] = createSignal(32);
  const [size, setSize] = createSignal(6);
  const [cornerRadius, setCornerRadius] = createSignal(6);
  const [speed, setSpeed] = createSignal(1.0);

  const generateSvg = () => {
    return generateSvgNoiseGrid({
      xCount: xCount(),
      yCount: yCount(),
      seed: 0,
      w: w(),
      h: h(),
      size: size(),
      cornerRadius: cornerRadius(),
      speed: speed(),
    });
  };

  const downloadSvg = () => {
    const svg = generateSvg();
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `noise-grid.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div class="flex flex-col h-full w-full">
      <Bar
        left={
          <div class="p-2 text-sm w-2xl truncate">SVG Noise Grid Generator</div>
        }
        center={<div></div>}
      ></Bar>
      <div class="flex h-full w-full">
        <div class="flex-1 relative bg-panel flex items-center justify-center">
          <div class="w-64 h-64 flex items-center justify-center border border-edge">
            <div
              id="svg-preview"
              class="text-accent"
              style="width: 64px; height: 64px;"
              innerHTML={generateSvg()}
            />
          </div>
        </div>

        <div class="w-[50%] max-w-lg bg-panel p-4 overflow-y-auto border-l border-edge border-dashed">
          <h2 class="font-mono mb-6">SVG Noise Grid Generator</h2>

          <div class="space-y-6">
            <DebugSlider
              label="X Count"
              value={xCount()}
              onChange={setXCount}
              min={1}
              max={10}
              step={1}
            />

            <DebugSlider
              label="Y Count"
              value={yCount()}
              onChange={setYCount}
              min={1}
              max={10}
              step={1}
            />

            <DebugSlider
              label="Width"
              value={w()}
              onChange={setW}
              min={16}
              max={128}
              step={1}
            />

            <DebugSlider
              label="Height"
              value={h()}
              onChange={setH}
              min={16}
              max={128}
              step={1}
            />

            <DebugSlider
              label="Pixel Size"
              value={size()}
              onChange={setSize}
              min={1}
              max={20}
              step={0.5}
              decimals={1}
            />

            <DebugSlider
              label="Corner Radius"
              value={cornerRadius()}
              onChange={setCornerRadius}
              min={0}
              max={20}
              step={0.5}
              decimals={1}
            />

            <DebugSlider
              label="Speed"
              value={speed()}
              onChange={setSpeed}
              min={0.1}
              max={3.0}
              step={0.1}
              decimals={2}
            />
          </div>

          {/* Actions */}
          <div class="mt-8 space-y-3">
            <button
              onClick={downloadSvg}
              class="w-full px-4 py-2 bg-ink-extra-muted text-page font-medium"
            >
              Download SVG
            </button>

            <button
              onClick={() => navigator.clipboard.writeText(generateSvg())}
              class="w-full px-4 py-2 bg-ink-extra-muted text-page font-medium"
            >
              Copy SVG Code
            </button>
          </div>

          {/* Generated SVG Code */}
          <div class="mt-8">
            <h3 class="font-mono text-ink-muted mb-3">Generated SVG</h3>
            <div class="p-4  rounded-xs bg-message overflow-x-auto max-h-96">
              <pre class="text-xs font-mono whitespace-pre-wrap text-ink-muted">
                {generateSvg()}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
