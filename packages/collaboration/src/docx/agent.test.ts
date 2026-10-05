import { LoroDoc } from 'loro-crdt';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import {
  applyDocxOperations,
  DocxAgentError,
  type DocxAgentOperation,
  type DocxAgentSource,
  describeDocx,
  runDocxAgentRequest,
} from './agent';
import { blockContaining, fixtureState } from './fixtures/load';
import { type Names, paragraphText } from './paragraph';
import { readDocxState, seedDocxState } from './schema';
import { parseElement } from './xml';

const names: Names = { w: 'w', pt: 'p18' };
const nda = () => fixtureState('mutual-nda');
const id = (text: string) => blockContaining('mutual-nda', text).id;

/** Plain text of every top-level paragraph, in order. */
const texts = (state: ReturnType<typeof nda>) =>
  state.order.flatMap((block) => {
    const root = parseElement(state.blocks.get(block) ?? '');
    return root.name === 'w:p' ? [paragraphText(root, names)] : [];
  });

const apply = (operations: DocxAgentOperation[]) =>
  applyDocxOperations(nda(), operations);

describe('describeDocx', () => {
  it('lists every block with its id, style and text', () => {
    const text = describeDocx(nda());
    expect(text).toContain('Word document with 17 blocks.');
    expect(text).toContain(
      `#1 paragraph ${id('MUTUAL NON-DISCLOSURE')} (Title, center)\n  MUTUAL NON-DISCLOSURE AGREEMENT`
    );
    expect(text).toContain('  bold: "Agreement"');
    expect(text).toMatch(
      /paragraph \w+ \(ListNumber\)\n {2}Each party shall use/
    );
    expect(text).toMatch(
      /Paragraph styles: Heading1, Title, ListNumber, Normal,/
    );
  });

  it('lists table cells and content controls with their paragraphs', () => {
    const text = describeDocx(fixtureState('complex-msa'));
    expect(text).toMatch(/#\d+ table \w{32}, \d+ rows x 2 columns/);
    expect(text).toMatch(/ {2}row 1, cell 1:\n {4}paragraph \w{32}/);
    expect(text).toMatch(/content control \w{32} \(Table of Contents\)/);
    expect(text).toContain('  bold: "net thirty (30) days"');
    expect(text).toContain('  italic: "net thirty (30) days"');
  });

  it('pages through long documents', () => {
    const text = describeDocx(nda(), { start: 3, count: 2 });
    expect(text).toContain('showing #3-#4');
    expect(text).toContain('#3 paragraph');
    expect(text).not.toContain('#5 paragraph');
  });
});

describe('applyDocxOperations', () => {
  it('replaces text and reports the changed block', () => {
    const term = id('This Agreement shall remain');
    const result = apply([
      {
        type: 'replaceText',
        paragraph: term,
        find: 'two (2) years',
        replace: 'three (3) years',
      },
    ]);
    expect(texts(result.state).join('\n')).toContain(
      'for a period of three (3) years'
    );
    expect(result.touched).toEqual([term]);
    // Untouched blocks keep their exact XML.
    const first = nda().order[0];
    expect(result.state.blocks.get(first)).toBe(nda().blocks.get(first));
  });

  it('asks for an occurrence when the text repeats, and explains a miss', () => {
    const paragraph = id('"Confidential Information" means');
    expect(() =>
      apply([
        { type: 'replaceText', paragraph, find: 'confidential', replace: 'x' },
      ])
    ).toThrow(/appears 2 times .* pass occurrence \(1-2\)/);
    const second = apply([
      {
        type: 'replaceText',
        paragraph,
        find: 'confidential',
        replace: 'secret',
        occurrence: 2,
      },
    ]);
    expect(texts(second.state).join('\n')).toContain(
      'understood to be secret given'
    );
    expect(() =>
      apply([{ type: 'replaceText', paragraph, find: 'zebra', replace: 'x' }])
    ).toThrow(
      /does not appear in paragraph \w+, whose text is: ""Confidential/
    );
  });

  it('inserts body text after a heading and list items after a list item', () => {
    const heading = id('1. Definitions');
    const item = id('Each party shall use');
    const result = apply([
      {
        type: 'insertParagraph',
        after: heading,
        text: 'Intro one.\nIntro two.',
      },
      {
        type: 'insertParagraph',
        after: item,
        text: 'Each party shall comply.',
      },
    ]);
    const all = texts(result.state);
    const at = all.indexOf('1. Definitions');
    expect(all.slice(at, at + 3)).toEqual([
      '1. Definitions',
      'Intro one.',
      'Intro two.',
    ]);
    const intro = result.state.order[result.state.order.indexOf(heading) + 1];
    // Heading 1 is followed by Normal, the default: no style of its own.
    expect(result.state.blocks.get(intro)).not.toContain('pStyle');
    const added = result.state.order[result.state.order.indexOf(item) + 1];
    expect(result.state.blocks.get(added)).toContain('w:val="ListNumber"');
    expect(result.state.blocks.get(added)).toContain(
      'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    );
    expect(result.touched).toEqual([intro, expect.any(String), added]);
    expect(result.state.order).toHaveLength(nda().order.length + 3);
  });

  it('edits and inserts paragraphs inside table cells', () => {
    const state = fixtureState('complex-msa');
    const table = state.order.find((block) =>
      state.blocks.get(block)?.startsWith('<w:tbl')
    )!;
    const cell = /<w:tc [^>]*>.*?<w:p [^>]*p18:Unid="(\w+)"/.exec(
      state.blocks.get(table)!
    )![1];
    const result = applyDocxOperations(state, [
      { type: 'setText', paragraph: cell, text: 'Phase' },
      { type: 'insertParagraph', after: cell, text: 'Second line' },
    ]);
    const xml = result.state.blocks.get(table)!;
    expect(xml).toContain('>Phase</w:t>');
    expect(xml).toContain('>Second line</w:t>');
    expect(result.touched).toEqual([table]);
    expect(() =>
      applyDocxOperations(state, [{ type: 'delete', id: cell }])
    ).toThrow(/only paragraph in its table cell/);
  });

  it('deletes blocks and refuses to address a table as a paragraph', () => {
    const item = id('Each party shall use');
    const result = apply([{ type: 'delete', id: item }]);
    expect(result.state.order).not.toContain(item);
    expect(result.deleted).toEqual([item]);
    const state = fixtureState('complex-msa');
    const table = state.order.find((block) =>
      state.blocks.get(block)?.startsWith('<w:tbl')
    )!;
    expect(() =>
      applyDocxOperations(state, [
        { type: 'setText', paragraph: table, text: 'x' },
      ])
    ).toThrow(/is a table, not a paragraph/);
  });

  it('resolves styles by id or name and lists them when unknown', () => {
    const paragraph = id('"Confidential Information" means');
    for (const style of ['Heading2', 'heading 2', 'Heading 2'])
      expect(
        apply([{ type: 'setStyle', paragraph, style }]).state.blocks.get(
          paragraph
        )
      ).toContain('<w:pStyle w:val="Heading2"');
    expect(() =>
      apply([{ type: 'setStyle', paragraph, style: 'Fancy' }])
    ).toThrow(/no paragraph style "Fancy". Its paragraph styles are: Normal, /);
  });

  it('applies formatting to found text', () => {
    const paragraph = id('"Confidential Information" means');
    const result = apply([
      {
        type: 'formatText',
        paragraph,
        find: 'Confidential Information',
        bold: true,
      },
    ]);
    expect(describeDocx(result.state)).toContain(
      '  bold: "Confidential Information"'
    );
  });

  it('is atomic and names the operation that failed', () => {
    const term = id('This Agreement shall remain');
    expect(() =>
      apply([
        { type: 'replaceText', paragraph: term, find: 'two', replace: 'three' },
        { type: 'delete', id: 'missing' },
      ])
    ).toThrow(
      /^Operation 2 \(delete\) failed, so nothing was changed: No paragraph or block has id missing/
    );
    expect(() =>
      apply([{ type: 'setText', paragraph: term, text: 'one\ntwo' }])
    ).toThrow(/use insertParagraph/);
    expect(() => apply([])).toThrow(DocxAgentError);
  });
});

/** A seeded document behind a fake sync source that records pushes. */
function session(seeded = true) {
  const server = new LoroDoc();
  if (seeded) seedDocxState(server, nda());
  const pushed: Uint8Array[] = [];
  const source: DocxAgentSource = {
    doInitialSync: () =>
      okAsync({
        snapshot: server.export({ mode: 'snapshot' }),
        awareness: new Uint8Array(),
      }),
    pushUpdate: vi.fn(async (updates: Uint8Array[]) => {
      pushed.push(...updates);
      return true;
    }),
    registerPeerId: vi.fn(),
  };
  return { server, pushed, source };
}

describe('runDocxAgentRequest', () => {
  it('reads the live document', async () => {
    const { source } = session();
    const { content } = await runDocxAgentRequest(source, { action: 'read' });
    expect(content).toContain('MUTUAL NON-DISCLOSURE AGREEMENT');
  });

  it('pushes an edit other peers merge', async () => {
    const { server, pushed, source } = session();
    const term = id('This Agreement shall remain');
    const { content } = await runDocxAgentRequest(source, {
      action: 'edit',
      operations: [
        {
          type: 'replaceText',
          paragraph: term,
          find: 'two (2) years',
          replace: 'three (3) years',
        },
      ],
    });
    expect(content).toContain('Applied 1 operation.');
    expect(content).toContain('three (3) years');
    expect(source.registerPeerId).toHaveBeenCalled();
    expect(pushed).toHaveLength(1);
    server.import(pushed[0]);
    expect(texts(readDocxState(server)).join('\n')).toContain(
      'three (3) years'
    );
  });

  it('refuses a document nobody has opened yet', async () => {
    const { source } = session(false);
    await expect(
      runDocxAgentRequest(source, { action: 'read' })
    ).rejects.toThrow(/hasn't been opened in Macro's editor yet/);
  });

  it('fails when the sync service never acknowledges the edit', async () => {
    const { source } = session();
    source.pushUpdate = async () => false;
    await expect(
      runDocxAgentRequest(source, {
        action: 'edit',
        operations: [
          {
            type: 'setStyle',
            paragraph: id('1. Definitions'),
            style: 'Heading2',
          },
        ],
      })
    ).rejects.toThrow(/did not acknowledge/);
  });

  it('reports a failed initial sync', async () => {
    const { source } = session();
    source.doInitialSync = () => errAsync({ type: 'timeout', duration: 5 });
    await expect(
      runDocxAgentRequest(source, { action: 'read' })
    ).rejects.toThrow(/initial sync failed: timeout/);
  });
});
