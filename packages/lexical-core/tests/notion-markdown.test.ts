import type {
  SerializedEditorState,
  SerializedElementNode,
  SerializedLexicalNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';
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
    expect(nodes.map(text)).toEqual(['', 'Bookmark', '', 'Bugs']);
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
