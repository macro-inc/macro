import { defineDoc } from '@app/features/ui-gallery/types';
import Clock from '@phosphor/clock.svg';
import FileText from '@phosphor/file-text.svg';
import ListChecks from '@phosphor/list-checks.svg';
import { createSignal, For, type JSX } from 'solid-js';
import { Button } from './Button';
import { Card } from './Card';
import { Checkbox } from './Checkbox';
import { Item } from './Item';
import { Select } from './Select';

// #region demo:shared
function Pair(props: { children: JSX.Element }) {
  return (
    <div class="grid w-full max-w-4xl items-start gap-5 lg:grid-cols-2">
      {props.children}
    </div>
  );
}

function Identity(props: {
  task?: boolean;
  description?: string;
  children?: JSX.Element;
}) {
  return (
    <Item class="p-0">
      <Item.Media>
        {props.task ? (
          <ListChecks aria-hidden="true" />
        ) : (
          <FileText aria-hidden="true" />
        )}
      </Item.Media>
      <Item.Content>
        <Item.Title>
          {props.task
            ? 'Bring the reading room to life'
            : 'A quieter kind of workspace'}
        </Item.Title>
        {props.description && (
          <Item.Description>{props.description}</Item.Description>
        )}
        {props.children}
      </Item.Content>
    </Item>
  );
}

function Metadata() {
  return (
    <Card.Metadata class="gap-x-3 gap-y-1">
      <span>Seamus · Design</span>
      <span class="inline-flex items-center gap-1">
        <Clock class="size-3" aria-hidden="true" />
        Edited 2h ago
      </span>
    </Card.Metadata>
  );
}

function Property(props: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select<string>
      options={props.options}
      value={props.value}
      onChange={(value) => value && props.onChange(value)}
      itemComponent={(item) => (
        <Select.Item
          item={item.item}
          class="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm outline-none data-highlighted:bg-hover"
        >
          <Select.ItemLabel>{item.item.rawValue}</Select.ItemLabel>
          <Select.ItemIndicator>✓</Select.ItemIndicator>
        </Select.Item>
      )}
    >
      <Select.Trigger
        aria-label={props.label}
        class="min-h-7 w-auto rounded-md border border-edge bg-hover px-2 text-xs text-ink-muted focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Select.Value<string>>{(state) => state.selectedOption()}</Select.Value>
        <Select.Icon />
      </Select.Trigger>
      <Select.Content>
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}

function TaskProperties() {
  const [status, setStatus] = createSignal('Not started');
  const [priority, setPriority] = createSignal('Priority');
  const [assignee, setAssignee] = createSignal('Seamus');
  return (
    <div class="flex flex-wrap items-center gap-2">
      <Property
        label="Task status"
        options={['Not started', 'In progress', 'Done']}
        value={status()}
        onChange={setStatus}
      />
      <Property
        label="Task priority"
        options={['Priority', 'Low', 'Medium', 'High']}
        value={priority()}
        onChange={setPriority}
      />
      <Property
        label="Task assignee"
        options={['Unassigned', 'Seamus', 'Alex', 'Jordan']}
        value={assignee()}
        onChange={setAssignee}
      />
    </div>
  );
}

function Checklist() {
  const entries = [
    'Collect references',
    'Review the material palette',
    'Share the first layout',
  ];
  const [done, setDone] = createSignal<string[]>([entries[0]]);
  return (
    <div class="flex flex-col gap-3">
      <For each={entries}>
        {(entry) => (
          <Checkbox
            checked={done().includes(entry)}
            onChange={(checked) =>
              setDone((current) =>
                checked
                  ? [...current, entry]
                  : current.filter((value) => value !== entry)
              )
            }
          >
            <Checkbox.Control />
            <Checkbox.Label
              class="text-sm"
              classList={{
                'line-through text-ink-muted': done().includes(entry),
              }}
            >
              {entry}
            </Checkbox.Label>
          </Checkbox>
        )}
      </For>
      <span class="text-xs text-ink-muted" role="status">
        {done().length} of {entries.length} complete
      </span>
    </div>
  );
}

