import svgRect from '../../../assets/scenes/scene-rect.svg?raw';
import { SvgGroup } from '../../../lib/svggg/components/SvgGroup';
import { SvgPath } from '../../../lib/svggg/components/SvgPath';
import { SvgScene } from '../../../lib/svggg/components/SvgScene';
import { parseSvg } from '../../../lib/svggg/utils/svgParse';

const pathRect = parseSvg(svgRect);

export function SceneModule() {
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
      orbitAxes={['x', 'z']}
      viewBox="0 0 24 24"
      rotation={{ x: 60 }}
      orbitControls
    >
      <SvgGroup rotation={{ z: -30 }} translation={{ z: -11 }}>
        <SvgPath
          translation={{ x: 24 }}
          rotation={{ x: 90, z: 90 }}
          paths={pathRect}
        />
        <SvgPath
          translation={{ y: 24 }}
          rotation={{ x: 90 }}
          paths={pathRect}
        />
        <SvgPath rotation={{ x: 90, z: 90 }} paths={pathRect} />
        <SvgPath translation={{ z: 24 }} paths={pathRect} />
        <SvgPath rotation={{ x: 90 }} paths={pathRect} />
        <SvgPath paths={pathRect} />
      </SvgGroup>
    </SvgScene>
  );
}
