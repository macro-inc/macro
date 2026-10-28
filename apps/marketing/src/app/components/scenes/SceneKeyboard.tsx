import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import svgDesignWordmark from '../../../assets/designs/design-wordmark.svg?raw';
import svgKeyboard from '../../../assets/scenes/scene-keyboard.svg?raw';
import type { Timeline } from '../../../lib/animal/types/animalTypes';
import { animate } from '../../../lib/animal/utils/animalClock';
import { SvgAnchor } from '../../../lib/svggg/components/SvgAnchor';
import { SvgGroup } from '../../../lib/svggg/components/SvgGroup';
import { SvgPath } from '../../../lib/svggg/components/SvgPath';
import { SvgScene } from '../../../lib/svggg/components/SvgScene';
import { parseSvg } from '../../../lib/svggg/utils/svgParse';
import { breakpoint } from '../../utils/utilBreakpoint';
import { createVisible } from '../../utils/utilVisible';
import { DiagramWire } from '../diagrams/DiagramWire';
import { DiagramWrapper } from '../diagrams/DiagramWrapper';

const wordmarkPaths = parseSvg(svgDesignWordmark);
const keyboardPaths = parseSvg(svgKeyboard);
const shortcutKeyPaths = parseSvg(`
  <svg viewBox="0 0 29 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M 17.7763  6.0763 H 19.2236 A 0.2 0.2 0 0 1 19.4236  6.2763 V  7.7236 A 0.2 0.2 0 0 1 19.2236  7.9236 H 17.7763 A 0.2 0.2 0 0 1 17.5763  7.7236 V  6.2763 A 0.2 0.2 0 0 1 17.7763  6.0763 Z" />
    <path d="M 22.7763  8.0763 H 24.2236 A 0.2 0.2 0 0 1 24.4236  8.2763 V  9.7236 A 0.2 0.2 0 0 1 24.2236  9.9236 H 22.7763 A 0.2 0.2 0 0 1 22.5763  9.7236 V  8.2763 A 0.2 0.2 0 0 1 22.7763  8.0763 Z" />
    <path d="M  8.7763  8.0763 H 10.2236 A 0.2 0.2 0 0 1 10.4236  8.2763 V  9.7236 A 0.2 0.2 0 0 1 10.2236  9.9236 H  8.7763 A 0.2 0.2 0 0 1  8.5763  9.7236 V  8.2763 A 0.2 0.2 0 0 1  8.7763  8.0763 Z" />
  </svg>
`);

const calloutBodyStyle = {
  color: 'var(--c4)',
  'font-size': '16px',
  'font-weight': '300',
  'margin-top': '4px',
  'max-width': '200px',
} as const;

