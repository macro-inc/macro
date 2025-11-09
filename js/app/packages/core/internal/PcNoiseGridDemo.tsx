import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import { DebugSlider } from '@core/component/Slider';
import { Bar } from '@core/component/TopBar/Bar';
import { createSignal } from 'solid-js';

export default function PcNoiseGridDemo() {
  const [cellSize, setCellSize] = createSignal(50);
  const [warp, setWarp] = createSignal(0.2);
  const [crunch, setCrunch] = createSignal(0.0);
  const [freq, setFreq] = createSignal(0.0002);
  const [sizeMin, setSizeMin] = createSignal(0.05);
  const [sizeMax, setSizeMax] = createSignal(0.45);
  const [rounding, setRounding] = createSignal(5);
  const [fill, setFill] = createSignal(1);
  const [stroke, setStroke] = createSignal(0);
  const [speedX, setSpeedX] = createSignal(0.4);
  const [speedY, setSpeedY] = createSignal(0.4);
  const [circleMask, setCircleMask] = createSignal(0);

  const generateComponentCode = () => {
    const props = [];
    if (cellSize() !== 100) props.push(`cellSize={${cellSize()}}`);
    if (warp() !== 0.2) props.push(`warp={${warp()}}`);
    if (crunch() !== 0.0) props.push(`crunch={${crunch()}}`);
    if (freq() !== 0.0002) props.push(`freq={${freq()}}`);
    if (sizeMin() !== 0.05 || sizeMax() !== 0.45)
      props.push(`size={[${sizeMin()}, ${sizeMax()}]}`);
    if (rounding() !== 5) props.push(`rounding={${rounding()}}`);
    if (fill() !== 1) props.push(`fill={${fill()}}`);
    if (stroke() !== 0) props.push(`stroke={${stroke()}}`);
    if (speedX() !== 0.4 || speedY() !== 0.4)
      props.push(`speed={[${speedX()}, ${speedY()}]}`);
    if (circleMask() !== 0) props.push(`circleMask={${circleMask()}}`);

    return `<PcNoiseGrid${props.length > 0 ? '\n  ' + props.join('\n  ') + '\n' : ''} />`;
  };

  return (
    <div class="flex flex-col h-full w-full">
      <Bar
        left={<div class="p-2 text-sm w-2xl truncate">PcNoiseGrid</div>}
        center={<div></div>}
      ></Bar>
      <div class="flex flex-row h-full w-full">
        {/* Left side - PcNoiseGrid preview */}
        <div class="flex-1 relative bg-panel flex items-center justify-center p-4">
          <div class="w-full h-full flex items-center justify-center border border-edge">
            <div class="w-full h-full relative bg-panel text-accent">
              <PcNoiseGrid
                cellSize={cellSize()}
                warp={warp()}
                crunch={crunch()}
                freq={freq()}
                size={[sizeMin(), sizeMax()]}
                rounding={rounding()}
                fill={fill()}
                stroke={stroke()}
                speed={[speedX(), speedY()]}
                circleMask={circleMask()}
              />
            </div>
          </div>
        </div>

        {/* Right side - Controls */}
        <div class="w-[50%] max-w-lg bg-panel p-4 overflow-y-auto border-l border-edge border-dashed">
          <h2 class="font-mono mb-6">PcNoiseGrid Generator</h2>

          <div class="space-y-6">
            <DebugSlider
              label="Cell Size"
              value={cellSize()}
              onChange={setCellSize}
              min={20}
              max={200}
              step={1}
            />

            <DebugSlider
              label="Warp"
              value={warp()}
              onChange={setWarp}
              min={0}
              max={10}
              step={0.001}
              decimals={3}
            />

            <DebugSlider
              label="Crunch"
              value={crunch()}
              onChange={setCrunch}
              min={0}
              max={0.5}
              step={0.001}
              decimals={3}
            />

            <DebugSlider
              label="Frequency"
              value={freq()}
              onChange={setFreq}
              min={0.00001}
              max={0.001}
              step={0.00001}
              decimals={6}
            />

            <DebugSlider
              label="Size Min"
              value={sizeMin()}
              onChange={setSizeMin}
              min={0}
              max={1}
              step={0.001}
              decimals={3}
            />

            <DebugSlider
              label="Size Max"
              value={sizeMax()}
              onChange={setSizeMax}
              min={0}
              max={1}
              step={0.001}
              decimals={3}
            />

            <DebugSlider
              label="Rounding"
              value={rounding()}
              onChange={setRounding}
              min={0}
              max={50}
              step={0.1}
              decimals={1}
            />

            <DebugSlider
              label="Fill"
              value={fill()}
              onChange={setFill}
              min={0}
              max={1}
              step={0.001}
              decimals={3}
            />

            <DebugSlider
              label="Stroke"
              value={stroke()}
              onChange={setStroke}
              min={0}
              max={1}
              step={0.001}
              decimals={3}
            />

            <DebugSlider
              label="Speed X"
              value={speedX()}
              onChange={setSpeedX}
              min={0}
              max={1}
              step={0.001}
              decimals={3}
            />

            <DebugSlider
              label="Speed Y"
              value={speedY()}
              onChange={setSpeedY}
              min={0}
              max={1}
              step={0.001}
              decimals={3}
            />

            <DebugSlider
              label="Circle Mask"
              value={circleMask()}
              onChange={setCircleMask}
              min={0}
              max={1}
              step={0.001}
              decimals={3}
            />
          </div>

          {/* Actions */}
          <div class="mt-8 space-y-3">
            <button
              onClick={() =>
                navigator.clipboard.writeText(generateComponentCode())
              }
              class="w-full px-4 py-2 bg-ink-extra-muted text-page font-medium"
            >
              Copy Component Code
            </button>
          </div>

          {/* Generated Code */}
          <div class="mt-8">
            <h3 class="font-mono text-ink-muted mb-3">Generated Code</h3>
            <div class="p-4 rounded-xs bg-message overflow-x-auto max-h-96">
              <pre class="text-xs font-mono whitespace-pre-wrap text-ink-muted">
                {generateComponentCode()}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
