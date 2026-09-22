import { createSignal, onCleanup } from 'solid-js';
import svgMobileUi from '../../../assets/scenes/scene-mobile.svg?raw';
import type { Timeline } from '../../../lib/animal/types/animalTypes';
import { animate } from '../../../lib/animal/utils/animalClock';
import { SvgGroup } from '../../../lib/svggg/components/SvgGroup';
import { SvgPath } from '../../../lib/svggg/components/SvgPath';
import { SvgScene } from '../../../lib/svggg/components/SvgScene';
import { parseSvg } from '../../../lib/svggg/utils/svgParse';
import { buildAppUrl } from '../../utils/utilBaseUrl';

const pathPage = parseSvg(svgMobileUi, 'page');

const pathEmail = parseSvg(svgMobileUi, 'email');
const pathChannels = parseSvg(svgMobileUi, 'channels');
const pathM = parseSvg(svgMobileUi, 'm');
const pathFolders = parseSvg(svgMobileUi, 'folders');
const pathTasks = parseSvg(svgMobileUi, 'tasks');

const pathPanel = parseSvg(svgMobileUi, 'panel');
const pathGrid = parseSvg(svgMobileUi, 'grid');
const pathEdge = parseSvg(svgMobileUi, 'edge');
const pathHeader = parseSvg(svgMobileUi, 'header');
const pathX = parseSvg(svgMobileUi, 'x');
const pathBackward = parseSvg(svgMobileUi, 'backward');
const pathForward = parseSvg(svgMobileUi, 'forward');
const pathMaximise = parseSvg(svgMobileUi, 'maximise');

const pathLaunchBack = parseSvg(svgMobileUi, 'launchback');
const pathLaunch = parseSvg(svgMobileUi, 'launch');

export function SceneMobile() {
  const [rotationX, setRotationX] = createSignal(20);
  const [rotationZ, setRotationZ] = createSignal(0);

  const timeline: Timeline = {
    0.0: [
      { signal: setRotationX, value: 17, interpolate: 'sine-in-out' },
      { signal: setRotationZ, value: -4.5, interpolate: 'sine-in-out' },
    ],
    0.5: [
      { signal: setRotationX, value: 23, interpolate: 'sine-in-out' },
      { signal: setRotationZ, value: 4.5, interpolate: 'sine-in-out' },
    ],
    1.0: [
      { signal: setRotationX, value: 17, interpolate: 'sine-in-out' },
      { signal: setRotationZ, value: -4.5, interpolate: 'sine-in-out' },
    ],
  };

  const dispose = animate({ duration: 16, timeline, loop: true });
  onCleanup(dispose);

  return (
    <SvgScene
      style={{
        'stroke-linejoin': 'round',
        'box-sizing': 'border-box',
        'stroke-linecap': 'round',
        'stroke-width': '0.15',
        stroke: 'var(--a0)',
        display: 'block',
        overflow: 'visible',
        width: '100%',
        fill: 'none',
      }}
      orbitConstraints={{
        x: { min: -20, max: 66 },
        z: { min: -82, max: 8 },
      }}
      orbitAxes={['x', 'z']}
      viewBox="0 0 62 110"
      rotation={{ x: rotationX(), z: rotationZ() }}
      orbitControls
    >
      <SvgGroup rotation={{ z: -8 }} scale={{ x: 0.8, y: 0.8, z: 0.8 }}>
        <SvgPath paths={pathPage} />

        <SvgGroup
          translation={{ z: 1 }}
          style={{
            fill: 'var(--a0)',
            stroke: 'none',
          }}
        >
          <SvgPath paths={pathEmail} />
          <SvgPath paths={pathChannels} />
          <SvgPath paths={pathM} />
          <SvgPath paths={pathFolders} />
          <SvgPath paths={pathTasks} />
        </SvgGroup>

        <SvgGroup translation={{ z: 4.5 }}>
          <SvgPath
            paths={pathPanel}
            style={{ fill: 'oklch(from var(--a0) l c h / 0.5)' }}
          />
          <SvgPath paths={pathGrid} />
          <SvgPath paths={pathEdge} />

          <SvgGroup translation={{ z: 4.5 }}>
            <SvgPath paths={pathHeader} style={{ fill: 'var(--b0)' }} />
            <SvgGroup translation={{ z: 1 }}>
              <SvgPath paths={pathX} />
              <SvgPath paths={pathForward} />
              <SvgPath paths={pathBackward} />
              <SvgPath paths={pathMaximise} />
            </SvgGroup>
          </SvgGroup>

          <SvgGroup
            translation={{ z: 2 }}
            class="launch-wrap"
            onClick={() => window.open(buildAppUrl('/app'), '_blank')}
          >
            <SvgPath class="launch-back" paths={pathLaunchBack} />
            <SvgPath class="launch" paths={pathLaunch} />
            <SvgPath class="launch-front" paths={pathLaunchBack} />
          </SvgGroup>
        </SvgGroup>
      </SvgGroup>
    </SvgScene>
  );
}
