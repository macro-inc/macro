import { createMemo, type JSX } from 'solid-js';
import svgChat from '../../../assets/scenes/scene-chat.svg?raw';
import { SvgGroup } from '../../../lib/svggg/components/SvgGroup';
import { SvgPath } from '../../../lib/svggg/components/SvgPath';
import { SvgScene } from '../../../lib/svggg/components/SvgScene';
import type { Mat4 } from '../../../lib/svggg/types/svgTypes';
import { useParentMatrix } from '../../../lib/svggg/utils/svgContext';
import { parseSvg } from '../../../lib/svggg/utils/svgParse';

// --- helpers -----------------------------------------------------------

function pt(m: Mat4, x: number, y: number): string {
  const sx = m[0] * x + m[4] * y + m[12];
  const sy = m[1] * x + m[5] * y + m[13];
  return `${sx.toFixed(3)},${sy.toFixed(3)}`;
}

interface LinePathProps {
  x1: number;
  x2: number;
  y: number;
  style?: JSX.CSSProperties;
}
function LinePath(props: LinePathProps) {
  const getM = useParentMatrix();
  const d = createMemo(() => {
    const m = getM();
    const x1 = props.x1;
    const x2 = props.x2;
    if (x1 >= x2) return '';
    return `M ${pt(m, x1, props.y)} L ${pt(m, x2, props.y)}`;
  });
  return <path d={d()} style={props.style} />;
}

// --- static paths -------------------------------------------------------

const pathPanel = parseSvg(svgChat, 'panel');
const pathGrid = parseSvg(svgChat, 'grid');
const pathHeader = parseSvg(svgChat, 'header');
const pathX = parseSvg(svgChat, 'x');
const pathSidebar = parseSvg(svgChat, 'sidebar');

// Pill bridge rects: full-width static paths, scaled along X at runtime.
const pathMsg1Rect = parseSvg(svgChat, 'msg1-rect');
const pathMsg2Rect = parseSvg(svgChat, 'msg2-rect');
const pathMsg3Rect = parseSvg(svgChat, 'msg3-rect');

// Pill caps: linearised once at startup by parseSvg (no per-frame trig).
// Left cap = sweep 0 (counter-clockwise, goes left).
// Right cap = sweep 1 (clockwise, goes right).
// Arc variants are open paths (no Z) used for stroke only.
const pathMsg1LeftCap = parseSvg(svgChat, 'msg1-left-cap');
const pathMsg1RightCap = parseSvg(svgChat, 'msg1-right-cap');
const pathMsg1LeftArc = parseSvg(svgChat, 'msg1-left-arc');
const pathMsg1RightArc = parseSvg(svgChat, 'msg1-right-arc');

const pathMsg2RightCap = parseSvg(svgChat, 'msg2-right-cap');
const pathMsg2LeftCap = parseSvg(svgChat, 'msg2-left-cap');
// msg2 has no stroke, so no arc paths needed

const pathMsg3LeftCap = parseSvg(svgChat, 'msg3-left-cap');
const pathMsg3RightCap = parseSvg(svgChat, 'msg3-right-cap');
const pathMsg3LeftArc = parseSvg(svgChat, 'msg3-left-arc');
const pathMsg3RightArc = parseSvg(svgChat, 'msg3-right-arc');

const pathPenguin1Body = parseSvg(svgChat, 'penguin1-body');
const pathPenguin1Beak = parseSvg(svgChat, 'penguin1-beak');
const pathPenguin1EyeL = parseSvg(svgChat, 'penguin1-eye-l');
const pathPenguin1EyeR = parseSvg(svgChat, 'penguin1-eye-r');

const pathCatBody = parseSvg(svgChat, 'cat-body');
const pathCatEyeL = parseSvg(svgChat, 'cat-eye-l');
const pathCatEyeR = parseSvg(svgChat, 'cat-eye-r');

const pathPenguin2Body = parseSvg(svgChat, 'penguin2-body');
const pathPenguin2Beak = parseSvg(svgChat, 'penguin2-beak');
const pathPenguin2EyeL = parseSvg(svgChat, 'penguin2-eye-l');
const pathPenguin2EyeR = parseSvg(svgChat, 'penguin2-eye-r');

