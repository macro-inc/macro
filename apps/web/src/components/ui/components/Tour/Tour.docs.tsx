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

const cardClass =
  'w-72 rounded-2xl border border-edge bg-dialog p-4 text-ink shadow-lg';

function Card() {
  return (
    <>
      <div class="mb-3 flex items-center gap-1 text-ink-muted">
        <Tour.Progress class="mr-auto text-[10px]" />
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
          <Tour.Popover class={cardClass}>
            <Card />
          </Tour.Popover>
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
      'While the target is missing the card hides and a beacon marks the entry. Pressing it resumes the step.',
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
          <Tour.Popover class={cardClass}>
            <Card />
          </Tour.Popover>
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
  import: "import { defineTourTargets, Tour, tourTarget } from '@ui';",
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
