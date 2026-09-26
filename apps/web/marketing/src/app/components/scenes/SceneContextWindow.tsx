import { createNoise3D } from 'simplex-noise';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import svgWordmark from '../../../assets/designs/design-wordmark.svg?raw';
import svgContextWindow from '../../../assets/scenes/scene-context-window.svg?raw';
import { SvgGroup } from '../../../lib/svggg/components/SvgGroup';
import { SvgPath } from '../../../lib/svggg/components/SvgPath';
import { SvgScene } from '../../../lib/svggg/components/SvgScene';
import { parseSvg } from '../../../lib/svggg/utils/svgParse';
import { createVisible } from '../../utils/utilVisible';

const pathChat = parseSvg(svgContextWindow, 'chat');
const pathEmail = parseSvg(svgContextWindow, 'email');
const pathSearch = parseSvg(svgContextWindow, 'search');
const pathChannels = parseSvg(svgContextWindow, 'channels');
const pathM = parseSvg(svgContextWindow, 'm');
const pathDocuments = parseSvg(svgContextWindow, 'documents');
const pathFiles = parseSvg(svgContextWindow, 'files');
const pathAgents = parseSvg(svgContextWindow, 'agents');
const pathTasks = parseSvg(svgContextWindow, 'tasks');

const path0 = parseSvg(svgContextWindow, '0');
const path1 = parseSvg(svgContextWindow, '1');
const path2 = parseSvg(svgContextWindow, '2');
const path3 = parseSvg(svgContextWindow, '3');
const path4 = parseSvg(svgContextWindow, '4');
const path5 = parseSvg(svgContextWindow, '5');
const path6 = parseSvg(svgContextWindow, '6');
const path7 = parseSvg(svgContextWindow, '7');
const path8 = parseSvg(svgContextWindow, '8');
const path9 = parseSvg(svgContextWindow, '9');

const pathWordmark = parseSvg(svgWordmark);

const noise3D = createNoise3D();

