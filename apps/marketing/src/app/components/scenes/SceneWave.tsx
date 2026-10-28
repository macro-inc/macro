import { createNoise3D } from 'simplex-noise';
import { createSignal, Index, onCleanup, onMount } from 'solid-js';
import svgWave from '../../../assets/scenes/scene-wave.svg?raw';
import { SvgGroup } from '../../../lib/svggg/components/SvgGroup';
import { SvgPath } from '../../../lib/svggg/components/SvgPath';
import { SvgScene } from '../../../lib/svggg/components/SvgScene';
import { parseSvg } from '../../../lib/svggg/utils/svgParse';

const pathsM1 = parseSvg(svgWave, '1');
const pathsM2 = parseSvg(svgWave, '2');
const pathsM3 = parseSvg(svgWave, '3');

const noise3D = createNoise3D();

const HEIGHT = 140;
const WIDTH = 280;
const ROWS = 13;
const COLS = 7;

export function SceneWave() {
  const [time, setTime] = createSignal(0);

  let animationId: number;

  onMount(() => {
    const animate = () => {
      setTime((t) => t + 0.005);
      animationId = requestAnimationFrame(animate);
    };
    animationId = requestAnimationFrame(animate);
  });

  onCleanup(() => {
    cancelAnimationFrame(animationId);
  });

  function remap(value: number, exponent: number = 3) {
    return Math.pow(value, exponent);
  }

  const waveAmplitude = 50;
  const noiseScale = 0.005;
  function getWaveValues(x: number, y: number) {
    const noiseValue = noise3D(x * noiseScale + time(), y * noiseScale, 0);
    const normalized = (noiseValue + 1) / 2;
    const remapped = remap(normalized);
    const z = remapped * waveAmplitude;
    const opacity = remapped * 0.7 + 0.05;
    return { z, opacity };
  }

  return (
    <SvgScene
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      rotation={{ x: 50, y: 0, z: 0 }}
      style={{
        'stroke-linejoin': 'round',
        'box-sizing': 'border-box',
        'stroke-linecap': 'round',
        'stroke-width': '0.5',
        stroke: 'var(--a0)',
        display: 'block',
        width: '100%',
      }}
      orbitConstraints={{
        x: { min: -10, max: 10 },
        zoom: { min: 1, max: 1 },
      }}
      orbitAxes={['x', 'z']}
      orbitControls
    >
      <SvgGroup rotation={{ x: 0, y: 0, z: time() * 10 }}>
        <SvgGroup
          translation={{
            x: WIDTH * 0.5 - ((COLS - 1) * 52 + (ROWS - 1) * 3) * 0.5,
            y: HEIGHT * 0.5 - ((COLS - 1) * 12 + (ROWS - 1) * 26) * 0.5,
            z: 0,
          }}
        >
          <Index each={Array(ROWS)}>
            {(_, y) => (
              <Index each={Array(COLS)}>
                {(_, x) => {
                  const baseX = x * 52 + y * 3;
                  const baseY = x * 12 + y * 26;
                  const wave = (originX: number) =>
                    getWaveValues(baseX + originX, baseY);

                  return (
                    <>
                      <SvgPath
                        translation={{ x: baseX, y: baseY, z: wave(6).z }}
                        style={{
                          fill: `oklch(from var(--a0) l c h / ${wave(6).opacity})`,
                          stroke: 'var(--a0)',
                        }}
                        paths={pathsM1}
                      />
                      <SvgPath
                        translation={{ x: baseX, y: baseY, z: wave(20).z }}
                        style={{
                          fill: `oklch(from var(--a0) l c h / ${wave(20).opacity})`,
                          stroke: 'var(--a0)',
                        }}
                        paths={pathsM2}
                      />
                      <SvgPath
                        translation={{ x: baseX, y: baseY, z: wave(40).z }}
                        style={{
                          fill: `oklch(from var(--a0) l c h / ${wave(40).opacity})`,
                          stroke: 'var(--a0)',
                        }}
                        paths={pathsM3}
                      />
                    </>
                  );
                }}
              </Index>
            )}
          </Index>
        </SvgGroup>
      </SvgGroup>
    </SvgScene>
  );
}
