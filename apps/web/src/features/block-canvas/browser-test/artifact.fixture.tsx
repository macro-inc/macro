import '../../../index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { UserContextProvider } from '@core/context/user';
import {
  createScene,
  type GraphicsEditor,
  type ShapeItem,
  type SlideTransition,
  setAllTransitionsCommand,
  translation,
} from '@macro-inc/graphics';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { DragDropProvider } from '@thisbeyond/solid-dnd';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { themeCssVars } from '../../theme/utils/themeCssVars';
import { CanvasNextEditor } from '../canvas-next';
import { plainRichText } from '../core/text-codec';

const artifact = (
  id: string,
  x: number,
  presentOrder: string
): ShapeItem<'artifact'> => ({
  id,
  type: 'artifact',
  placement: { parentId: 'scene-root', sortKey: presentOrder },
  transform: translation(x, 100),
  appearance: { fill: 'transparent', stroke: 'transparent' },
  geometry: {
    width: 320,
    height: 180,
    title: id,
    html: `<button id="target" onclick="this.textContent='clicked'">${id}</button>`,
    designWidth: 640,
    designHeight: 360,
    presentOrder,
  },
});
/** A full-bleed slide with a big number, so frames are easy to tell apart. */
const slide = (
  id: string,
  x: number,
  y: number,
  sortKey: string,
  color: string,
  size = { width: 320, height: 180 }
): ShapeItem<'artifact'> => ({
  id,
  type: 'artifact',
  placement: { parentId: 'scene-root', sortKey },
  transform: translation(x, y),
  appearance: { fill: 'transparent', stroke: 'transparent' },
  geometry: {
    ...size,
    title: id,
    html: `<style>html,body{margin:0;height:100%}body{display:grid;place-items:center;background:${color};color:white;font:700 160px system-ui}</style><span id="target">${id}</span>`,
    designWidth: 1280,
    designHeight: 720,
    presentOrder: sortKey,
  },
});

/**
 * `?deck` lays four slides out across the canvas, with notes and an elbow
 * arrow from slide 2 to slide 3, for the canvas transitions. The deck sits away
 * from the origin, where a bound arrow's hit box starts.
 */
const deck = createScene([
  slide('1', 1000, 1000, 'a2', '#3d5afe'),
  slide('2', 2400, 1200, 'a3', '#00897b'),
  slide('3', 1600, 2100, 'a4', '#e65100', { width: 480, height: 270 }),
  slide('4', 500, 1900, 'a5', '#6a1b9a'),
  {
    id: 'notes',
    type: 'rectangle',
    placement: { parentId: 'scene-root', sortKey: 'a1' },
    transform: translation(1500, 1350),
    geometry: {
      width: 320,
      height: 160,
      label: {
        content: plainRichText('Notes between slides'),
        fontSize: 28,
        fontFamily: 'sans',
        height: 40,
      },
    },
    appearance: {
      fill: 'var(--color-accent-bg)',
      stroke: 'var(--color-accent)',
      strokeWidth: 2,
      cornerRadius: 16,
    },
  },
  {
    id: 'arrow',
    type: 'connector',
    placement: { parentId: 'scene-root', sortKey: 'a0' },
    transform: translation(0, 0),
    appearance: {
      fill: 'transparent',
      stroke: 'var(--color-ink)',
      strokeWidth: 4,
    },
    geometry: {
      start: {
        point: { x: 0, y: 0 },
        binding: { targetId: '2', anchor: 'bottom' },
      },
      end: {
        point: { x: 0, y: 0 },
        binding: { targetId: '3', anchor: 'right' },
      },
      route: 'stepped',
      startHead: 'none',
      endHead: 'arrow',
    },
  },
]);

const params = new URLSearchParams(location.search);
const initial = {
  version: 2,
  document: params.has('deck')
    ? deck
    : createScene([
        artifact('First', 100, 'a0'),
        artifact('Second', 500, 'a1'),
      ]),
} as const;
const editable = params.has('edit');

// `?theme=light` or `?theme=dark` applies that app theme; touch devices get
// the app's touch styles, as boot sets them.
const theme = params.get('theme');
if (theme) {
  const light = theme === 'light';
  for (const [key, token] of Object.entries(
    themeCssVars(light ? macroLightTheme : macroDarkTheme)
  ))
    document.documentElement.style.setProperty(key, token);
  document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  document.documentElement.dataset.themeLight = String(light);
}
document.documentElement.dataset.touchDevice = String(
  matchMedia('(pointer: coarse)').matches
);

declare global {
  interface Window {
    /** Gives every slide the same transition, for tests and captures. */
    setSlideTransitions?: (transition: SlideTransition | null) => void;
  }
}
const exposeEditor = (editor: GraphicsEditor) => {
  window.setSlideTransitions = (transition) =>
    editor.execute(setAllTransitionsCommand, { transition });
};

render(
  () => (
    <div style={{ width: '100vw', height: '100vh' }}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <QueryClientProvider client={queryClient}>
            <UserContextProvider>
              <DragDropProvider>
                <CanvasNextEditor
                  documentId="canvas"
                  initial={initial}
                  canEdit={editable}
                  fitOnLoad={params.has('deck')}
                  onReady={exposeEditor}
                />
              </DragDropProvider>
            </UserContextProvider>
          </QueryClientProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </div>
  ),
  document.getElementById('app')!
);
