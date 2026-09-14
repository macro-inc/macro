import { defineDoc } from '@app/features/ui-gallery/types';
import FilePdf from '@phosphor/file-pdf.svg';
import FileText from '@phosphor/file-text.svg';
import Heart from '@phosphor/heart.svg';
import { createSignal, For } from 'solid-js';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { Item } from './Item';

// #region demo:reference
function ReferenceDemo() {
  const [saved, setSaved] = createSignal(false);
  return (
    <Item variant="outlined" class="w-full max-w-sm">
      <Item.Media>
        <FilePdf aria-hidden="true" />
      </Item.Media>
      <Item.Content>
        <Item.Title>Design tokens</Item.Title>
        <Item.Description>Updated 2 hours ago</Item.Description>
      </Item.Content>
      <Item.Actions>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Favorite Design tokens"
          aria-pressed={saved()}
          onClick={() => setSaved(!saved())}
        >
          <Heart class={saved() ? 'fill-current text-accent' : ''} />
        </Button>
      </Item.Actions>
    </Item>
  );
}
// #endregion

// #region demo:rows
function RowsDemo() {
  const [saved, setSaved] = createSignal(false);
  return (
    <div class="w-full max-w-md divide-y divide-edge-muted">
      <Item>
        <Item.Media>
          <FileText aria-hidden="true" />
        </Item.Media>
        <Item.Content>
          <Item.Title>Notes for the next chapter</Item.Title>
          <Item.Description>
            A shared place for ideas that deserve a second look.
          </Item.Description>
          <Item.Metadata>
            <span>Document</span>
            <span>Updated today</span>
          </Item.Metadata>
        </Item.Content>
        <Item.Actions>
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={saved()}
            onClick={() => setSaved(!saved())}
          >
            {saved() ? 'Saved' : 'Save'}
          </Button>
        </Item.Actions>
      </Item>
      <Item>
        <Item.Media>
          <span
            class="flex size-8 items-center justify-center rounded-full bg-accent/10 text-xs font-medium text-accent"
            aria-hidden="true"
          >
            AM
          </span>
        </Item.Media>
        <Item.Content>
          <Item.Title>Alex Morgan</Item.Title>
          <Item.Description>Product designer</Item.Description>
        </Item.Content>
        <Item.Actions>
          <Badge size="sm" variant="outline">
            Member
          </Badge>
        </Item.Actions>
      </Item>
    </div>
  );
}
// #endregion

// #region demo:compact
function CompactDemo() {
  return (
    <Card class="w-full max-w-sm">
      <Card.Header>
        <Card.Title>Related reading</Card.Title>
        <Card.Description>The same row works inside a card.</Card.Description>
      </Card.Header>
      <Card.Body class="p-1">
        <Item size="sm">
          <Item.Media>
            <FileText aria-hidden="true" />
          </Item.Media>
          <Item.Content>
            <Item.Title>
              <a
                class="rounded-sm underline decoration-edge underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
                href="#reading-note"
              >
                A longer title stays readable even when space is limited
              </a>
            </Item.Title>
            <Item.Metadata>5 min read</Item.Metadata>
          </Item.Content>
        </Item>
      </Card.Body>
      <Card.Footer id="reading-note">
        <Card.Description>
          Use a real link for navigation. Adjacent actions remain independent.
        </Card.Description>
      </Card.Footer>
    </Card>
  );
}
// #endregion

// #region demo:variants
function VariantsDemo() {
  return (
    <div class="flex w-full max-w-md flex-col gap-3">
      <For each={['ghost', 'outlined', 'filled'] as const}>
        {(variant) => (
          <Item variant={variant} depth={2}>
            <Item.Media>
              <FileText aria-hidden="true" />
            </Item.Media>
            <Item.Content>
              <Item.Title>{variant}</Item.Title>
              <Item.Description>
                Depth 2 · the same content in every variant
              </Item.Description>
            </Item.Content>
          </Item>
        )}
      </For>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Item',
  category: 'Data Display',
  status: 'beta',
  exports: ['Item'],
  import: "import { Item } from '@ui';",
  description:
    'An identity row for rich cards and lists. Media, content, and actions share a flexible layout without requiring feature context.',
  demos: [
    {
      id: 'reference',
      title: 'Document reference',
      description:
        'A centered media tile, two-line identity, and an independent favorite action.',
      render: ReferenceDemo,
    },
    {
      id: 'variants',
      title: 'Variants and depth',
      description:
        'Items default to ghost. Outlined adds an edge; filled paints bg-surface using the selected depth. Omit depth to inherit the parent Layer.',
      render: VariantsDemo,
    },
    {
      id: 'rows',
      title: 'Rich rows',
      description:
        'Icons, avatars, metadata, badges, and stateful actions compose in the same slots.',
      render: RowsDemo,
    },
    {
      id: 'compact',
      title: 'Compact and nested',
      description:
        'Use small spacing for compact lists, or remove padding inside a Card.Header. Titles wrap instead of silently losing their label.',
      render: CompactDemo,
    },
  ],
});
