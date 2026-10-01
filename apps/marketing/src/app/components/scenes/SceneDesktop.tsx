import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import svgDesktopUi from '../../../assets/scenes/scene-desktop.svg?raw';
import type { Timeline } from '../../../lib/animal/types/animalTypes';
import { animate } from '../../../lib/animal/utils/animalClock';
import { SvgAnchor } from '../../../lib/svggg/components/SvgAnchor';
import { SvgGroup } from '../../../lib/svggg/components/SvgGroup';
import { SvgPath } from '../../../lib/svggg/components/SvgPath';
import { SvgScene } from '../../../lib/svggg/components/SvgScene';
import { parseSvg } from '../../../lib/svggg/utils/svgParse';
import { analytics } from '../../utils/utilAnalytic';
import { buildAppUrl } from '../../utils/utilBaseUrl';
import { breakpoint } from '../../utils/utilBreakpoint';
import { createVisible } from '../../utils/utilVisible';
import { DiagramWire } from '../diagrams/DiagramWire';
import { DiagramWrapper } from '../diagrams/DiagramWrapper';

const pathPage = parseSvg(svgDesktopUi, 'page');

const pathM = parseSvg(svgDesktopUi, 'm');
const pathEmail = parseSvg(svgDesktopUi, 'email');
const pathSearch = parseSvg(svgDesktopUi, 'search');
const pathAgents = parseSvg(svgDesktopUi, 'agents');
const pathDocuments = parseSvg(svgDesktopUi, 'documents');
const pathChat = parseSvg(svgDesktopUi, 'chat');
const pathTasks = parseSvg(svgDesktopUi, 'tasks');
const pathChannels = parseSvg(svgDesktopUi, 'channels');
const pathFolders = parseSvg(svgDesktopUi, 'folders');

const path1Panel = parseSvg(svgDesktopUi, '1-panel');
const path1Grid = parseSvg(svgDesktopUi, '1-grid');
const path1Edge = parseSvg(svgDesktopUi, '1-edge');
const path1Header = parseSvg(svgDesktopUi, '1-header');
const path1X = parseSvg(svgDesktopUi, '1-x');
const path1Backward = parseSvg(svgDesktopUi, '1-backward');
const path1Forward = parseSvg(svgDesktopUi, '1-forward');
const path1Maximise = parseSvg(svgDesktopUi, '1-maximise');

const path2Panel = parseSvg(svgDesktopUi, '2-panel');
const path2Grid = parseSvg(svgDesktopUi, '2-grid');
const path2Edge = parseSvg(svgDesktopUi, '2-edge');
const path2Header = parseSvg(svgDesktopUi, '2-header');
const path2X = parseSvg(svgDesktopUi, '2-x');
const path2Backward = parseSvg(svgDesktopUi, '2-backward');
const path2Forward = parseSvg(svgDesktopUi, '2-forward');
const path2Maximise = parseSvg(svgDesktopUi, '2-maximise');

const pathLaunchBack = parseSvg(svgDesktopUi, 'launchback');
const pathLaunch = parseSvg(svgDesktopUi, 'launch');

const labelHeadingStyle = {
  color: 'color-mix(in srgb, var(--c4) 48%, var(--c2))',
  margin: '0',
} as const;

const labelBodyStyle = {
  color: 'color-mix(in srgb, var(--c4) 88%, transparent)',
  'font-size': '16px',
  'font-weight': '300',
  'margin-top': '4px',
} as const;

const wireOpacity = 0.45;

