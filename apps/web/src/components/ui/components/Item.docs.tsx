import { defineDoc } from '@app/features/ui-gallery/types';
import CheckCircle from '@phosphor/check-circle.svg';
import Circle from '@phosphor/circle.svg';
import FilePdf from '@phosphor/file-pdf.svg';
import FileText from '@phosphor/file-text.svg';
import Heart from '@phosphor/heart.svg';
import { createSignal, For, Show } from 'solid-js';
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

// #region demo:inline-icon
function InlineIconDemo() {
  return (
    <Item variant="outlined" class="w-full max-w-sm items-start gap-2">
      <Item.Icon aria-hidden="true">
        <FileText />
      </Item.Icon>
      <Item.Content>
        <Item.Title>
          A longer document title that wraps onto another line
        </Item.Title>
        <Item.Description>Alex Morgan - Updated today</Item.Description>
      </Item.Content>
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

// #region demo:wrapping
function WrappingDemo() {
  return (
    <div class="grid w-full gap-3 sm:grid-cols-2">
      <For
        each={[
          'Design tokens',
          'Design tokens for a quieter workspace, from the first draft to the final details',
        ]}
      >
        {(title) => (
          <Item variant="outlined" class="items-start gap-2">
            <Item.Icon aria-hidden="true">
              <FileText />
            </Item.Icon>
            <Item.Content>
              <Item.Title>{title}</Item.Title>
              <Item.Description>Alex Morgan - Edited 2h ago</Item.Description>
            </Item.Content>
          </Item>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:task
function TaskDemo() {
  const [completed, setCompleted] = createSignal(false);
  return (
    <Item variant="outlined" class="w-full max-w-md items-start gap-2">
      <Item.Icon>
        <Button
          size="icon-sm"
          variant="ghost"
          class="shrink-0 rounded-full text-task"
          aria-label="Complete review task"
          aria-pressed={completed()}
          onClick={() => setCompleted(!completed())}
        >
          <Show when={completed()} fallback={<Circle class="size-4" />}>
            <CheckCircle class="size-4" />
          </Show>
        </Button>
      </Item.Icon>
      <Item.Content>
        <Item.Title>Review the reading room proposal</Item.Title>
        <Item.Description>Seamus - Today</Item.Description>
        <Item.Metadata class="pt-2" aria-live="polite">
          <Badge size="sm" variant="outline">
            {completed() ? 'Completed' : 'Not started'}
          </Badge>
          <Badge size="sm" variant="outline">
            Medium priority
          </Badge>
          <span>Alex + 2 others</span>
        </Item.Metadata>
      </Item.Content>
    </Item>
  );
}
// #endregion

// #region demo:text-only
function TextOnlyDemo() {
  const [following, setFollowing] = createSignal(false);
  return (
    <Item variant="filled" depth={2} class="w-full max-w-md items-start">
      <Item.Content>
        <Item.Title>Design updates</Item.Title>
        <Item.Description>
          Decisions, drafts, and progress from the team.
        </Item.Description>
        <Item.Metadata class="gap-x-1.5 pt-1">
          <span>12 members</span>
          <span aria-hidden="true">·</span>
          <span>3 unread</span>
        </Item.Metadata>
      </Item.Content>
      <Item.Actions class="h-5">
        <Button
          size="sm"
          variant="outline"
          aria-pressed={following()}
          onClick={() => setFollowing(!following())}
        >
          {following() ? 'Following' : 'Follow'}
        </Button>
      </Item.Actions>
    </Item>
  );
}
// #endregion

// #region demo:attachments
function AttachmentsDemo() {
  return (
    <div class="w-full max-w-md divide-y divide-edge-muted">
      <For
        each={[
          { title: 'Reading room brief.pdf', detail: 'PDF · 8 pages · 2.4 MB' },
          {
            title: 'Material and finish specifications.pdf',
            detail: 'PDF · 24 pages · 6.1 MB',
          },
        ]}
      >
        {(file) => (
          <Item size="sm" class="items-start gap-2">
            <Item.Icon aria-hidden="true">
              <FilePdf />
            </Item.Icon>
            <Item.Content>
              <Item.Title>{file.title}</Item.Title>
              <Item.Description>{file.detail}</Item.Description>
            </Item.Content>
            <Item.Actions class="h-5">
              <Badge size="sm" variant="outline">
                PDF
              </Badge>
            </Item.Actions>
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
    'An identity row for rich cards and lists. Titles and descriptions use text-sm with 20px leading: semibold titles and regular descriptions in ink-muted. Metadata uses medium text-xs with 16px leading in ink-subtle. Content keeps a 4px gap even when titles wrap. Icon is a plain inline-flex slot aligned with the first title line; Media is a larger tile.',
  demos: [
    {
      id: 'wrapping',
      title: 'Short and wrapped titles',
      description:
        'Compare the same first-line alignment and byline gap across different title lengths.',
      render: WrappingDemo,
    },
    {
      id: 'task',
      title: 'Interactive task status',
      description:
        'The Icon slot can contain a real button. Toggle completion to try it; metadata stays aligned with the title.',
      render: TaskDemo,
    },
    {
      id: 'text-only',
      title: 'Text-only with an action',
      description:
        'Icons and media are optional. A follow button and metadata make a useful row on their own.',
      render: TextOnlyDemo,
    },
    {
      id: 'attachments',
      title: 'Compact attachments',
      description:
        'Small rows with plain file icons, wrapping filenames, and file facts.',
      render: AttachmentsDemo,
    },
    {
      id: 'inline-icon',
      title: 'First-line icon',
      description:
        'Item.Icon stays aligned with the first title line, independently of wrapping and secondary content.',
      render: InlineIconDemo,
    },
    {
      id: 'reference',
      title: 'Document reference',
      description:
        'A top-aligned media tile, two-line identity, and an independent favorite action. Use self-center on Media when centered alignment is preferred.',
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
