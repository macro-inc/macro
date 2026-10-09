import { describe, expect, it } from 'vitest';
import { createSdk } from './sdk';

describe('curated SDK', () => {
  it('renders Handlebars locally, escapes by default, and blocks prototype helpers', async () => {
    const sdk = createSdk(async () => {
      throw new Error('Unexpected remote call');
    });
    expect(
      sdk.templates.render('{{#each rows}}{{this}}{{/each}}', {
        rows: ['a', '<b>'],
      })
    ).toBe('a&lt;b&gt;');
    expect(
      sdk.templates.render('{{value}}', { value: '<b>' }, { escape: false })
    ).toBe('<b>');
    expect(() => sdk.templates.render('{{missing}}', {})).toThrow();
    expect(sdk.templates.render('{{constructor}}', {})).toBe('');
    expect(sdk.templates.render('{{value.toString}}', { value: {} })).toBe('');
    expect(Object.keys(sdk)).toEqual(['help', 'documents', 'ai', 'templates']);
    expect(await sdk.help('documents.editor')).toContain('appendParagraph');
  });

  it('uses the real editor and allows only one save per handle, even concurrently', async () => {
    const calls: { name: string; input: unknown }[] = [];
    const sdk = createSdk(async (name, input) => {
      calls.push({ name, input });
      if (name === 'ReadDocumentState')
        return {
          documentId: 'doc',
          revision: 'r1',
          nodeIds: ['p1'],
          xml: '<doc/>',
          state: {},
        };
      return { documentId: 'doc', revision: 'r2', applied: true };
    });
    const doc = await sdk.documents.open({ documentId: 'doc' });
    doc.editor.setText('p1', 'edited');
    const ref = doc.editor.appendParagraph('new');
    doc.editor.bold(ref, 'new');
    const results = await Promise.allSettled([doc.save(), doc.save()]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      name: 'ApplyDocumentOperations',
      input: {
        documentId: 'doc',
        expectedRevision: 'r1',
        operations: [
          { kind: 'setText', node: 'p1', text: 'edited' },
          { kind: 'insertNode', ref },
          { kind: 'formatText', node: ref },
        ],
      },
    });
  });

  it('explores real host schemas and supports concurrent AI calls', async () => {
    const names: string[] = [];
    const sdk = createSdk(async (name, input) => {
      names.push(name);
      return input;
    });
    expect(await sdk.help('tools')).toEqual({ names: [] });
    expect(await sdk.help('NameSearch')).toEqual({ names: ['NameSearch'] });
    await Promise.all([
      sdk.ai.generateText({ prompt: 'one' }),
      sdk.ai.generateObject({ prompt: 'two', schema: { type: 'string' } }),
    ]);
    expect(names).toEqual([
      'DescribeCodeSdk',
      'DescribeCodeSdk',
      'GenerateCodeText',
      'GenerateCodeObject',
    ]);
  });
});
