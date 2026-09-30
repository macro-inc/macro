import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal, Show } from 'solid-js';
import { Button } from '../Button';
import { defineTourTargets, Tour, type TourStep, tourTarget } from '.';

const DEMO = defineTourTargets('tour-demo', [
  'search',
  'create',
  'toggle',
  'hidden',
]);

function CardPopover() {
  return (
    <Tour.Popover class="w-72 rounded-2xl border border-edge bg-dialog p-4 text-ink shadow-lg">
      <Card />
    </Tour.Popover>
  );
}

function Card() {
  return (
    <>
      <div class="mb-3 flex items-center gap-1 text-ink-muted">
        <Tour.Progress class="mr-auto text-xs" />
        <Tour.Previous />
        <Tour.Next />
        <Tour.Close />
      </div>
      <Tour.Title class="text-base font-medium" />
      <Tour.Description class="mt-1 text-sm text-ink-muted" />
    </>
  );
}

// #region demo:popover
const POPOVER_STEPS: TourStep[] = [
  {
    target: DEMO.search,
    title: 'Search anything',
    description: 'Steps point at a target registered with `tourTarget`.',
  },
  {
    target: DEMO.create,
    placement: 'bottom-start',
    title: 'Create something',
    description: 'Each step can prefer its own placement.',
  },
  {
    title: 'No target',
    description: 'A step without a target floats in the boundary.',
  },
];

function PopoverDemo() {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="flex items-center gap-2">
      <Button variant="outline" onClick={() => setOpen(true)}>
        Start tour
      </Button>
      <Button variant="ghost" ref={tourTarget(DEMO.search)}>
        Search
      </Button>
      <Button variant="ghost" ref={tourTarget(DEMO.create)}>
        Create
      </Button>
      <Show when={open()}>
        <Tour.Root steps={POPOVER_STEPS} onDismiss={() => setOpen(false)}>
          <Tour.Highlight />
          <CardPopover />
        </Tour.Root>
      </Show>
    </div>
  );
}
// #endregion

// #region demo:entry
const ENTRY_STEPS: TourStep[] = [
  {
    target: DEMO.toggle,
    title: 'Hidden settings',
    description: 'The next step points at something that is not shown yet.',
  },
  {
    target: DEMO.hidden,
    entry: DEMO.toggle,
    entryLabel: 'Show settings to continue the tour',
    title: 'Found it',
    description:
      'While the target is missing the card hides and a beacon marks the entry until the target appears.',
  },
];

function EntryDemo() {
  const [open, setOpen] = createSignal(false);
  const [shown, setShown] = createSignal(false);
  return (
    <div class="flex items-center gap-2">
      <Button variant="outline" onClick={() => setOpen(true)}>
        Start tour
      </Button>
      <Button
        variant="ghost"
        ref={tourTarget(DEMO.toggle)}
        onClick={() => setShown((value) => !value)}
      >
        {shown() ? 'Hide settings' : 'Show settings'}
      </Button>
      <Show when={shown()}>
        <span ref={tourTarget(DEMO.hidden)} class="text-sm text-ink-muted">
          Settings
        </span>
      </Show>
      <Show when={open()}>
        <Tour.Root steps={ENTRY_STEPS} onDismiss={() => setOpen(false)}>
          <Tour.Highlight />
          <Tour.Beacon />
          <Tour.Hint class="w-56 rounded-xl border border-edge bg-dialog p-3 text-sm text-ink shadow-lg">
            <p>Show settings to continue.</p>
            <div class="mt-2">
              <Tour.Next variant="outline" size="sm">
                Skip
              </Tour.Next>
            </div>
          </Tour.Hint>
          <CardPopover />
        </Tour.Root>
      </Show>
    </div>
  );
}
// #endregion

// #region demo:panel
function PanelDemo() {
  return (
    <Tour.Root steps={POPOVER_STEPS}>
      <Tour.Panel class="w-80 rounded-xl border border-edge-muted p-4">
        <Card />
      </Tour.Panel>
    </Tour.Root>
  );
}
// #endregion

export default defineDoc({
  name: 'Tour',
  category: 'Overlays',
  description:
    'Composable product tours. Features declare named targets with `defineTourTargets` and attach them with `tourTarget`; a tour lists steps that point at them.',
  status: 'beta',
  exports: ['Tour', 'defineTourTargets', 'tourTarget', 'useTour'],
  import:
    "import { defineTourTargets, Tour, tourTarget } from '@ui/components/Tour';",
  guidelines: {
    do: [
      'Declare targets with `defineTourTargets` and attach them with `ref={tourTarget(...)}`.',
      'Give a step an `entry` when its target must be opened first; the beacon marks the way.',
      "Use `scope: 'app'` only for shared chrome outside any split.",
    ],
    dont: [
      'Do not target elements with selectors or data attributes.',
      'Do not navigate, open panels, or change pages from a tour step.',
      'Do not attach a target to a `display: contents` element; it has no box to point at.',
    ],
  },
  demos: [
    {
      id: 'popover',
      title: 'Popover',
      description:
        '`Tour.Popover` floats next to the target and stays in the boundary. `Tour.Highlight` outlines the target.',
      render: PopoverDemo,
    },
    {
      id: 'entry',
      title: 'Entry beacon',
      description:
        'Give a step an `entry` when its target needs to be opened first. The tour never navigates for the user; it marks the way.',
      render: EntryDemo,
    },
    {
      id: 'panel',
      title: 'Inline panel',
      description:
        '`Tour.Panel` renders the same parts in normal flow, for docked or embedded tours.',
      render: PanelDemo,
    },
  ],
});