function Excerpt() {
  return (
    <div class="space-y-3">
      <p class="text-xs font-medium uppercase tracking-widest text-ink-muted">
        Field notes / 01
      </p>
      <h3 class="font-serif text-2xl leading-tight">A place to slow down.</h3>
      <p class="text-sm leading-6 text-ink-muted">
        Warm materials, generous daylight, and a table big enough to spread
        things out. A room that makes space for the work, and the people doing
        it.
      </p>
    </div>
  );
}
// #endregion

// #region demo:compact
function CompactDemo() {
  const [done, setDone] = createSignal(false);
  return (
    <Pair>
      <Card variant="outlined">
        <Card.Header>
          <Identity />
          <Metadata />
        </Card.Header>
      </Card>
      <Card variant="outlined">
        <Card.Header>
          <Item class="p-0">
            <Item.Content>
              <Identity task />
            </Item.Content>
            <Item.Actions>
              <Button
                size="sm"
                variant="ghost"
                aria-pressed={done()}
                onClick={() => setDone(!done())}
              >
                {done() ? 'Done' : 'Complete'}
              </Button>
            </Item.Actions>
          </Item>
          <Metadata />
        </Card.Header>
      </Card>
    </Pair>
  );
}
// #endregion

// #region demo:metadata
function MetadataDemo() {
  return (
    <div class="grid w-full max-w-4xl gap-4 lg:grid-cols-2">
      <Card variant="filled" offset={1} class="rounded-lg">
        <Card.Header class="flex-1 pb-3">
          <Identity description="References and decisions for the reading room.">
            <div class="pt-1">
              <Metadata />
            </div>
          </Identity>
        </Card.Header>
        <Card.Footer class="min-h-12 py-2 pl-16">
          <Card.Metadata class="gap-x-2">
            <span>Document</span>
            <span aria-hidden="true">·</span>
            <span>8 pages</span>
            <span aria-hidden="true">·</span>
            <span>Reading room</span>
          </Card.Metadata>
        </Card.Footer>
      </Card>
      <Card variant="filled" offset={1} class="rounded-lg">
        <Card.Header class="flex-1 pb-3">
          <Identity
            task
            description="Turn the moodboard into a first proposal."
          >
            <div class="pt-1">
              <Metadata />
            </div>
          </Identity>
        </Card.Header>
        <Card.Footer class="min-h-12 py-2 pl-16">
          <TaskProperties />
        </Card.Footer>
      </Card>
    </div>
  );
}
// #endregion

// #region demo:preview
function PreviewDemo() {
  return (
    <Pair>
      <Card variant="filled" offset={1}>
        <Card.Header>
          <Identity />
        </Card.Header>
        <Card.Media class="px-4 pb-4 bg-transparent">
          <Card variant="filled" offset={1}>
            <Card.Body class="p-5">
              <Excerpt />
            </Card.Body>
          </Card>
        </Card.Media>
        <Card.Footer>
          <Metadata />
        </Card.Footer>
      </Card>
      <Card variant="filled" offset={1}>
        <Card.Header>
          <Identity task />
          <TaskProperties />
        </Card.Header>
        <Card.Body class="pt-0">
          <Checklist />
        </Card.Body>
        <Card.Footer>
          <Metadata />
        </Card.Footer>
      </Card>
    </Pair>
  );
}
// #endregion

