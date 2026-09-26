import { createEffect, createSignal, Index, onCleanup } from 'solid-js';
import svgGlobe from '../../../assets/scenes/scene-globe.svg?raw';
import type { Timeline } from '../../../lib/animal/types/animalTypes';
import { animate } from '../../../lib/animal/utils/animalClock';
import { SvgGroup } from '../../../lib/svggg/components/SvgGroup';
import { SvgPath } from '../../../lib/svggg/components/SvgPath';
import { SvgScene } from '../../../lib/svggg/components/SvgScene';
import { parseSvg } from '../../../lib/svggg/utils/svgParse';
import { createVisible } from '../../utils/utilVisible';

const pathCircle = parseSvg(svgGlobe, 'circle');

const LAT = 5;
const LON = 5;

export function SceneGlobe() {
  const [rotation, setRotation] = createSignal(0);

  const timeline: Timeline = {
    0.0: [{ signal: setRotation, value: 0, interpolate: 'linear' }],
    1.0: [{ signal: setRotation, value: 360 }],
  };

  let containerEl: HTMLDivElement | undefined;
  const visible = createVisible(() => containerEl);

  // Spin only while near the viewport.
  createEffect(() => {
    if (!visible()) return;
    const dispose = animate({ timeline, duration: 16, loop: true });
    onCleanup(dispose);
  });

  return (
    <div ref={containerEl}>
      <SvgScene
        style={{
          'stroke-linejoin': 'round',
          'box-sizing': 'border-box',
          'stroke-dasharray': '6 2',
          'stroke-linecap': 'round',
          'stroke-width': '0.15',
          overflow: 'visible',
          stroke: 'var(--a0)',
          display: 'block',
          width: '100%',
          'max-width': '350px',
          fill: 'none',
        }}
        orbitAxes={['x', 'z']}
        viewBox="0 0 24 24"
        rotation={{ x: 80 }}
        orbitControls
      >
        <SvgGroup rotation={{ z: rotation() }}>
          <Index each={Array(LON)}>
            {(_, i) => {
              const rZ = (360 / LON) * i;
              return (
                <SvgGroup rotation={{ z: rZ }}>
                  <SvgPath
                    pivot={{ x: 12, y: 12 }}
                    rotation={{ x: 90 }}
                    paths={pathCircle}
                  />
                </SvgGroup>
              );
            }}
          </Index>

          <Index each={Array(LAT)}>
            {(_, i) => {
              const theta = (Math.PI / (LAT + 1)) * (i + 1) - Math.PI / 2;
              const sU = Math.cos(theta);
              const tZ = 12 * Math.sin(theta);
              return (
                <SvgPath
                  pivot={{ x: 12, y: 12 }}
                  scale={{ x: sU, y: sU }}
                  translation={{ z: tZ }}
                  paths={pathCircle}
                />
              );
            }}
          </Index>
        </SvgGroup>
      </SvgScene>
    </div>
  );
}
