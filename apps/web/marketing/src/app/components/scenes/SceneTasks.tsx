import { createSignal, onCleanup } from 'solid-js';
import svgTask from '../../../assets/scenes/scene-tasks.svg?raw';
import type { Timeline } from '../../../lib/animal/types/animalTypes';
import { animate } from '../../../lib/animal/utils/animalClock';
import { SvgGroup } from '../../../lib/svggg/components/SvgGroup';
import { SvgPath } from '../../../lib/svggg/components/SvgPath';
import { parseSvg } from '../../../lib/svggg/utils/svgParse';
import { SceneBoilerplate } from './SceneBoilerplate';

const pathTasks = parseSvg(svgTask, 'tasks');
const pathBoxl = parseSvg(svgTask, 'boxl');
const pathBox = parseSvg(svgTask, 'box');

export function SceneTasks() {
  const [group1x, setGroup1x] = createSignal(0);
  const [group2x, setGroup2x] = createSignal(-80);
  const [group3x, setGroup3x] = createSignal(-160);

  const [group1o, setGroup1o] = createSignal(1);
  const [group2o, setGroup2o] = createSignal(0);
  const [group3o, setGroup3o] = createSignal(0);

  const timeline: Timeline = {
    0.0: [
      { signal: setGroup1x, value: 0 },
      { signal: setGroup2x, value: -80 },
      { signal: setGroup3x, value: 80 },
      { signal: setGroup1o, value: 1 },
      { signal: setGroup2o, value: 0 },
      { signal: setGroup3o, value: 0 },
    ],
    0.23: [
      { signal: setGroup1x, value: 0, interpolate: 'quad-in-out' },
      { signal: setGroup2x, value: -80, interpolate: 'quad-in-out' },
      { signal: setGroup3x, value: 80, interpolate: 'quad-in-out' },
      { signal: setGroup1o, value: 1, interpolate: 'quad-in-out' },
      { signal: setGroup2o, value: 0, interpolate: 'quad-in-out' },
      { signal: setGroup3o, value: 0, interpolate: 'quad-in-out' },
    ],
    0.33: [
      { signal: setGroup1x, value: 80 },
      { signal: setGroup2x, value: 0 },
      { signal: setGroup3x, value: -80 },
      { signal: setGroup1o, value: 0 },
      { signal: setGroup2o, value: 1 },
      { signal: setGroup3o, value: 0 },
    ],
    0.56: [
      { signal: setGroup1x, value: 80, interpolate: 'quad-in-out' },
      { signal: setGroup2x, value: 0, interpolate: 'quad-in-out' },
      { signal: setGroup3x, value: -80, interpolate: 'quad-in-out' },
      { signal: setGroup1o, value: 0, interpolate: 'quad-in-out' },
      { signal: setGroup2o, value: 1, interpolate: 'quad-in-out' },
      { signal: setGroup3o, value: 0, interpolate: 'quad-in-out' },
    ],
    0.66: [
      { signal: setGroup1x, value: -80 },
      { signal: setGroup2x, value: 80 },
      { signal: setGroup3x, value: 0 },
      { signal: setGroup1o, value: 0 },
      { signal: setGroup2o, value: 0 },
      { signal: setGroup3o, value: 1 },
    ],
    0.9: [
      { signal: setGroup1x, value: -80, interpolate: 'quad-in-out' },
      { signal: setGroup2x, value: 80, interpolate: 'quad-in-out' },
      { signal: setGroup3x, value: 0, interpolate: 'quad-in-out' },
      { signal: setGroup1o, value: 0, interpolate: 'quad-in-out' },
      { signal: setGroup2o, value: 0, interpolate: 'quad-in-out' },
      { signal: setGroup3o, value: 1, interpolate: 'quad-in-out' },
    ],
    1.0: [
      { signal: setGroup1x, value: 0 },
      { signal: setGroup2x, value: -80 },
      { signal: setGroup3x, value: 80 },
      { signal: setGroup1o, value: 1 },
      { signal: setGroup2o, value: 0 },
      { signal: setGroup3o, value: 0 },
    ],
  };

  const dispose = animate({ duration: 10, timeline, loop: true });
  onCleanup(dispose);

  return (
    <SceneBoilerplate
      icon={
        <SvgPath
          paths={pathTasks}
          style={{
            fill: 'var(--a0)',
            stroke: 'none',
          }}
        />
      }
    >
      <SvgGroup translation={{ x: group1x() }} style={{ opacity: group1o() }}>
        <SvgPath paths={pathBox} style={{ fill: 'var(--b0)' }} />
        <SvgPath paths={pathBoxl} />
      </SvgGroup>

      <SvgGroup translation={{ x: group2x() }} style={{ opacity: group2o() }}>
        <SvgPath paths={pathBox} style={{ fill: 'var(--b0)' }} />
        <SvgPath paths={pathBoxl} />
      </SvgGroup>

      <SvgGroup translation={{ x: group3x() }} style={{ opacity: group3o() }}>
        <SvgPath paths={pathBox} style={{ fill: 'var(--b0)' }} />
        <SvgPath paths={pathBoxl} />
      </SvgGroup>
    </SceneBoilerplate>
  );
}
