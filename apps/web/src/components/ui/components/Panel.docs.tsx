import { defineDoc } from '@app/features/ui-gallery/types';
import { For } from 'solid-js';
import { Button } from './Button';
import { Panel } from './Panel';

// #region demo:slots
function SlotsDemo() {
  return (
    <Panel depth={2} class="w-full max-w-md">
      <Panel.Header class="px-3">
        <span class="text-sm font-medium text-ink">Panel.Header</span>
      </Panel.Header>
      <Panel.Toolbar class="gap-2">
        <Button variant="ghost" size="sm">
          Toolbar
        </Button>
        <Button variant="ghost" size="sm">
          Action
        </Button>
      </Panel.Toolbar>
      <Panel.Body class="p-3">
        <p class="text-sm text-ink-muted">
          Panel.Body takes the remaining height and is the only slot that
          shrinks.
        </p>
      </Panel.Body>
      <Panel.Footer class="justify-end gap-2 px-3">
        <Button variant="ghost" size="sm">
          Cancel
        </Button>
        <Button variant="accent" size="sm">
          Confirm
        </Button>
      </Panel.Footer>
    </Panel>
  );
}
// #endregion

// #region demo:scroll
function ScrollDemo() {
  return (
    <Panel depth={2} class="h-56 w-full max-w-md">
      <Panel.Header class="px-3">
        <span class="text-sm font-medium text-ink">Scrolling body</span>
      </Panel.Header>
      <Panel.Body scroll class="p-3">
        <div class="flex flex-col gap-2">
          <For each={Array.from({ length: 20 }, (_, i) => i + 1)}>
            {(row) => (
              <div class="rounded-sm bg-inset p-2 text-sm text-ink-muted">
                Row {row}
              </div>
            )}
          </For>
        </div>
      </Panel.Body>
    </Panel>
  );
}
// #endregion

// #region demo:active
function ActiveDemo() {
  return (
    <div class="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
      <Panel depth={2} class="min-h-24">
        <Panel.Body class="p-3">
          <p class="text-sm text-ink-muted">Default</p>
        </Panel.Body>
      </Panel>
      <Panel active depth={2} class="min-h-24">
        <Panel.Body class="p-3">
          <p class="text-sm text-ink-muted">active</p>
        </Panel.Body>
      </Panel>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Panel',
  category: 'Layout',
  description:
    'A depth-aware container with fixed header, toolbar, and footer slots around a body that absorbs the remaining height. The layout is a CSS grid, so the body scrolls without the chrome moving.',
  status: 'stable',
  exports: ['Panel', 'Surface'],
  import: "import { Panel } from '@ui';",
  demos: [
    {
      id: 'slots',
      title: 'Slots',
      description:
        'Every slot is optional and renders nothing when empty, so a body-only Panel has no stray borders.',
      render: SlotsDemo,
    },
    {
      id: 'scroll',
      title: 'Scrolling body',
      description:
        '`Panel.Body scroll` wraps the content in `Scroll`, keeping the header and footer pinned. Give the Panel a bounded height for this to take effect.',
      render: ScrollDemo,
    },
    {
      id: 'active',
      title: 'Active state',
      description:
        '`active` draws the focus ring used for the panel holding keyboard focus in a split layout.',
      render: ActiveDemo,
      fill: true,
    },
  ],
  props: [
    {
      name: 'depth',
      type: '0 | 1 | 2 | 3 | 4',
      default: '0',
      description:
        'Layer depth for the subtree. Children read `bg-surface` relative to this.',
    },
    {
      name: 'active',
      type: 'boolean',
      default: 'false',
      description: 'Draws the active focus ring around the panel.',
    },
    {
      name: 'solid',
      type: 'boolean',
      default: 'false',
      description: 'Opts out of surface transparency.',
    },
    {
      name: 'hideBorder',
      type: 'boolean',
      default: 'false',
      description: 'Removes the border while keeping the surface and radius.',
    },
    {
      name: 'edgeColor',
      type: 'string',
      default: 'var(--color-edge)',
      description: 'Overrides the border color.',
    },
  ],
  guidelines: {
    do: [
      'Put controls in `Panel.Toolbar` and titles in `Panel.Header` so heights stay consistent across the app.',
      'Set `depth` on the Panel rather than a background class on its children.',
      'Use `Panel.Body scroll` instead of adding `overflow-auto` yourself.',
    ],
    dont: [
      'Do not nest a Panel inside `Panel.Body` just to get padding — use the body’s own class.',
      'Do not give `Panel.Header` a custom height; the 40px minimum is what aligns panels side by side.',
    ],
  },
});
