import { defineDoc } from '@app/features/ui-gallery/types';
import { For, lazy, Suspense } from 'solid-js';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { InvertUtil } from '../components/InvertUtil';
import { Layer } from '../components/Layer';
import { Panel } from '../components/Panel';

// Keep the renderer's app dependencies out of unrelated gallery pages.
const InvertedMarkdown = lazy(() => import('./InvertedMarkdown'));

// #region demo:depths
function DepthsDemo() {
  return (
    <div class="grid w-full grid-cols-1 gap-4 md:grid-cols-3">
      <For each={[0, 1, 2, 3, 4] as const}>
        {(depth) => (
          <Panel depth={depth} class="min-h-28 bg-surface">
            <Panel.Header class="px-3">
              <span class="font-mono text-xs text-ink-subtle">
                depth={depth}
              </span>
            </Panel.Header>
            <Panel.Body class="p-3">
              <p class="text-sm text-ink-muted">Hello!</p>
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
    <Panel depth={0} class="w-full p-3 bg-surface">
      <p class="mb-2 font-mono text-xs text-ink-subtle">depth 0</p>
      <Panel depth={1} class="p-3 bg-surface">
        <p class="mb-2 font-mono text-xs text-ink-subtle">depth 1</p>
        <Panel depth={2} class="p-3 bg-surface">
          <p class="mb-2 font-mono text-xs text-ink-subtle">depth 2</p>
          <Panel depth={3} class="p-3 bg-surface">
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
      <For each={[0, 1, 2] as const}>
        {(depth) => (
          <Panel depth={depth} class="p-3 bg-surface">
            <p class="mb-3 font-mono text-xs text-ink-subtle">depth={depth}</p>
            <div class="flex flex-col gap-2">
              <For each={[-2, -1, 0, 1, 2] as const}>
                {(offset) => (
                  <Layer offset={offset}>
                    <div class="rounded-sm bg-surface p-2 text-xs text-ink-muted">
                      Layer offset={offset > 0 ? `+${offset}` : offset}
                    </div>
                  </Layer>
                )}
              </For>
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

// #region demo:inverted
function InvertedDemo() {
  return (
    <div class="w-full rounded-lg bg-ink p-4">
      <InvertUtil>
        <div class="flex flex-col gap-3">
          <p>Inverted section</p>
          <p class="text-sm text-ink-muted">
            Text, borders, controls, and nested layers use the local palette.
          </p>
          <Input aria-label="Inverted input" placeholder="Write something…" />
          <div class="flex flex-wrap gap-2">
            <Button variant="ghost">Ghost</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="strong">Strong</Button>
            <Button disabled>Disabled</Button>
          </div>
          <Layer offset={1}>
            <div class="rounded-md border border-edge-muted bg-surface p-3 text-ink">
              Raised surface
            </div>
          </Layer>
          <InvertUtil>
            <div class="rounded-md bg-surface p-3 text-ink">
              A nested inversion restores the original foreground and
              background.
            </div>
          </InvertUtil>
          <div class="min-w-0 border-t border-edge-muted pt-4">
            <Suspense>
              <InvertedMarkdown />
            </Suspense>
          </div>
        </div>
      </InvertUtil>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Surfaces & Depth',
  category: 'Foundations',
  description:
    'Depth, not a chosen color, is how backgrounds are set. A container declares its depth and everything inside reads `bg-surface` and `bg-inset` relative to it — so the same component looks right wherever it is nested.',
  exports: ['Layer', 'Surface', 'InvertUtil'],
  import: "import { InvertUtil, Layer, Panel, Surface } from '@ui';",
  demos: [
    {
      id: 'inverted',
      title: 'Inverted sections',
      description:
        'Place InvertUtil inside a bg-ink section, or wrap a bg-surface section in it. This example includes the app’s StaticMarkdown renderer with headings, nested lists, quotes, tables, and code. It starts at depth 0 and inherits theme changes. Portals outside the boundary keep the surrounding app palette.',
      render: InvertedDemo,
      fill: true,
      depth: 0,
    },
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
        '`bg-inset` sits one step back and `bg-surface` is the layer itself. To move content forward, wrap it in `Layer offset={1}` and continue using `bg-surface`.',
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
      'Use `bg-inset` for wells (inputs and code blocks) and `Layer offset={1}` with `bg-surface` for raised items.',
      'Verify new components at several depths using the toolbar control.',
    ],
    dont: [
      'Do not reference `bg-surface-2` and friends directly in a component; that pins it to one depth.',
      'Do not nest more than about three depth steps — past that the steps stop reading.',
    ],
  },
});