export function SceneContextWindow() {
  const [time, setTime] = createSignal(0);

  let containerEl: HTMLDivElement | undefined;
  const visible = createVisible(() => containerEl);

  // Pauses while offscreen: each frame rewrites 27 panel/icon path d attrs.
  createEffect(() => {
    if (!visible()) return;
    let animationId = requestAnimationFrame(function animate() {
      setTime((t) => t + 0.003);
      animationId = requestAnimationFrame(animate);
    });
    onCleanup(() => cancelAnimationFrame(animationId));
  });

  const noiseScale = 0.05;
  const amplitude = 2;

  function getZOffset(index: number): number {
    const x = (index % 3) * noiseScale;
    const y = Math.floor(index / 3) * noiseScale;
    const noiseValue = noise3D(x + time(), y, 0);
    return noiseValue * amplitude - 8;
  }

  return (
    <div ref={containerEl}>
      <SvgScene
        orbitConstraints={{ zoom: { min: 1, max: 1 } }}
        scale={{ x: 0.6, y: 0.6, z: 0.6 }}
        style={{
          'stroke-linejoin': 'round',
          'box-sizing': 'border-box',
          'stroke-linecap': 'round',
          'stroke-width': '0.05',
          overflow: 'visible',
          stroke: 'var(--c4)',
          'stroke-opacity': '0.43',
          display: 'block',
          width: '100%',
          fill: 'none',
        }}
        orbitAxes={['x', 'z']}
        rotation={{ x: 60 }}
        viewBox="0 0 24 15"
        orbitControls
      >
        <SvgGroup translation={{ z: 14 }} rotation={{ z: -30 }}>
          <SvgPath translation={{ z: -15 }} paths={path0} />
          <SvgPath translation={{ z: -14 }} paths={path0} />
          <SvgPath translation={{ z: -13 }} paths={path0} />
          <SvgPath translation={{ z: -12 }} paths={path0} />
          <SvgPath translation={{ z: -11 }} paths={path0} />
          <SvgPath translation={{ z: -10 }} paths={path0} />

          <SvgPath translation={{ z: -10 }} paths={path1} />
          <SvgPath translation={{ z: -10 }} paths={path2} />
          <SvgPath translation={{ z: -10 }} paths={path3} />
          <SvgPath translation={{ z: -10 }} paths={path4} />
          <SvgPath translation={{ z: -10 }} paths={path5} />
          <SvgPath translation={{ z: -10 }} paths={path6} />
          <SvgPath translation={{ z: -10 }} paths={path7} />
          <SvgPath translation={{ z: -10 }} paths={path8} />
          <SvgPath translation={{ z: -10 }} paths={path9} />
          <SvgPath
            translation={{ x: 2.6, y: 23, z: -11 }}
            scale={{ x: 0.85, y: 0.85, z: 0.85 }}
            style={{ fill: 'var(--a0)', stroke: 'none' }}
            paths={pathWordmark}
            rotation={{ x: -90 }}
          />

          <SvgGroup translation={{ z: getZOffset(0) }}>
            <SvgPath paths={path1} translation={{ z: -1.5 }} />
            <SvgPath paths={path1} style={{ fill: 'var(--b0)' }} />
            <SvgPath
              paths={pathChat}
              style={{
                fill: 'var(--a0)',
                stroke: 'none',
              }}
            />
          </SvgGroup>

          <SvgGroup translation={{ z: getZOffset(1) }}>
            <SvgPath paths={path2} translation={{ z: -1.5 }} />
            <SvgPath paths={path2} style={{ fill: 'var(--b0)' }} />
            <SvgPath
              paths={pathEmail}
              style={{
                fill: 'var(--a0)',
                stroke: 'none',
              }}
            />
          </SvgGroup>

          <SvgGroup translation={{ z: getZOffset(2) }}>
            <SvgPath paths={path3} translation={{ z: -1.5 }} />
            <SvgPath paths={path3} style={{ fill: 'var(--b0)' }} />
            <SvgPath
              paths={pathSearch}
              style={{
                fill: 'var(--a0)',
                stroke: 'none',
              }}
            />
          </SvgGroup>

          <SvgGroup translation={{ z: getZOffset(3) }}>
            <SvgPath paths={path4} translation={{ z: -1.5 }} />
            <SvgPath paths={path4} style={{ fill: 'var(--b0)' }} />
            <SvgPath
              paths={pathChannels}
              style={{
                fill: 'var(--a0)',
                stroke: 'none',
              }}
            />
          </SvgGroup>

          <SvgGroup translation={{ z: getZOffset(4) }}>
            <SvgPath paths={path5} translation={{ z: -1.5 }} />
            <SvgPath paths={path5} style={{ fill: 'var(--b0)' }} />
            <SvgPath
              paths={pathM}
              style={{
                fill: 'var(--a0)',
                stroke: 'none',
              }}
            />
          </SvgGroup>

          <SvgGroup translation={{ z: getZOffset(5) }}>
            <SvgPath paths={path6} translation={{ z: -1.5 }} />
            <SvgPath paths={path6} style={{ fill: 'var(--b0)' }} />
            <SvgPath
              paths={pathDocuments}
              style={{
                fill: 'var(--a0)',
                stroke: 'none',
              }}
            />
          </SvgGroup>

          <SvgGroup translation={{ z: getZOffset(6) }}>
            <SvgPath paths={path7} translation={{ z: -1.5 }} />
            <SvgPath paths={path7} style={{ fill: 'var(--b0)' }} />
            <SvgPath
              paths={pathFiles}
              style={{
                fill: 'var(--a0)',
                stroke: 'none',
              }}
            />
          </SvgGroup>

          <SvgGroup translation={{ z: getZOffset(7) }}>
            <SvgPath paths={path8} translation={{ z: -1.5 }} />
            <SvgPath paths={path8} style={{ fill: 'var(--b0)' }} />
            <SvgPath
              paths={pathAgents}
              style={{
                fill: 'var(--a0)',
                stroke: 'none',
              }}
            />
          </SvgGroup>

          <SvgGroup translation={{ z: getZOffset(8) }}>
            <SvgPath paths={path9} translation={{ z: -1.5 }} />
            <SvgPath paths={path9} style={{ fill: 'var(--b0)' }} />
            <SvgPath
              paths={pathTasks}
              style={{
                fill: 'var(--a0)',
                stroke: 'none',
              }}
            />
          </SvgGroup>
        </SvgGroup>
      </SvgScene>
    </div>
  );
}
