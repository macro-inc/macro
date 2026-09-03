import { defineDoc } from '@app/features/ui-gallery/types';
import { For } from 'solid-js';
import { Button } from '../components/Button';
import { Panel } from '../components/Panel';

// #region demo:depths
function DepthsDemo() {
  return (
    <div class="grid w-full grid-cols-1 gap-4 md:grid-cols-3">
      <For each={[0, 1, 2, 3, 4] as const}>
        {(depth) => (
          <Panel depth={depth} class="min-h-28">
            <Panel.Header class="px-3">
              <span class="font-mono text-xs text-ink-subtle">
                depth={depth}
              </span>
            </Panel.Header>
            <Panel.Body class="p-3">
              <p class="text-sm text-ink-muted">
                Reads `bg-surface` from its layer.
              </p>
            </Panel.Body>
          </Panel>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:nesting
function NestingDemo() {
  return (
    <Panel depth={0} class="w-full p-3">
      <p class="mb-2 font-mono text-xs text-ink-subtle">depth 0</p>
      <Panel depth={1} class="p-3">
        <p class="mb-2 font-mono text-xs text-ink-subtle">depth 1</p>
        <Panel depth={2} class="p-3">
          <p class="mb-2 font-mono text-xs text-ink-subtle">depth 2</p>
          <Panel depth={3} class="p-3">
            <p class="font-mono text-xs text-ink-subtle">depth 3</p>
          </Panel>
        </Panel>
      </Panel>
    </Panel>
  );
}
// #endregion

// #region demo:layer-tokens
function LayerTokensDemo() {
  return (
    <div class="grid w-full grid-cols-1 gap-4 md:grid-cols-3">
      <For each={[1, 2, 3] as const}>
        {(depth) => (
          <Panel depth={depth} class="p-3">
            <p class="mb-3 font-mono text-xs text-ink-subtle">depth={depth}</p>
            <div class="flex flex-col gap-2">
              <div class="rounded-sm bg-inset p-2 text-xs text-ink-muted">
                bg-inset
              </div>
              <div class="rounded-sm bg-surface p-2 text-xs text-ink-muted">
                bg-surface
              </div>
              <div class="rounded-sm bg-lift p-2 text-xs text-ink-muted">
                bg-lift
              </div>
            </div>
          </Panel>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:controls-on-depth
function ControlsOnDepthDemo() {
  return (
    <div class="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
      <For each={[1, 2, 3, 4] as const}>
        {(depth) => (
          <Panel depth={depth}>
            <Panel.Body class="flex flex-wrap gap-2 p-3">
              <Button variant="ghost">Ghost</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="accent">Accent</Button>
              <Button variant="danger">Danger</Button>
            </Panel.Body>
          </Panel>
        )}
      </For>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Surfaces & Depth',
  category: 'Foundations',
  description:
    'Depth, not a chosen color, is how backgrounds are set. A container declares its depth and everything inside reads `bg-surface`, `bg-inset`, and `bg-lift` relative to it — so the same component looks right wherever it is nested.',
  exports: ['Layer', 'Surface'],
  import: "import { Layer, Panel, Surface } from '@ui';",
  demos: [
    {
      id: 'depths',
      title: 'The depth scale',
      description:
        'Depth 0 sits furthest back and 4 closest to the viewer. `Panel` and `Surface` take a `depth` prop; `Layer` marks a subtree without rendering a box.',
      render: DepthsDemo,
      fill: true,
      depth: 0,
    },
    {
      id: 'nesting',
      title: 'Nesting',
      description:
        'Each level steps forward, which is what makes nested containers legible without borders doing all the work.',
      render: NestingDemo,
      fill: true,
      depth: 0,
    },
    {
      id: 'layer-tokens',
      title: 'Layer-relative tokens',
      description:
        '`bg-inset` sits one step back, `bg-surface` is the layer itself, `bg-lift` one step forward. The classes never change — only what they resolve to.',
      render: LayerTokensDemo,
      fill: true,
      depth: 0,
    },
    {
      id: 'controls-on-depth',
      title: 'Controls across depths',
      description:
        'Check any new component here. Contrast that only works at one depth is the most common design-system regression in the app.',
      render: ControlsOnDepthDemo,
      fill: true,
      depth: 0,
    },
  ],
  guidelines: {
    do: [
      'Set `depth` on the container and let children read `bg-surface`.',
      'Use `bg-inset` for wells (inputs, code blocks) and `bg-lift` for raised items.',
      'Verify new components at several depths using the toolbar control.',
    ],
    dont: [
      'Do not reference `bg-surface-2` and friends directly in a component; that pins it to one depth.',
      'Do not nest more than about three depth steps — past that the steps stop reading.',
    ],
  },
});
