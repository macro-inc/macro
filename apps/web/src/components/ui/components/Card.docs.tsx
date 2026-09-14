import { defineDoc } from '@app/features/ui-gallery/types';
import FileText from '@phosphor/file-text.svg';
import { createSignal, For, Show } from 'solid-js';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { Item } from './Item';

// #region demo:document
function DocumentDemo() {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <Card class="w-full max-w-sm">
      <Card.Header>
        <Item class="p-0">
          <Item.Media>
            <FileText aria-hidden="true" />
          </Item.Media>
          <Item.Content>
            <Card.Title>Making room for good work</Card.Title>
            <Card.Description>
              A working note on focus, rhythm, and collaboration.
            </Card.Description>
          </Item.Content>
          <Item.Actions>
            <Badge size="sm" variant="outline">
              Draft
            </Badge>
          </Item.Actions>
        </Item>
      </Card.Header>
      <Card.Media class="p-5">
        <div class="rounded border border-edge-muted bg-surface p-5 text-sm leading-6">
          <h3 class="mb-2 font-semibold">Start with a little space.</h3>
          <p class="text-ink-muted">
            The best ideas rarely arrive between two notifications. Protect a
            small part of the day for thinking.
          </p>
          <Show when={expanded()}>
            <p class="mt-3 text-ink-muted">
              Share the rough draft early. Leave enough context for someone else
              to pick up the thread.
            </p>
          </Show>
        </div>
      </Card.Media>
      <Card.Footer>
        <Card.Metadata>
          <span>Alex Morgan</span>
          <span>Edited 2h ago</span>
        </Card.Metadata>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={expanded()}
          onClick={() => setExpanded(!expanded())}
        >
          {expanded() ? 'Show less' : 'Read more'}
        </Button>
      </Card.Footer>
    </Card>
  );
}
// #endregion

// #region demo:composition
function CompositionDemo() {
  return (
    <div class="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
      <Card>
        <Card.Header>
          <Card.Metadata>TEAM / DESIGN</Card.Metadata>
          <Card.Title>Weekly studio</Card.Title>
          <Card.Description>
            A little time to share what is taking shape.
          </Card.Description>
        </Card.Header>
        <Card.Body>
          <Item.Metadata>
            <span>Thursday, 10:00–10:30</span>
            <span>4 people</span>
          </Item.Metadata>
        </Card.Body>
        <Card.Footer>
          <Badge size="sm" variant="outline">
            Recurring
          </Badge>
          <span class="text-xs text-ink-muted">30 minutes</span>
        </Card.Footer>
      </Card>
      <Card>
        <Card.Media class="flex aspect-[2/1] items-end bg-accent/10 p-5">
          <span class="text-3xl font-semibold tracking-tight text-accent">
            Field notes.
          </span>
        </Card.Media>
        <Card.Header>
          <Card.Title>Small observations, new directions</Card.Title>
          <Card.Description>
            A collection of things we noticed this week.
          </Card.Description>
        </Card.Header>
      </Card>
    </div>
  );
}
// #endregion

// #region demo:variants
function VariantsDemo() {
  return (
    <div class="grid w-full max-w-2xl gap-4 sm:grid-cols-3">
      <For each={['ghost', 'outlined', 'filled'] as const}>
        {(variant) => (
          <Card variant={variant} depth={2}>
            <Card.Header>
              <Card.Title>{variant}</Card.Title>
              <Card.Description>Depth 2</Card.Description>
            </Card.Header>
            <Card.Body>
              <Item variant="filled" offset={1}>
                <Item.Content>
                  <Item.Title>Nested item</Item.Title>
                  <Item.Description>Filled · parent depth + 1</Item.Description>
                </Item.Content>
              </Item>
            </Card.Body>
          </Card>
        )}
      </For>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Card',
  category: 'Data Display',
  status: 'beta',
  exports: ['Card'],
  import: "import { Card, Item } from '@ui';",
  description:
    'A rich content frame with freely ordered slots. Compose an Item for identity, then add media, content, and a footer as needed.',
  demos: [
    {
      id: 'variants',
      title: 'Variants and depth',
      description:
        'Ghost and outlined are transparent; only filled paints bg-surface. Depth selects the Layer tokens for the subtree and is inherited when omitted. Cards default to outlined.',
      render: VariantsDemo,
    },
    {
      id: 'document',
      title: 'Document preview',
      description:
        'An Item header, expandable preview, and metadata footer. Actions keep their native keyboard behavior.',
      render: DocumentDemo,
    },
    {
      id: 'composition',
      title: 'Different content, shared structure',
      description:
        'Media can lead or sit between sections. Every slot is optional; width and preview height belong to the composition.',
      render: CompositionDemo,
    },
  ],
});
