import type {
  SerializedEditorState,
  SerializedElementNode,
  SerializedLexicalNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import sharedDatabaseGrammar from '../../../crates/import_notion/fixtures/database_occurrences.md?raw';
import {
  notionMarkdownToLoroSnapshot,
  notionMarkdownToSerializedEditorState,
} from '../notion-markdown';

const LINKS = {
  pages: {
    '3fb607323e2e80629886fc0c028d50a7': {
      documentId: '0e5b6a2c-7c39-4a63-9a0c-5c1f2f6c0001',
      name: 'Roadmap',
    },
  },
  users: {
    '12345678123412341234123456789abc': {
      userId: 'macro|teo@acme.test',
      email: 'teo@acme.test',
    },
  },
};

type Node = SerializedLexicalNode & Record<string, unknown>;

function children(node: SerializedLexicalNode): Node[] {
  return 'children' in node
    ? (node as SerializedElementNode).children.map((child) => child as Node)
    : [];
}

function blocks(state: SerializedEditorState): Node[] {
  return children(state.root);
}

function text(node: SerializedLexicalNode): string {
  if (node.type === 'linebreak') return '\n';
  const own = 'text' in node && typeof node.text === 'string' ? node.text : '';
  return own + children(node).map(text).join('');
}

function convert(markdown: string): Node[] {
  return blocks(notionMarkdownToSerializedEditorState(markdown, LINKS));
}

it('uses the shared Rust fixture without drifting inline or self-closing ordinals', () => {
  const markdown = sharedDatabaseGrammar;
  const state = notionMarkdownToSerializedEditorState(markdown, {
    pages: {},
    users: {},
    databases: [0, 1, 2, 3, 4].map((ordinal) => ({
      containerId: 'd9824bdc84454327be8b5b47500af6ce',
      ordinal,
      target: {
        databaseId: 'database-1',
        tableId: 'table-1',
        viewId: `view-${ordinal}`,
      },
    })),
  });
  const cards = blocks(state).filter((node) => node.type === 'document-card');
  expect(cards.map((node) => node.documentName)).toEqual([
    'External tasks',
    'External tasks again',
    'Mid-line tasks',
    'Self-closing tasks',
    'Final tasks',
  ]);
  expect(cards.map((node) => node.blockParams)).toEqual(
    [0, 1, 2, 3, 4].map((ordinal) => ({
      tableId: 'table-1',
      viewId: `view-${ordinal}`,
    }))
  );
});

// Enhanced markdown fixture: Notion-Version 2026-03-11, documented at
// https://developers.notion.com/guides/data-apis/enhanced-markdown#page-and-database-references
// IDs are synthetic; replace/extend with captured workspace responses later.
it('places an imported database card between the surrounding page blocks', () => {
  const state = notionMarkdownToSerializedEditorState(
    'Before\n<database url="https://www.notion.so/11111111111141118111111111111111" inline="true">Tasks</database>\nAfter',
    {
      pages: {},
      users: {},
      databases: [
        {
          containerId: '11111111111141118111111111111111',
          ordinal: 0,
          target: {
            databaseId: 'database-1',
            tableId: 'table-1',
            viewId: 'view-1',
          },
        },
      ],
    }
  );
  expect(state.root.children.map((node) => node.type)).toEqual([
    'paragraph',
    'document-card',
    'paragraph',
  ]);
  expect(state.root.children[1]).toMatchObject({
    documentId: 'database-1',
    documentName: 'Tasks',
    blockName: 'database',
    blockParams: { tableId: 'table-1', viewId: 'view-1' },
  });
  expect(text(state.root.children[0])).toBe('Before');
  expect(text(state.root.children[2])).toBe('After');
});

it('keeps repeated linked placements on one database with distinct views through nested containers', () => {
  const state = notionMarkdownToSerializedEditorState(
    '<database url="https://www.notion.so/11111111-1111-4111-8111-111111111111" inline="true">First</database>\n<columns>\n<column>\n<database url="https://www.notion.so/11111111111141118111111111111111" inline="true">Second</database>\n</column>\n</columns>',
    {
      pages: {},
      users: {},
      databases: [
        {
          containerId: '11111111111141118111111111111111',
          ordinal: 0,
          target: { databaseId: 'db', tableId: 'table', viewId: 'first' },
        },
        {
          containerId: '11111111111141118111111111111111',
          ordinal: 1,
          target: { databaseId: 'db', tableId: 'table', viewId: 'second' },
        },
      ],
    }
  );
  expect(state.root.children).toHaveLength(2);
  expect(state.root.children[0]).toMatchObject({
    type: 'document-card',
    documentId: 'db',
    blockParams: { tableId: 'table', viewId: 'first' },
  });
  expect(state.root.children[1]).toMatchObject({
    type: 'document-card',
    documentId: 'db',
    blockParams: { tableId: 'table', viewId: 'second' },
  });
});

it('keeps named reason-specific links for failed placements even if the container is in the page map', () => {
  const state = notionMarkdownToSerializedEditorState(
    '<database url="https://www.notion.so/11111111111141118111111111111111" inline="true">Private tasks</database>\n<database url="https://www.notion.so/11111111111141118111111111111111" inline="true">Deleted tasks</database>\n<database url="https://www.notion.so/11111111111141118111111111111111" inline="true">Skipped tasks</database>',
    {
      pages: {
        '11111111111141118111111111111111': {
          documentId: 'page',
          name: 'Page',
        },
      },
      users: {},
      databases: [
        {
          containerId: '11111111111141118111111111111111',
          ordinal: 0,
          target: { reason: 'noAccess' },
        },
        {
          containerId: '11111111111141118111111111111111',
          ordinal: 1,
          target: { reason: 'notFound' },
        },
        {
          containerId: '11111111111141118111111111111111',
          ordinal: 2,
          target: { reason: 'notImported' },
        },
      ],
    }
  );
  expect(blocks(state).map(text)).toEqual([
    'Private tasks (no access)',
    'Deleted tasks (not found)',
    'Skipped tasks (not imported)',
  ]);
  for (const paragraph of state.root.children) {
    expect(children(paragraph)[0]).toMatchObject({
      type: 'link',
      url: 'https://www.notion.so/11111111111141118111111111111111',
    });
  }
});

it('does not count database markup in code as a placement and allows the default view', async () => {
  const markdown =
    '```html\n<database url="https://www.notion.so/11111111111141118111111111111111" inline="true">Example</database>\n```\n<database url="https://www.notion.so/11111111111141118111111111111111" inline="true">Tasks</database>';
  const links = {
    pages: {},
    users: {},
    databases: [
      {
        containerId: '11111111111141118111111111111111',
        ordinal: 0,
        target: { databaseId: 'db', tableId: 'table' },
      },
    ],
  };
  const state = notionMarkdownToSerializedEditorState(markdown, links);
  expect(state.root.children[0].type).toBe('custom-code');
  expect(state.root.children[1]).toMatchObject({
    type: 'document-card',
    documentId: 'db',
    blockParams: { tableId: 'table' },
  });
  const snapshot = await notionMarkdownToLoroSnapshot(markdown, links);
  expect(snapshot.snapshot.byteLength).toBeGreaterThan(0);
  expect(snapshot.markdown).toContain('<m-document-card>');
  expect(snapshot.markdown).toContain('"tableId":"table"');
});

it('uses the container path rather than a view query parameter to resolve a placement', () => {
  const state = notionMarkdownToSerializedEditorState(
    '<database url="https://www.notion.so/Tasks-11111111111141118111111111111111?v=22222222222242228222222222222222" inline="true">Tasks</database>',
    {
      pages: {},
      users: {},
      databases: [
        {
          containerId: '11111111111141118111111111111111',
          ordinal: 0,
          target: { databaseId: 'db', tableId: 'table' },
        },
      ],
    }
  );
  expect(state.root.children[0]).toMatchObject({
    type: 'document-card',
    documentId: 'db',
  });
});

describe('Notion markdown to Lexical', () => {
  it('turns a mapped page mention into a document mention', () => {
    const [paragraph] = convert(
      'See <mention-page url="https://www.notion.so/Roadmap-3fb607323e2e80629886fc0c028d50a7">Roadmap</mention-page>.'
    );
    expect(children(paragraph).map((node) => node.type)).toEqual([
      'text',
      'document-mention',
      'text',
    ]);
    expect(children(paragraph)[1]).toMatchObject({
      documentId: '0e5b6a2c-7c39-4a63-9a0c-5c1f2f6c0001',
      documentName: 'Roadmap',
      blockName: 'md',
    });
  });

  it('turns a child page placeholder into a document mention', () => {
    const [paragraph] = convert(
      '<page url="https://www.notion.so/3fb60732-3e2e-8062-9886-fc0c028d50a7">Roadmap</page>'
    );
    expect(children(paragraph).map((node) => node.type)).toEqual([
      'document-mention',
    ]);
  });

  it('links an unmapped page back to Notion', () => {
    const [paragraph] = convert(
      '<mention-page url="https://www.notion.so/1111111111111111111111111111aaaa">Elsewhere</mention-page>'
    );
    const [link] = children(paragraph);
    expect(link).toMatchObject({
      type: 'link',
      url: 'https://www.notion.so/1111111111111111111111111111aaaa',
    });
    expect(text(link)).toBe('Elsewhere');
  });

  it.each([
    'https://www.notion.so/Roadmap-3fb607323e2e80629886fc0c028d50a7',
    'https://notion.so/3fb60732-3e2e-8062-9886-fc0c028d50a7',
    'https://www.notion.so/?p=3fb607323e2e80629886fc0c028d50a7',
  ])(
    'rewrites an ordinary link to an exactly mapped Notion page (%s)',
    (url) => {
      const [paragraph] = convert(`[Quarterly plan](${url})`);
      const [link] = children(paragraph);
      expect(link.type).toBe('link');
      expect(link.url).toEqual(expect.any(String));
      expect(new URL(String(link.url), 'https://macro.com').pathname).toBe(
        '/app/md/0e5b6a2c-7c39-4a63-9a0c-5c1f2f6c0001'
      );
      expect(text(link)).toBe('Quarterly plan');
    }
  );

  it.each([
    'https://www.notion.so/Roadmap-3fb607323e2e80629886fc0c028d50a7#12345678123412341234123456789abc',
    'https://www.notion.so/Roadmap-3fb607323e2e80629886fc0c028d50a7?p=11111111111141118111111111111111',
    'https://www.notion.so/Roadmap-3fb607323e2e80629886fc0c028d50a7-extra',
    'https://www.notion.so.example.test/Roadmap-3fb607323e2e80629886fc0c028d50a7',
    'https://example.test/?p=3fb607323e2e80629886fc0c028d50a7',
    'https://www.notion.so/11111111111141118111111111111111',
  ])('keeps the original URL of an unverified Notion mention (%s)', (url) => {
    const [paragraph] = convert(
      `<mention-page url="${url}">Reference</mention-page>`
    );
    const [link] = children(paragraph);
    expect(link).toMatchObject({ type: 'link', url });
    expect(text(link)).toBe('Reference');
  });

  it('keeps an unverified database view link when its view ID matches a page mapping', () => {
    const url =
      'https://www.notion.so/Work-Board-11111111111141118111111111111111?v=3fb607323e2e80629886fc0c028d50a7';
    const [paragraph] = convert(
      `See <mention-database url="${url}">Work Board</mention-database>.`
    );
    expect(children(paragraph)[1]).toMatchObject({ type: 'link', url });
    expect(text(children(paragraph)[1])).toBe('Work Board');
  });

  it('leaves a mapped Notion link literal inside inline and fenced code', () => {
    const markdownLink =
      '[Roadmap](https://www.notion.so/3fb607323e2e80629886fc0c028d50a7)';
    const [paragraph, codeBlock] = convert(
      `\`${markdownLink}\`\n\n\`\`\`md\n${markdownLink}\n\`\`\``
    );
    const [inlineCode] = children(paragraph);
    expect(inlineCode).toMatchObject({ type: 'text', text: markdownLink });
    expect(codeBlock.type).toBe('custom-code');
    expect(text(codeBlock)).toBe(markdownLink);
  });

  it('turns a matched person into a user mention and anyone else into text', () => {
    const [paragraph] = convert(
      'Ask <mention-user url="user://12345678-1234-1234-1234-123456789abc">Teo Nys</mention-user> or <mention-user url="user://00000000-0000-0000-0000-000000000000">Ghost</mention-user>'
    );
    expect(children(paragraph).map((node) => node.type)).toEqual([
      'text',
      'user-mention',
      'text',
    ]);
    expect(children(paragraph)[1]).toMatchObject({
      userId: 'macro|teo@acme.test',
      email: 'teo@acme.test',
    });
    expect(text(paragraph)).toBe('Ask  or @Ghost');
  });

  it('turns dates and date ranges into date mentions', () => {
    const [single, range] = convert(
      'Starts <mention-date start="2024-04-01"/>\nRuns <mention-date start="2024-04-01" end="2024-04-05"/>'
    );
    expect(children(single)[1]).toMatchObject({
      type: 'date-mention',
      date: '2024-04-01T12:00:00.000Z',
      displayFormat: 'April 1, 2024',
    });
    expect(children(range).map((node) => node.type)).toEqual([
      'text',
      'date-mention',
      'text',
      'date-mention',
    ]);
  });

  it('places a timed date in its time zone', () => {
    const [paragraph] = convert(
      '<mention-date start="2024-07-01" startTime="09:30" timeZone="America/New_York"/>'
    );
    expect(children(paragraph)[0]).toMatchObject({
      type: 'date-mention',
      date: '2024-07-01T13:30:00.000Z',
    });
  });

  it('builds a Lexical table from a Notion table', () => {
    const [table] = convert(`<table fit-page-width="true" header-row="true">
<colgroup>
<col width="379">
<col color="gray">
</colgroup>
<tr>
<td>Editor</td>
<td>Pricing</td>
</tr>
<tr>
<td>Forma | Pro<br>second line</td>
</tr>
</table>`);
    expect(table.type).toBe('table');
    const rows = children(table);
    expect(rows.map((row) => children(row).length)).toEqual([2, 2]);
    expect(children(rows[0])[0]).toMatchObject({ headerState: 1 });
    expect(children(rows[1])[0]).toMatchObject({ headerState: 0 });
    expect(children(children(rows[1])[0]).map(text)).toEqual([
      'Forma | Pro',
      'second line',
    ]);
  });

  it('flattens toggles into their summary and content, with check lists', () => {
    const nodes = convert(`<details color="gray">
<summary>Coming in Q2</summary>
	- [ ] Open task
	- [x] Closed task
	Note under the toggle
</details>`);
    expect(nodes.map((node) => node.type)).toEqual([
      'paragraph',
      'task-list',
      'paragraph',
    ]);
    expect(text(nodes[0])).toBe('Coming in Q2');
    expect(children(nodes[1]).map((item) => item.checked)).toEqual([
      false,
      true,
    ]);
  });

  it('keeps nested toggles and their content in order', () => {
    const nodes = convert(`<details>
<summary>Outer</summary>
	<details>
	<summary>Inner</summary>
		Deep
	</details>
	After inner
</details>
After outer`);
    expect(nodes.map(text)).toEqual([
      'Outer',
      'Inner',
      'Deep',
      'After inner',
      'After outer',
    ]);
  });

  it('turns a callout into a quote led by its icon', () => {
    const [quote] = convert(`<callout icon="🔢" color="gray_bg">
	Numbers are estimates in **weeks**.
	Second line.
</callout>`);
    expect(quote.type).toBe('quote');
    expect(text(quote)).toBe(
      '🔢 Numbers are estimates in weeks.\nSecond line.'
    );
  });

  it('flattens columns into their content in reading order', () => {
    const nodes = convert(`<columns>
	<column>
		Left
	</column>
	<column>
		Right
	</column>
</columns>`);
    expect(nodes.map((node) => [node.type, text(node)])).toEqual([
      ['paragraph', 'Left'],
      ['paragraph', 'Right'],
    ]);
  });

  it('turns block and inline equations into equation nodes', () => {
    const [block, inline] = convert('$$E=mc^2$$\nInline $x^2$ math');
    expect(children(block)[0]).toMatchObject({
      type: 'equation',
      equation: 'E=mc^2',
      inline: false,
    });
    expect(children(inline)[1]).toMatchObject({
      type: 'equation',
      equation: 'x^2',
      inline: true,
    });
  });

  it('turns images into image nodes and other files into links', () => {
    const nodes = convert(`![Diagram](https://img.example/a.png)
<image src="https://img.example/b.png">Photo</image>
<file src="https://files.example/plan.docx">Plan.docx</file>
<video src="https://video.example/demo.mp4"></video>`);
    expect(nodes.map((node) => node.type)).toEqual([
      'image',
      'image',
      'paragraph',
      'paragraph',
    ]);
    expect(nodes[1]).toMatchObject({ url: 'https://img.example/b.png' });
    expect(children(nodes[2])[0]).toMatchObject({
      type: 'link',
      url: 'https://files.example/plan.docx',
    });
    expect(text(nodes[3])).toBe('demo.mp4');
  });

  it('resolves unknown blocks and databases to mentions when mapped, else readable links', () => {
    const nodes =
      convert(`<unknown url="https://www.notion.so/parent#3fb607323e2e80629886fc0c028d50a7" alt="child_page"/>
<unknown url="https://www.notion.so/9999999999999999999999999999aaaa" alt="Bookmark"/>
<unknown alt="embed"/>
<database url="https://www.notion.so/2222222222222222222222222222aaaa" inline="true">Bugs</database>`);
    expect(
      nodes.map((node) => children(node).map((child) => child.type))
    ).toEqual([['document-mention'], ['link'], [], ['link']]);
    expect(nodes.map(text)).toEqual([
      '',
      'Bookmark',
      '',
      'Bugs (unresolved database)',
    ]);
  });

  it('keeps span text, applies underline, and drops block attributes', () => {
    const [paragraph] = convert(
      '<span underline="true">Under</span> and <span color="red">red</span> text {color="blue"}'
    );
    expect(text(paragraph)).toBe('Under and red text');
    expect(children(paragraph)[0]).toMatchObject({ text: 'Under', format: 8 });
  });

  it('strips toggle markers from headings', () => {
    const [heading, child] = convert('# Plan {toggle="true"}\n\tChild text');
    expect(heading).toMatchObject({ type: 'heading', tag: 'h1' });
    expect(text(heading)).toBe('Plan');
    expect(text(child)).toBe('Child text');
  });

  it('keeps empty blocks, drops tables of contents and ancestor paths', () => {
    const nodes = convert(`<ancestor-path>
<ancestor-1-page url="https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" title="Parent"/>
</ancestor-path>
Before
<empty-block/>
<table_of_contents color="gray"/>
After`);
    expect(nodes.map((node) => [node.type, text(node)])).toEqual([
      ['paragraph', 'Before'],
      ['paragraph', ''],
      ['paragraph', 'After'],
    ]);
  });

  it('restores escaped to-dos but leaves code untouched', () => {
    const nodes = convert(
      '\\[x\\] Completed\n```text\n\\[x\\] example\n<page url="https://www.notion.so/x">literal</page>\n```'
    );
    expect(nodes[0].type).toBe('task-list');
    expect(children(nodes[0])[0]).toMatchObject({ checked: true });
    expect(nodes[1].type).toBe('custom-code');
    expect(text(nodes[1])).toBe(
      '\\[x\\] example\n<page url="https://www.notion.so/x">literal</page>'
    );
  });

  it('never leaves a Notion tag as text', () => {
    const nodes = convert(
      '<synced_block url="https://www.notion.so/s"><mention-database url="https://www.notion.so/d">Tasks</mention-database> <mention-agent url="agent://a">Bot</mention-agent> <custom-tag>kept</custom-tag></synced_block>'
    );
    expect(nodes.map(text)).toEqual([
      'Tasks @Bot <custom-tag>kept</custom-tag>',
    ]);
  });
});

describe('Notion markdown to a Loro snapshot', () => {
  it('returns the snapshot with its Macro markdown, mentions included', async () => {
    const result = await notionMarkdownToLoroSnapshot(
      'See <mention-page url="https://www.notion.so/3fb607323e2e80629886fc0c028d50a7">Roadmap</mention-page>',
      LINKS
    );
    expect(result.snapshot.byteLength).toBeGreaterThan(0);
    expect(result.markdown).toContain('<m-document-mention>');
    expect(result.markdown).toContain('0e5b6a2c-7c39-4a63-9a0c-5c1f2f6c0001');
  });
});
