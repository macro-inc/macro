import { defineDoc } from '@app/features/ui-gallery/types';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import FilterIcon from '@icon/system/regular/funnel-simple.svg';
import ListIcon from '@icon/system/regular/list-bullets.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SidebarIcon from '@icon/system/regular/sidebar-simple.svg';
import SortIcon from '@icon/system/regular/sort-ascending.svg';
import BoardIcon from '@icon/system/regular/squares-four.svg';
import { ButtonGroup } from '@ui';
import { createSignal, For } from 'solid-js';
import { Button } from '../components/Button';
import { Tabs } from '../components/Tabs';

// #region demo:header
function HeaderDemo() {
  const [section, setSection] = createSignal<'overview' | 'tasks' | 'files'>(
    'overview'
  );
  const [layout, setLayout] = createSignal<'list' | 'board'>('list');
  return (
    <div class="flex h-12 w-full min-w-0 items-center gap-2 rounded-xl border border-edge-muted px-3">
      <h1 class="shrink-0 px-1 text-sm font-semibold text-ink">Launch</h1>
      <Tabs
        aria-label="Project sections"
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'tasks', label: 'Tasks', count: 8 },
          { value: 'files', label: 'Files' },
        ]}
        value={section()}
        onChange={setSection}
      />
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <HeaderActionGroup label="Task filters">
          <ButtonGroup.Button
            aria-label="Filter tasks"
            tooltip="Filter tasks"
            size="icon-sm"
          >
            <FilterIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
          </ButtonGroup.Button>
          <ButtonGroup.Button
            aria-label="Sort tasks"
            tooltip="Sort tasks"
            size="icon-sm"
          >
            <SortIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
          </ButtonGroup.Button>
        </HeaderActionGroup>
        <HeaderActionGroup label="Task layout">
          <ButtonGroup.Button
            aria-label="List"
            tooltip="List"
            size="icon-sm"
            aria-pressed={layout() === 'list'}
            onClick={() => setLayout('list')}
          >
            <ListIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
          </ButtonGroup.Button>
          <ButtonGroup.Button
            aria-label="Board"
            tooltip="Board"
            size="icon-sm"
            aria-pressed={layout() === 'board'}
            onClick={() => setLayout('board')}
          >
            <BoardIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
          </ButtonGroup.Button>
        </HeaderActionGroup>
        <Button variant="secondary" size="md">
          <PlusIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
          New
        </Button>
        <Button
          aria-label="Search tasks"
          tooltip="Search tasks"
          variant="secondary"
          size="icon-md"
        >
          <SearchIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
        </Button>
      </div>
    </div>
  );
}
// #endregion

// #region demo:selected
function SelectedDemo() {
  const [value, setValue] = createSignal<'signal' | 'noise'>('signal');
  const [open, setOpen] = createSignal(true);
  return (
    <div class="flex items-center gap-2">
      <Tabs
        aria-label="Inbox view"
        options={[
          { value: 'signal', label: 'Signal' },
          { value: 'noise', label: 'Noise' },
        ]}
        value={value()}
        onChange={setValue}
      />
      <Button
        aria-label={open() ? 'Hide details' : 'Show details'}
        tooltip={open() ? 'Hide details' : 'Show details'}
        variant="secondary"
        size="icon-md"
        aria-pressed={open()}
        onClick={() => setOpen(!open())}
      >
        <SidebarIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
      </Button>
    </div>
  );
}
// #endregion

// #region demo:sizes
function SizesDemo() {
  return (
    <div class="flex flex-col gap-3">
      <For each={['sm', 'md'] as const}>
        {(size) => (
          <div class="flex items-center gap-2">
            <span class="w-8 font-mono text-xs text-ink-subtle">{size}</span>
            <Tabs
              aria-label={`Tabs ${size}`}
              size={size}
              options={[
                { value: 'team', label: 'Team' },
                { value: 'me', label: 'Me' },
              ]}
              value="team"
              onChange={() => {}}
            />
            <Button variant="secondary" size={size}>
              <PlusIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
              New
            </Button>
            <Button
              aria-label="Search"
              tooltip="Search"
              variant="secondary"
              size={size === 'sm' ? 'icon-sm' : 'icon-md'}
            >
              <SearchIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
            </Button>
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Controls',
  category: 'Foundations',
  description:
    'Every bar is built from the same few controls in the same places: one component per role, one height per bar, one selected state. Tabs switch views; islands frame actions.',
  demos: [
    {
      id: 'header',
      title: 'Header anatomy',
      description:
        'Title, then view tabs, on the left. Islands on the right: filters, view options, then New and Search. Every control is 32px; icon-only glyphs are 16px.',
      render: HeaderDemo,
      fill: true,
    },
    {
      id: 'selected',
      title: 'One selected state',
      description:
        'A selected tab and a pressed toggle share the pressed fill, flat. Unselected options keep the outline Button frame.',
      render: SelectedDemo,
    },
    {
      id: 'sizes',
      title: 'One height per row',
      description:
        'A tab pill is the height of the Button of the same size, so a row mixes them without drift.',
      render: SizesDemo,
    },
  ],
  guidelines: {
    do: [
      'Use `Tabs` to switch a view, section, or one of a few values; `TabSelector` when tabs own panels or a dynamic collection.',
      'Group related actions in a `HeaderActionGroup`: filters, view options, sharing, navigation, detail toggles.',
      'Use `icon-md` for icon-only header buttons and `md` for labelled ones.',
      'Mark on/off toggles with `aria-pressed`.',
      'Collapse a narrow header with `Tabs iconOnly`, then a menu.',
    ],
    dont: [
      'Do not put tabs in an island or build tabs from Buttons.',
      'Do not restyle or resize a control from `class` or a wrapper; use its props.',
      'Do not invent a selected style (accent text, underline, tint) on desktop.',
      'Do not branch on `isTouchDevice()` to pick a tab component; set `touch`.',
    ],
  },
});
