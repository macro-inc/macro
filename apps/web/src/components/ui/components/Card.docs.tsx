import { defineDoc } from '@app/features/ui-gallery/types';
import FileText from '@phosphor/file-text.svg';
import Terminal from '@phosphor/terminal.svg';
import { createSignal, For, Show } from 'solid-js';
import { Button } from './Button';
import { Card } from './Card';
import { Item } from './Item';

// #region demo:canonical
function CanonicalDemo() {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <Card class="w-full max-w-md">
      <Card.Header>
        <Item class="items-start gap-2 border-0 p-0">
          <Card.Icon aria-hidden="true">
            <FileText />
          </Card.Icon>
          <Item.Content>
            <Card.Title>Making room for good work</Card.Title>
            <Card.Description>
              A working note on focus, rhythm, and collaboration.
            </Card.Description>
            <Card.Metadata class="gap-x-1.5 pt-1">
              <span>Alex Morgan</span>
              <span aria-hidden="true">·</span>
              <span>Edited 2h ago</span>
            </Card.Metadata>
          </Item.Content>
        </Item>
      </Card.Header>
      <Card.Body class="pt-2">
        <p>
          Protect a little time for thinking. Share the rough draft early, and
          leave enough context for someone else to pick up the thread.
        </p>
        <Show when={expanded()}>
          <p class="mt-3">
            Start with one clear question. Gather a few references, record the
            decisions, and finish with a next step that someone can own.
          </p>
        </Show>
      </Card.Body>
      <Card.Footer>
        <Card.Metadata>4 min read</Card.Metadata>
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

// #region demo:setup
function SetupDemo() {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <Card class="w-full max-w-md">
      <Card.Header>
        <Item class="items-start gap-2 border-0 p-0">
          <Card.Icon aria-hidden="true">
            <Terminal />
          </Card.Icon>
          <Item.Content>
            <Card.Title>Connect your editor</Card.Title>
            <Card.Description>Add Macro as a context source.</Card.Description>
            <Card.Metadata>Setup guide · Example configuration</Card.Metadata>
          </Item.Content>
        </Item>
      </Card.Header>
      <Show when={expanded()}>
        <Card.Body class="pt-0">
          <Card variant="filled" offset={1}>
            <Card.Body>
              <pre class="whitespace-pre-wrap break-all text-xs">
                <code>
                  {
                    '{\n  "mcpServers": {\n    "example": { "url": "https://example.com/mcp" }\n  }\n}'
                  }
                </code>
              </pre>
            </Card.Body>
          </Card>
        </Card.Body>
      </Show>
      <Card.Footer>
        <Card.Metadata>No connection is made in this demo.</Card.Metadata>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={expanded()}
          onClick={() => setExpanded(!expanded())}
        >
          {expanded() ? 'Hide configuration' : 'Show configuration'}
        </Button>
      </Card.Footer>
    </Card>
  );
}
// #endregion

// #region demo:tool-result
function ToolResultDemo() {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <Card class="w-full max-w-md">
      <Card.Header>
        <Item class="items-start gap-2 border-0 p-0">
          <Card.Icon aria-hidden="true">
            <Terminal />
          </Card.Icon>
          <Item.Content>
            <Card.Title>Search complete</Card.Title>
            <Card.Description>
              Found references to the reading room project.
            </Card.Description>
            <Card.Metadata>3 results · 0.8 seconds</Card.Metadata>
          </Item.Content>
        </Item>
      </Card.Header>
      <Show when={expanded()}>
        <Card.Body class="pt-0">
          <Card variant="filled" offset={1}>
            <Card.Body class="p-1">
              <For
                each={[
                  'Reading room brief',
                  'Material references',
                  'First proposal',
                ]}
              >
                {(name) => (
                  <Item size="sm" class="gap-2">
                    <Item.Icon aria-hidden="true">
                      <FileText />
                    </Item.Icon>
                    <Item.Content>
                      <Item.Title>{name}</Item.Title>
                      <Item.Metadata>Document · Design</Item.Metadata>
                    </Item.Content>
                  </Item>
                )}
              </For>
            </Card.Body>
          </Card>
        </Card.Body>
      </Show>
      <Card.Footer>
        <Card.Metadata>Read-only result</Card.Metadata>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={expanded()}
          onClick={() => setExpanded(!expanded())}
        >
          {expanded() ? 'Hide results' : 'Show results'}
        </Button>
      </Card.Footer>
    </Card>
  );
}
// #endregion

// #region demo:attachments
function AttachmentsDemo() {
  const [showAll, setShowAll] = createSignal(false);
  const files = [
    { name: 'Reading room brief.pdf', detail: 'Alex Morgan · 2.4 MB' },
    {
      name: 'Material and finish specifications.pdf',
      detail: 'Seamus · 6.1 MB',
    },
    { name: 'Installation notes.pdf', detail: 'Alex Morgan · 840 KB' },
  ];
  return (
    <Card class="w-full max-w-md">
      <Card.Header>
        <Card.Title>Shared in Design</Card.Title>
        <Card.Description>
          Files from the project conversation.
        </Card.Description>
      </Card.Header>
      <Card.Body class="pt-0">
        <div class="divide-y divide-edge-muted">
          <For each={showAll() ? files : files.slice(0, 2)}>
            {(file) => (
              <Item size="sm" class="items-start gap-2 px-0">
                <Item.Icon aria-hidden="true">
                  <FileText />
                </Item.Icon>
                <Item.Content>
                  <Item.Title>{file.name}</Item.Title>
                  <Item.Metadata>{file.detail}</Item.Metadata>
                </Item.Content>
              </Item>
            )}
          </For>
        </div>
      </Card.Body>
      <Card.Footer>
        <Card.Metadata>3 attachments</Card.Metadata>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={showAll()}
          onClick={() => setShowAll(!showAll())}
        >
          {showAll() ? 'Show fewer' : 'Show all'}
        </Button>
      </Card.Footer>
    </Card>
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
    'A canonical rich-content card: identity in Header, readable content in Body, and supporting details and actions in Footer. Title, Description, Metadata, and Icon share Item primitives: semibold text-sm titles, regular text-sm descriptions, and medium-weight text-xs details. Cards default to outlined; use filled for a surface background or ghost for no frame. Depth and offset inherit the Layer model.',
  demos: [
    {
      id: 'canonical',
      title: 'Card',
      description:
        'Compose only the slots you need. This example uses a plain first-line icon, a clear title/description/details hierarchy, body content, and an expandable reading action.',
      render: CanonicalDemo,
    },
    {
      id: 'setup',
      title: 'Integration setup',
      description:
        'Inspired by McpSetupCards: a setup summary, expandable configuration, and a separate action footer. Sample data only.',
      render: SetupDemo,
    },
    {
      id: 'tool-result',
      title: 'Tool result',
      description:
        'Inspired by ToolCard: a result summary with optional output. The feature still owns streaming status and disclosure behavior.',
      render: ToolResultDemo,
    },
    {
      id: 'attachments',
      title: 'Conversation attachments',
      description:
        'Inspired by AttachmentEntityRow: a Card groups compact Item rows. A production migration would retain Entity navigation and permissions.',
      render: AttachmentsDemo,
    },
  ],
});
