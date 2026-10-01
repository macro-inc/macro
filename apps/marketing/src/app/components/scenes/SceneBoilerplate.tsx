import type { JSX, ParentProps } from 'solid-js';
import svgBoiler from '../../../assets/scenes/scene-boilerplate.svg?raw';
import { SvgGroup } from '../../../lib/svggg/components/SvgGroup';
import { SvgPath } from '../../../lib/svggg/components/SvgPath';
import { SvgScene } from '../../../lib/svggg/components/SvgScene';
import { parseSvg } from '../../../lib/svggg/utils/svgParse';

interface SceneBoilerplateProps extends ParentProps {
  icon?: JSX.Element;
}

const pathHeader = parseSvg(svgBoiler, 'header');
const pathPanel = parseSvg(svgBoiler, 'panel');
const _pathEdge = parseSvg(svgBoiler, 'edge');
const pathGrid = parseSvg(svgBoiler, 'grid');
const pathX = parseSvg(svgBoiler, 'x');

export function SceneBoilerplate(props: SceneBoilerplateProps) {
  return (
    <SvgScene
      scale={{ x: 0.5, y: 0.5, z: 0.5 }}
      style={{
        'stroke-linejoin': 'round',
        'box-sizing': 'border-box',
        'stroke-linecap': 'round',
        'aspect-ratio': '1 / 1',
        'stroke-width': '0.15',
        stroke: 'var(--a0)',
        display: 'block',
        height: '100%',
        fill: 'none',
      }}
      orbitConstraints={{
        x: { min: -60, max: 26 },
        z: { min: -60, max: 30 },
      }}
      orbitAxes={['x', 'z']}
      viewBox="0 0 58 38"
      rotation={{ x: 60 }}
      orbitControls
    >
      <SvgGroup rotation={{ z: -30 }} translation={{ z: -11 }}>
        <SvgGroup translation={{ z: 4.5 }}>
          <SvgPath
            paths={pathPanel}
            style={{ fill: 'oklch(from var(--a0) l c h / 0.5)' }}
          />
          <SvgPath paths={pathGrid} />
          <SvgGroup translation={{ z: 4.5 }}>
            <SvgPath paths={pathHeader} style={{ fill: 'var(--b0)' }} />
            {props.children}
            <SvgGroup translation={{ z: 1 }}>
              {props.icon}
              <SvgPath paths={pathX} />
            </SvgGroup>
          </SvgGroup>
        </SvgGroup>
      </SvgGroup>
    </SvgScene>
  );
}
