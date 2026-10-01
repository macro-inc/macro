import svgAllInOne from '../../../assets/scenes/scene-all-in-one.svg?raw';
import { SvgAnchor } from '../../../lib/svggg/components/SvgAnchor';
import { SvgGroup } from '../../../lib/svggg/components/SvgGroup';
import { SvgPath } from '../../../lib/svggg/components/SvgPath';
import { SvgScene } from '../../../lib/svggg/components/SvgScene';
import { parseSvg } from '../../../lib/svggg/utils/svgParse';

const pathPanel = parseSvg(svgAllInOne, 'panel');
const pathGrid = parseSvg(svgAllInOne, 'grid');
const pathHeader = parseSvg(svgAllInOne, 'header');
const pathX = parseSvg(svgAllInOne, 'x');

const pathRow1 = parseSvg(svgAllInOne, 'row1');
const pathBoldA = parseSvg(svgAllInOne, 'bold-a');
const pathBoldB = parseSvg(svgAllInOne, 'bold-b');
const pathBoldLine1 = parseSvg(svgAllInOne, 'bold-line1');
const pathBoldLine2 = parseSvg(svgAllInOne, 'bold-line2');
const pathDocIcon = parseSvg(svgAllInOne, 'doc-icon');
const pathPrioR1A = parseSvg(svgAllInOne, 'prio-r1-a');
const pathPrioR1B = parseSvg(svgAllInOne, 'prio-r1-b');
const pathPrioR1C = parseSvg(svgAllInOne, 'prio-r1-c');

const pathRow2 = parseSvg(svgAllInOne, 'row2');
const pathEmailIcon = parseSvg(svgAllInOne, 'email-icon');
const pathArrowShare = parseSvg(svgAllInOne, 'arrow-share');
const pathStatusA = parseSvg(svgAllInOne, 'status-a');
const pathStatusB = parseSvg(svgAllInOne, 'status-b');
const pathPrioR2A = parseSvg(svgAllInOne, 'prio-r2-a');
const pathPrioR2B = parseSvg(svgAllInOne, 'prio-r2-b');
const pathPrioR2C = parseSvg(svgAllInOne, 'prio-r2-c');

const pathFooterBg = parseSvg(svgAllInOne, 'footer-bg');
const pathFooterIconA = parseSvg(svgAllInOne, 'footer-icon-a');
const pathFooterIconB = parseSvg(svgAllInOne, 'footer-icon-b');
const pathFooterLine1 = parseSvg(svgAllInOne, 'footer-line1');
const pathFooterLine2 = parseSvg(svgAllInOne, 'footer-line2');
const pathPrioFtA = parseSvg(svgAllInOne, 'prio-ft-a');
const pathPrioFtB = parseSvg(svgAllInOne, 'prio-ft-b');
const pathPrioFtC = parseSvg(svgAllInOne, 'prio-ft-c');

export function SceneAllInOne() {
  return (
    <SvgScene
      scale={{ x: 1.05, y: 1.05, z: 1.05 }}
      style={{
        'stroke-linejoin': 'round',
        'box-sizing': 'border-box',
        'stroke-linecap': 'round',
        'stroke-width': '0.3',
        overflow: 'visible',
        stroke: 'var(--a0)',
        display: 'block',
        height: '180px',
        width: '100%',
        fill: 'none',
      }}
      orbitConstraints={{
        x: { min: -60, max: 26 },
        z: { min: -60, max: 30 },
      }}
      viewBox="0 0 72.4 44.4"
      orbitAxes={['x', 'z']}
      rotation={{ x: 60 }}
      orbitControls
    >
      <SvgGroup rotation={{ z: -30 }} translation={{ z: -3 }}>
        {/* Base layer: panel + grid (static) */}
        <SvgPath
          paths={pathPanel}
          style={{ fill: 'oklch(from var(--a0) l c h / 0.5)' }}
        />
        <SvgPath paths={pathGrid} />

        {/* Header (static) */}
        <SvgGroup translation={{ z: 2 }}>
          <SvgPath paths={pathHeader} style={{ fill: 'var(--b0)' }} />
          <SvgPath paths={pathX} />
        </SvgGroup>

        {/* Row 1 */}
        <SvgGroup>
          <SvgAnchor x={20} y={4} z={2} id="soup-1-end" />
          <SvgGroup translation={{ z: 2 }}>
            <SvgPath paths={pathRow1} style={{ fill: 'var(--b0)' }} />
          </SvgGroup>
          <SvgGroup
            translation={{ z: 2 }}
            style={{
              fill: 'var(--a0)',
              stroke: 'none',
            }}
          >
            <SvgPath paths={pathDocIcon} />
            <SvgPath paths={pathPrioR1A} />
            <SvgPath
              paths={pathPrioR1B}
              style={{ fill: 'oklch(from var(--a0) l c h / 0.4)' }}
            />
            <SvgPath
              paths={pathPrioR1C}
              style={{ fill: 'oklch(from var(--a0) l c h / 0.4)' }}
            />
          </SvgGroup>
          <SvgGroup
            translation={{ z: 2 }}
            style={{
              fill: 'var(--a0)',
              stroke: 'none',
            }}
          >
            <SvgPath paths={pathBoldA} />
            <SvgPath paths={pathBoldB} />
            <SvgPath paths={pathBoldLine1} />
            <SvgPath paths={pathBoldLine2} />
          </SvgGroup>
        </SvgGroup>

        {/* Row 2 */}
        <SvgGroup>
          <SvgAnchor x={74} y={36} z={2} id="soup-2-end" />
          <SvgGroup translation={{ z: 2 }}>
            <SvgPath paths={pathRow2} style={{ fill: 'var(--b0)' }} />
          </SvgGroup>
          <SvgGroup
            translation={{ z: 2 }}
            style={{
              fill: 'var(--a0)',
              stroke: 'none',
            }}
          >
            <SvgPath paths={pathArrowShare} />
            <SvgPath paths={pathPrioR2A} />
            <SvgPath paths={pathPrioR2B} />
            <SvgPath
              paths={pathPrioR2C}
              style={{ fill: 'oklch(from var(--a0) l c h / 0.4)' }}
            />
          </SvgGroup>
          <SvgGroup
            translation={{ z: 2 }}
            style={{
              fill: 'var(--a0)',
              stroke: 'none',
            }}
          >
            <SvgPath paths={pathEmailIcon} />
          </SvgGroup>
        </SvgGroup>

        {/* Footer row */}
        <SvgGroup>
          <SvgGroup translation={{ z: 2 }}>
            <SvgPath paths={pathFooterBg} style={{ fill: 'var(--b0)' }} />
          </SvgGroup>
          <SvgGroup
            translation={{ z: 2 }}
            style={{
              fill: 'var(--a0)',
              stroke: 'none',
            }}
          >
            <SvgPath paths={pathStatusA} />
            <SvgPath paths={pathStatusB} />
            <SvgPath paths={pathPrioFtA} />
            <SvgPath paths={pathPrioFtB} />
            <SvgPath paths={pathPrioFtC} />
          </SvgGroup>
          <SvgGroup
            translation={{ z: 2 }}
            style={{
              fill: 'var(--a0)',
              stroke: 'none',
            }}
          >
            <SvgPath paths={pathFooterIconA} />
            <SvgPath paths={pathFooterIconB} />
            <SvgPath paths={pathFooterLine1} />
            <SvgPath paths={pathFooterLine2} />
          </SvgGroup>
        </SvgGroup>
      </SvgGroup>
    </SvgScene>
  );
}