export function SceneKeyboard() {
  const [rotationZ, setRotationZ] = createSignal(0);

  const timeline: Timeline = {
    0.0: [{ signal: setRotationZ, value: -4.5, interpolate: 'sine-in-out' }],
    0.5: [{ signal: setRotationZ, value: 4.5, interpolate: 'sine-in-out' }],
    1.0: [{ signal: setRotationZ, value: -4.5, interpolate: 'sine-in-out' }],
  };

  let containerEl: HTMLDivElement | undefined;
  const visible = createVisible(() => containerEl);

  // Subscribe to the shared clock only while near the viewport: each frame
  // rewrites ~164 path d attributes through the wobble timeline.
  createEffect(() => {
    if (!visible()) return;
    const dispose = animate({ duration: 16, timeline, loop: true });
    onCleanup(dispose);
  });

  return (
    <div ref={containerEl}>
      <DiagramWrapper>
        <SvgScene
          style={{
            'stroke-linejoin': 'round',
            'box-sizing': 'border-box',
            'stroke-linecap': 'round',
            overflow: 'visible',
            stroke: 'var(--a0)',
            display: 'block',
            width: '100%',
          }}
          orbitAxes={['x', 'z']}
          rotation={{ x: 60, z: rotationZ() }}
          viewBox="0 0 29 12"
          orbitControls
        >
          <SvgGroup rotation={{ z: -20 }} scale={{ x: 0.75, y: 0.75, z: 0.75 }}>
            <SvgPath
              translation={{ x: 0, y: 0, z: -0.3 }}
              style={{
                'stroke-width': '0.035px',
                stroke: 'oklch(from var(--b4) l c h / 0.6)',
                fill: 'none',
                opacity: 0.52,
              }}
              paths={keyboardPaths}
            />
            <SvgPath
              translation={{ x: 0, y: 0, z: 0.3 }}
              style={{
                fill: 'oklch(from var(--b1) l c h / 0.78)',
                'stroke-width': '0.04px',
                stroke: 'oklch(from var(--b4) l c h / 0.6)',
              }}
              paths={keyboardPaths}
            />
            <SvgPath
              translation={{ x: 0, y: 0, z: 0.34 }}
              style={{
                fill: 'oklch(from var(--a0) l c h / 0.32)',
                'stroke-width': '0.06px',
                stroke: 'var(--a0)',
              }}
              paths={shortcutKeyPaths}
            />
            <SvgPath
              translation={{ x: 10.2, y: 10.5, z: 0.3 }}
              scale={{ x: 0.3, y: 0.3, z: 0.3 }}
              style={{
                fill: 'var(--a0)',
                stroke: 'none',
              }}
              paths={wordmarkPaths}
            />
            <SvgGroup translation={{ x: 0, y: 0, z: 0.3 }}>
              <SvgAnchor x={18.55} y={7} id={'keyboard-search-end'} />
              <SvgAnchor x={23.55} y={9} id={'keyboard-command-end'} />
              <SvgAnchor x={9.52} y={9} id={'keyboard-create-end'} />
            </SvgGroup>
          </SvgGroup>
        </SvgScene>

        <Show when={!breakpoint()}>
          <div
            style={{
              'user-select': 'none',
              'line-height': '20px',
              'font-size': '20px',
            }}
          >
            <div
              id="keyboard-search-start"
              style={{
                position: 'absolute',
                left: '50%',
                bottom: '6%',
                transform: 'translateX(calc(-50% - 10px))',
                'max-width': '220px',
                'text-align': 'left',
              }}
            >
              <p style={{ margin: '0', color: 'var(--c1)' }}>COMMAND</p>
              <p style={calloutBodyStyle}>Command + K.</p>
            </div>

            <div
              id="keyboard-command-start"
              style={{
                position: 'absolute',
                right: '7%',
                bottom: '22%',
                'max-width': '180px',
                transform: 'translate(20px, 20px)',
              }}
            >
              <p style={{ margin: '0', color: 'var(--c1)' }}>SEARCH</p>
              <p style={calloutBodyStyle}>Find anything instantly.</p>
            </div>

            <div
              id="keyboard-create-start"
              style={{
                position: 'absolute',
                left: '2px',
                bottom: '22%',
                'max-width': '150px',
                transform: 'translateY(10px)',
              }}
            >
              <p style={{ margin: '0', color: 'var(--c1)' }}>CREATE</p>
              <p style={calloutBodyStyle}>Start from one menu.</p>
            </div>
          </div>

          <DiagramWire
            from="keyboard-create-start"
            start="right"
            to="keyboard-create-end"
            color="var(--c4)"
            opacity={0.7}
            strokeWidth={1}
          />
          <DiagramWire
            from="keyboard-search-start"
            start="right"
            to="keyboard-search-end"
            color="var(--c4)"
            opacity={0.7}
            strokeWidth={1}
          />
          <DiagramWire
            from="keyboard-command-start"
            start="left"
            to="keyboard-command-end"
            color="var(--c4)"
            opacity={0.7}
            strokeWidth={1}
          />
        </Show>
      </DiagramWrapper>
    </div>
  );
}