export function SceneDesktop(props: { mobileHero?: boolean } = {}) {
  const initialRotationX = props.mobileHero ? 46 : 60;
  const rotationXMin = props.mobileHero ? 44 : 57.5;
  const rotationXMax = props.mobileHero ? 48 : 62.5;
  const rotationZRange = props.mobileHero ? 3 : 4.5;
  const sceneRotationZ = props.mobileHero ? -16 : -30;
  const [rotationX, setRotationX] = createSignal(initialRotationX);
  const [rotationZ, setRotationZ] = createSignal(0);

  const timeline: Timeline = {
    0.0: [
      { signal: setRotationX, value: rotationXMin, interpolate: 'sine-in-out' },
      {
        signal: setRotationZ,
        value: -rotationZRange,
        interpolate: 'sine-in-out',
      },
    ],
    0.5: [
      { signal: setRotationX, value: rotationXMax, interpolate: 'sine-in-out' },
      {
        signal: setRotationZ,
        value: rotationZRange,
        interpolate: 'sine-in-out',
      },
    ],
    1.0: [
      { signal: setRotationX, value: rotationXMin, interpolate: 'sine-in-out' },
      {
        signal: setRotationZ,
        value: -rotationZRange,
        interpolate: 'sine-in-out',
      },
    ],
  };

  let containerEl: HTMLDivElement | undefined;
  const visible = createVisible(() => containerEl);

  // Subscribe to the shared clock only while near the viewport: the wobble
  // retransforms all ~28 desktop paths every frame.
  createEffect(() => {
    if (!visible()) return;
    const dispose = animate({ duration: 16, timeline, loop: true });
    onCleanup(dispose);
  });

  return (
    <div ref={containerEl}>
      <DiagramWrapper
        style={{
          'aspect-ratio': '128 / 70',
          margin: '0 auto',
          'max-width': '1080px',
        }}
      >
        <SvgScene
          rotation={{ x: rotationX(), z: rotationZ() }}
          scale={{ x: 0.8, y: 0.8, z: 0.8 }}
          style={{
            'stroke-linejoin': 'round',
            'box-sizing': 'border-box',
            'stroke-linecap': 'round',
            'stroke-width': '0.13',
            overflow: 'visible',
            stroke: 'oklch(from var(--b4) l c h / 0.72)',
            display: 'block',
            width: '100%',
            fill: 'none',
          }}
          orbitConstraints={{
            x: { min: -60, max: 26 },
            z: { min: -60, max: 30 },
          }}
          orbitAxes={['x', 'z']}
          viewBox="0 0 128 70"
          orbitControls
        >
          <SvgGroup rotation={{ z: sceneRotationZ }} translation={{ z: -2 }}>
            <SvgPath
              paths={pathPage}
              style={{ stroke: 'oklch(from var(--b4) l c h / 0.56)' }}
            />

            <SvgGroup
              translation={{ z: 1 }}
              style={{
                fill: 'var(--a0)',
                stroke: 'none',
              }}
            >
              <SvgPath paths={pathM} />
              <SvgPath paths={pathEmail} />
              <SvgPath paths={pathSearch} />
              <SvgPath paths={pathAgents} />
              <SvgPath paths={pathDocuments} />
              <SvgPath paths={pathChat} />
              <SvgPath paths={pathTasks} />
              <SvgPath paths={pathChannels} />
              <SvgPath paths={pathFolders} />
              <SvgAnchor x={8.2} y={55.5} id="tasks-end" />
              <SvgAnchor x={50} y={47.5} id="calls-end" />
            </SvgGroup>

            <SvgGroup translation={{ z: 4.5 }} class="scene-panel">
              <SvgPath paths={path2Panel} class="scene-panel-fill" />
              <SvgPath paths={path2Grid} class="scene-panel-grid" />
              <SvgPath paths={path2Edge} />
              <SvgGroup translation={{ z: 4.5 }}>
                <SvgPath paths={path2Header} style={{ fill: 'var(--b0)' }} />
                <SvgGroup translation={{ z: 1 }}>
                  <SvgPath paths={path2X} />
                  <SvgPath paths={path2Forward} />
                  <SvgPath paths={path2Backward} />
                  <SvgPath paths={path2Maximise} />
                </SvgGroup>
              </SvgGroup>
            </SvgGroup>

            <SvgGroup translation={{ z: 4.5 }} class="scene-panel">
              <SvgPath paths={path1Panel} class="scene-panel-fill" />
              <SvgPath paths={path1Grid} class="scene-panel-grid" />
              <SvgPath paths={path1Edge} />
              <SvgGroup translation={{ z: 4.5 }}>
                <SvgPath paths={path1Header} style={{ fill: 'var(--b0)' }} />
                <SvgGroup translation={{ z: 1 }}>
                  <SvgPath paths={path1X} />
                  <SvgPath paths={path1Forward} />
                  <SvgPath paths={path1Backward} />
                  <SvgPath paths={path1Maximise} />
                  <SvgAnchor x={65} y={6} id="messages-end" />
                  <SvgAnchor x={75} y={74} id="docs-end" />
                </SvgGroup>
              </SvgGroup>
            </SvgGroup>

            <SvgGroup
              translation={{ z: 5.5 }}
              class="launch-wrap"
              style={{ stroke: 'var(--a0)' }}
              onClick={() => {
                analytics.track('app_redirect', {
                  page_location: window.location.href,
                  button_name: 'launch',
                });
                window.location.href = buildAppUrl('/app/welcome');
              }}
            >
              <SvgPath class="launch-back" paths={pathLaunchBack} />
              <SvgPath class="launch" paths={pathLaunch} />
              <SvgPath class="launch-front" paths={pathLaunchBack} />
              <SvgAnchor x={34} y={18} id="email-end" />
            </SvgGroup>
          </SvgGroup>
        </SvgScene>

        <Show when={!breakpoint()}>
          <div
            style={{
              'font-size': '20px',
              'line-height': '20px',
              'user-select': 'none',
            }}
          >
            <div
              id="email-start"
              style={{
                position: 'absolute',
                left: '10px',
                top: '20%',
                'max-width': '130px',
              }}
            >
              <p style={labelHeadingStyle}>EMAIL &amp; CRM</p>
              <p style={{ ...labelBodyStyle, 'max-width': '200px' }}>
                Superhuman speed x Cursor-like AI.
              </p>
            </div>

            <div
              id="messages-start"
              style={{
                position: 'absolute',
                right: '37%',
                top: '0%',
              }}
            >
              <p style={labelHeadingStyle}>MESSAGES</p>
              <p style={{ ...labelBodyStyle, 'max-width': '200px' }}>
                Designed for focused
                <br /> technical discussions.
              </p>
            </div>

            <div
              id="tasks-start"
              style={{
                position: 'absolute',
                left: '0px',
                bottom: '5%',
              }}
            >
              <p style={labelHeadingStyle}>TASKS</p>
              <p style={{ ...labelBodyStyle, 'max-width': '210px' }}>
                Integrated with Github, @linked to mail and messages.
              </p>
            </div>

            <div
              id="calls-start"
              style={{
                position: 'absolute',
                left: '55%',
                bottom: '2%',
              }}
            >
              <p style={labelHeadingStyle}>CALLS</p>
              <p
                style={{
                  ...labelBodyStyle,
                  'max-width': '200px',
                  'text-align': 'left',
                }}
              >
                Vectorized and stored to team-level memory.
              </p>
            </div>

            <div
              id="docs-start"
              style={{
                position: 'absolute',
                right: '0px',
                bottom: '16%',
              }}
            >
              <p style={labelHeadingStyle}>DOCS</p>
              <p
                style={{
                  ...labelBodyStyle,
                  'max-width': '200px',
                  'text-align': 'left',
                }}
              >
                CRDT-fast live markdown collaboration.
              </p>
            </div>
          </div>

          <DiagramWire
            from="email-start"
            start="right"
            to="email-end"
            color="var(--c4)"
            opacity={wireOpacity}
            strokeWidth={1}
          />
          <DiagramWire
            from="messages-start"
            start="left"
            to="messages-end"
            color="var(--c4)"
            opacity={wireOpacity}
            strokeWidth={1}
          />
          <DiagramWire
            from="calls-start"
            start="left"
            to="calls-end"
            color="var(--c4)"
            opacity={wireOpacity}
            strokeWidth={1}
          />
          <DiagramWire
            from="tasks-start"
            start="right"
            to="tasks-end"
            color="var(--c4)"
            opacity={wireOpacity}
            strokeWidth={1}
          />
          <DiagramWire
            from="docs-start"
            start="left"
            to="docs-end"
            color="var(--c4)"
            opacity={wireOpacity}
            strokeWidth={1}
          />
        </Show>
      </DiagramWrapper>
    </div>
  );
}