// #region demo:embed
function EmbedDemo() {
  const [zoom, setZoom] = createSignal(100);
  const [notes, setNotes] = createSignal(
    'Keep the layout open. Leave space around the table for two people to work side by side.'
  );
  return (
    <Pair>
      <Card variant="filled" offset={1}>
        <Card.Header>
          <Identity description="Canvas · Material study" />
          <Metadata />
        </Card.Header>
        <Card.Media class="border-t border-edge-muted">
          <div
            class="h-72 overflow-auto p-5"
            tabindex="0"
            role="region"
            aria-label="Canvas preview"
          >
            <div
              class="grid min-w-64 grid-cols-2 gap-3 origin-top-left"
              style={{ width: `${zoom()}%` }}
            >
              <Card variant="filled" offset={1} class="col-span-2">
                <Card.Body>
                  <Excerpt />
                </Card.Body>
              </Card>
              <div class="flex h-28 items-end rounded-lg bg-accent/20 p-3 text-sm text-accent">
                Natural light
              </div>
              <div class="flex h-28 items-end rounded-lg border border-edge bg-surface p-3 text-sm">
                Quiet corners
              </div>
              <p class="col-span-2 text-xs text-ink-muted">
                A shared table, a soft edge, a place to pause.
              </p>
            </div>
          </div>
          <div class="flex items-center justify-center gap-3 border-t border-edge-muted p-2">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Zoom out"
              disabled={zoom() <= 75}
              onClick={() => setZoom(zoom() - 25)}
            >
              −
            </Button>
            <output class="w-12 text-center text-xs" aria-label="Zoom level">
              {zoom()}%
            </output>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Zoom in"
              disabled={zoom() >= 150}
              onClick={() => setZoom(zoom() + 25)}
            >
              +
            </Button>
          </div>
        </Card.Media>
      </Card>
      <Card variant="filled" offset={1}>
        <Card.Header>
          <Identity task />
          <Metadata />
        </Card.Header>
        <Card.Body class="space-y-4 border-t border-edge-muted">
          <TaskProperties />
          <label class="flex flex-col gap-2 text-xs text-ink-muted">
            Working notes
            <textarea
              class="min-h-28 resize-y rounded-md border border-edge-muted bg-input p-3 text-sm leading-6 text-ink focus-visible:outline-2 focus-visible:outline-accent"
              value={notes()}
              onInput={(event) => setNotes(event.currentTarget.value)}
            />
          </label>
          <Checklist />
        </Card.Body>
      </Card>
    </Pair>
  );
}
// #endregion

// #region demo:details
function DetailsDemo() {
  return (
    <Pair>
      <Card variant="outlined">
        <Card.Header>
          <Identity description="A small reference that opens up when needed." />
          <Metadata />
        </Card.Header>
        <Card.Body class="border-t border-edge-muted">
          <details class="group">
            <summary class="text-sm text-ink-muted focus-visible:outline-2 focus-visible:outline-accent">
              Read document excerpt
            </summary>
            <div class="pt-4">
              <Excerpt />
            </div>
          </details>
        </Card.Body>
      </Card>
      <Card variant="outlined">
        <Card.Header>
          <Identity task />
          <TaskProperties />
        </Card.Header>
        <Card.Body class="border-t border-edge-muted">
          <details open>
            <summary class="text-sm text-ink-muted focus-visible:outline-2 focus-visible:outline-accent">
              Acceptance criteria
            </summary>
            <div class="pt-4">
              <Checklist />
            </div>
          </details>
        </Card.Body>
      </Card>
    </Pair>
  );
}
// #endregion

export default defineDoc({
  name: 'Rich cards',
  category: 'Data Display',
  status: 'beta',
  exports: [],
  import: "import { Card, Item } from '@ui';",
  description:
    'Five document and task compositions: from a small reference to an embedded workspace. Demo controls use local state; embedded content is a stand-in for a real editor or canvas.',
  guidelines: {
    do: [
      'Let content determine height. Metadata-only cards need no preview placeholder.',
      'Keep embedded scrolling and controls inside the body; keep identity outside it.',
      'Use offset={1} for nested filled surfaces.',
      'Keep title navigation, menus, and task controls as separate keyboard targets.',
    ],
  },
  demos: [
    {
      id: 'compact',
      title: '01 / Compact reference',
      description:
        'Minimal identity and metadata. A task can offer one quick action without a full properties row.',
      render: CompactDemo,
      fill: true,
    },
    {
      id: 'metadata',
      title: '02 / Metadata and properties',
      description:
        'A direct evolution of the existing card: title, owner, timestamp, then document facts or editable task properties.',
      render: MetadataDemo,
      fill: true,
    },
    {
      id: 'preview',
      title: '03 / Rich preview',
      description:
        'An inset document excerpt and an actionable task checklist. Nested content sits one layer above its card.',
      render: PreviewDemo,
      fill: true,
    },
    {
      id: 'embed',
      title: '04 / Full embed',
      description:
        'A scrollable canvas stand-in with zoom controls, paired with editable task notes and a checklist. Try the controls independently.',
      render: EmbedDemo,
      fill: true,
    },
    {
      id: 'details',
      title: '05 / Progressive disclosure',
      description:
        'Keep references compact until details are needed. Native disclosures support keyboard expansion and preserve task state when collapsed.',
      render: DetailsDemo,
      fill: true,
    },
  ],
});