const pathDot1 = parseSvg(svgChat, 'dot1');
const pathDot2 = parseSvg(svgChat, 'dot2');
const pathDot3 = parseSvg(svgChat, 'dot3');

// --- pill geometry ------------------------------------------------------

const MSG1_LX = 8.2;
const MSG1_RX_FULL = 53.2;
const MSG2_RX = 64.2;
const MSG2_LX_FULL = 35.73;
const MSG3_LX = 8.2;
const MSG3_RX_FULL = 20.2;
const PILL_R = 4;
const MSG1_CY = 14.2;
const MSG2_CY = 26.7;
const MSG3_CY = 37.95;

// --- component ----------------------------------------------------------

export function SceneTeam() {
  return (
    <SvgScene
      style={{
        'aspect-ratio': '72.4 / 44.4',
        'stroke-linejoin': 'round',
        'box-sizing': 'border-box',
        'stroke-linecap': 'round',
        'stroke-width': '0.15',
        overflow: 'visible',
        stroke: 'var(--a0)',
        display: 'block',
        width: '100%',
        fill: 'none',
      }}
      orbitAxes={['x', 'z']}
      viewBox="0 0 72.4 44.4"
      rotation={{ x: 60 }}
      orbitControls
      scale={{ x: 0.7, y: 0.7, z: 0.7 }}
      orbitConstraints={{
        x: { min: -60, max: 26 },
        z: { min: -60, max: 30 },
      }}
    >
      <SvgGroup rotation={{ z: -30 }} translation={{ z: -3 }}>
        {/* Chrome */}
        <SvgPath
          paths={pathPanel}
          style={{ fill: 'oklch(from var(--a0) l c h / 0.5)' }}
        />
        <SvgPath paths={pathGrid} />
        <SvgPath paths={pathSidebar} />
        <SvgPath paths={pathHeader} style={{ fill: 'var(--b0)' }} />
        <SvgPath paths={pathX} />

        {/* Row 1 — penguin sends a message */}
        <SvgGroup translation={{ z: 2 }}>
          {/* Fill: left cap (static) + bridge rect + right cap (translated) */}
          <SvgPath
            paths={pathMsg1LeftCap}
            style={{
              fill: 'var(--b0)',
              stroke: 'none',
            }}
          />
          <SvgPath
            paths={pathMsg1Rect}
            style={{
              fill: 'var(--b0)',
              stroke: 'none',
            }}
          />
          <SvgGroup translation={{ x: MSG1_RX_FULL - MSG1_LX }}>
            <SvgPath
              paths={pathMsg1RightCap}
              style={{
                fill: 'var(--b0)',
                stroke: 'none',
              }}
            />
            <SvgPath
              paths={pathMsg1RightArc}
              style={{
                stroke: 'var(--a0)',
                fill: 'none',
              }}
            />
          </SvgGroup>
          {/* Stroke: left arc + top/bottom lines */}
          <SvgPath
            paths={pathMsg1LeftArc}
            style={{
              stroke: 'var(--a0)',
              fill: 'none',
            }}
          />
          <LinePath x1={MSG1_LX} x2={MSG1_RX_FULL} y={MSG1_CY - PILL_R} />
          <LinePath x1={MSG1_LX} x2={MSG1_RX_FULL} y={MSG1_CY + PILL_R} />
          {/* Text line */}
          <LinePath
            x1={MSG1_LX + PILL_R + 0.8}
            x2={MSG1_RX_FULL - PILL_R - 0.3}
            y={MSG1_CY}
            style={{ 'stroke-width': '0.3' }}
          />
          <SvgPath
            paths={pathPenguin1Body}
            style={{
              fill: 'var(--a0)',
              stroke: 'none',
            }}
          />
          <SvgPath
            paths={pathPenguin1Beak}
            style={{
              fill: 'var(--a0)',
              stroke: 'none',
            }}
          />
          <SvgPath
            paths={pathPenguin1EyeL}
            style={{
              fill: 'var(--a0)',
              stroke: 'none',
            }}
          />
          <SvgPath
            paths={pathPenguin1EyeR}
            style={{
              fill: 'var(--a0)',
              stroke: 'none',
            }}
          />
        </SvgGroup>

        {/* Row 2 — cat responds (fill only, no stroke on pill) */}
        <SvgGroup translation={{ z: 2 }}>
          {/* Fill: right cap (static) + bridge rect + left cap (translated) */}
          <SvgPath
            paths={pathMsg2RightCap}
            style={{
              fill: 'var(--a0)',
              stroke: 'none',
            }}
          />
          <SvgPath
            paths={pathMsg2Rect}
            style={{
              fill: 'var(--a0)',
              stroke: 'none',
            }}
          />
          <SvgGroup translation={{ x: MSG2_LX_FULL - MSG2_RX }}>
            <SvgPath
              paths={pathMsg2LeftCap}
              style={{
                fill: 'var(--a0)',
                stroke: 'none',
              }}
            />
          </SvgGroup>
          {/* Text line */}
          <LinePath
            x1={MSG2_LX_FULL + PILL_R + 0.3}
            x2={MSG2_RX - PILL_R - 0.3}
            y={MSG2_CY}
            style={{
              'stroke-width': '0.3',
              stroke: 'var(--b0)',
            }}
          />
          <SvgPath
            paths={pathCatBody}
            style={{
              fill: 'var(--b0)',
              stroke: 'none',
            }}
          />
          <SvgPath
            paths={pathCatEyeL}
            style={{
              fill: 'var(--b0)',
              stroke: 'none',
            }}
          />
          <SvgPath
            paths={pathCatEyeR}
            style={{
              fill: 'var(--b0)',
              stroke: 'none',
            }}
          />
        </SvgGroup>

        {/* Row 3 — penguin typing */}
        <SvgGroup translation={{ z: 2 }}>
          {/* Fill: left cap (static) + bridge rect + right cap (translated) */}
          <SvgPath
            paths={pathMsg3LeftCap}
            style={{
              fill: 'var(--b0)',
              stroke: 'none',
            }}
          />
          <SvgPath
            paths={pathMsg3Rect}
            style={{
              fill: 'var(--b0)',
              stroke: 'none',
            }}
          />
          <SvgGroup translation={{ x: MSG3_RX_FULL - MSG3_LX }}>
            <SvgPath
              paths={pathMsg3RightCap}
              style={{
                fill: 'var(--b0)',
                stroke: 'none',
              }}
            />
            <SvgPath
              paths={pathMsg3RightArc}
              style={{
                stroke: 'var(--a0)',
                fill: 'none',
              }}
            />
          </SvgGroup>
          {/* Stroke: left arc + top/bottom lines */}
          <SvgPath
            paths={pathMsg3LeftArc}
            style={{
              stroke: 'var(--a0)',
              fill: 'none',
            }}
          />
          <LinePath x1={MSG3_LX} x2={MSG3_RX_FULL} y={MSG3_CY - PILL_R} />
          <LinePath x1={MSG3_LX} x2={MSG3_RX_FULL} y={MSG3_CY + PILL_R} />
          <SvgPath
            paths={pathPenguin2Body}
            style={{
              fill: 'var(--a0)',
              stroke: 'none',
            }}
          />
          <SvgPath
            paths={pathPenguin2Beak}
            style={{
              fill: 'var(--a0)',
              stroke: 'none',
            }}
          />
          <SvgPath
            paths={pathPenguin2EyeL}
            style={{
              fill: 'var(--a0)',
              stroke: 'none',
            }}
          />
          <SvgPath
            paths={pathPenguin2EyeR}
            style={{
              fill: 'var(--a0)',
              stroke: 'none',
            }}
          />
          <SvgGroup>
            <SvgPath
              paths={pathDot1}
              style={{
                fill: 'var(--a0)',
                stroke: 'none',
              }}
            />
            <SvgPath
              paths={pathDot2}
              style={{
                fill: 'var(--a0)',
                stroke: 'none',
              }}
            />
            <SvgPath
              paths={pathDot3}
              style={{
                fill: 'var(--a0)',
                stroke: 'none',
              }}
            />
          </SvgGroup>
        </SvgGroup>
      </SvgGroup>
    </SvgScene>
  );
}
