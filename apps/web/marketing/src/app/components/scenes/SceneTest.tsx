import svgTest from '../../../assets/scenes/scene-test.svg?raw';
import { SvgPath } from '../../../lib/svggg/components/SvgPath';
import { SvgScene } from '../../../lib/svggg/components/SvgScene';
import { parseSvg } from '../../../lib/svggg/utils/svgParse';

const pathPath = parseSvg(svgTest, 'path');
const pathLine = parseSvg(svgTest, 'Line');
const pathPolyline = parseSvg(svgTest, 'polyline');
const pathPolygone = parseSvg(svgTest, 'polygon');
const pathCircle = parseSvg(svgTest, 'circle');
const pathEllipse = parseSvg(svgTest, 'ellipse');
const pathRect = parseSvg(svgTest, 'rect');

export function SceneTest() {
  return (
    <SvgScene
      style={{
        'stroke-linejoin': 'round',
        'box-sizing': 'border-box',
        'stroke-dasharray': '6 2',
        'stroke-linecap': 'round',
        'stroke-width': '0.15',
        overflow: 'visible',
        stroke: 'var(--c0)',
        display: 'block',
        width: '400px',
        fill: 'none',
      }}
      orbitAxes={['x', 'z']}
      viewBox="0 0 24 24"
      orbitControls
    >
      <SvgPath paths={pathPath} />
      <SvgPath paths={pathLine} />
      <SvgPath paths={pathPolyline} />
      <SvgPath paths={pathPolygone} />
      <SvgPath paths={pathCircle} />
      <SvgPath paths={pathEllipse} />
      <SvgPath paths={pathRect} />
    </SvgScene>
  );
}
