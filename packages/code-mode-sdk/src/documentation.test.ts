import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { packageEntityDocs } from '../scripts/typedoc';

const artifact = new URL(
  '../../../crates/agent_code_mode/src/domain/documentation.json',
  import.meta.url
);

function fixturePages() {
  return new Map([
    [
      'src/entities/example/namespace/classes/ExampleNamespace.md',
      '# ExampleNamespace\n[next](../../../../../generated/example/types.gen/type-aliases/Request.md)',
    ],
    [
      'generated/example/types.gen/type-aliases/Request.md',
      '# Request\n[child](Child.md)',
    ],
    [
      'generated/example/types.gen/type-aliases/Child.md',
      '# Child\n[cycle](Request.md)',
    ],
    ['src/macro/classes/Macro.md', '# Macro'],
  ]);
}

describe('TypeDoc documentation packaging', () => {
  it('retains transitive and cyclic wire references without rewriting Markdown', () => {
    const pages = fixturePages();
    const [entity] = packageEntityDocs(pages, { example: 'An example.' });
    expect(entity?.documentation).toContain('# Request\n[child](Child.md)');
    expect(entity?.documentation.match(/# Child/g)).toHaveLength(1);
    expect(entity?.overview).toContain('# ExampleNamespace');
    expect(entity?.overview).not.toContain('# Child');
  });

  it('fails generation on a missing referenced contract or missing namespace', () => {
    const pages = fixturePages();
    pages.delete('generated/example/types.gen/type-aliases/Child.md');
    expect(() => packageEntityDocs(pages, { example: 'An example.' })).toThrow(
      'Broken TypeDoc link'
    );
    expect(() =>
      packageEntityDocs(new Map(), { example: 'An example.' })
    ).toThrow('no pages');
  });

  it('includes namespace option types and their local enum dependencies in compact docs', () => {
    const pages = fixturePages();
    pages.set(
      'src/entities/example/namespace/classes/ExampleNamespace.md',
      '# ExampleNamespace\n[Options](../../types/type-aliases/Options.md)'
    );
    pages.set(
      'src/entities/example/types/type-aliases/Options.md',
      '# Options\n[Kind](Kind.md) [Entity](../../entity/classes/Entity.md)'
    );
    pages.set(
      'src/entities/example/types/type-aliases/Kind.md',
      '# Kind\n"calendar_event" | "ai_chat"\n[Options](Options.md)'
    );
    pages.set('src/entities/example/entity/classes/Entity.md', '# Entity');
    const [entity] = packageEntityDocs(pages, { example: 'An example.' });
    expect(entity?.overview).toContain('# Options');
    expect(entity?.overview).toContain('"calendar_event" | "ai_chat"');
    expect(entity?.overview?.match(/# Options/g)).toHaveLength(1);
    expect(entity?.overview).not.toContain('# Entity');
  });

  it('documents real public review handles and full wire fields without private members', async () => {
    const docs = JSON.parse(await readFile(artifact, 'utf8')) as Array<{
      name: string;
      documentation: string;
      overview: string;
    }>;
    const reviews = docs.find((doc) => doc.name === 'agentSessions');
    if (!reviews) throw new Error('Missing agentSessions docs');
    expect(reviews.documentation).toContain('# Class: SessionReview');
    const canonical = await readFile(
      new URL(
        '../../sdk-docs/dist/docs/markdown/src/entities/agent-sessions/review/classes/SessionReview.md',
        import.meta.url
      ),
      'utf8'
    );
    expect(reviews.documentation).toContain(canonical);
    const html = await readFile(
      new URL(
        '../../sdk-docs/dist/docs/html/classes/src_entities_agent-sessions_review.SessionReview.html',
        import.meta.url
      ),
      'utf8'
    );
    expect(html).toContain('submitAll');
    expect(html).toContain('ReviewRecord');

    expect(reviews.documentation).toContain('submitAll');
    expect(reviews.documentation).toContain('presentedAt');
    expect(reviews.documentation).toContain('executionId');
    expect(reviews.documentation).not.toContain('property-parent');
    expect(reviews.documentation).not.toContain('property-client');
    expect(reviews.documentation).not.toContain('private constructor');
    expect(docs.find((doc) => doc.name === 'ai')?.documentation).toContain(
      'output_schema'
    );
    expect(
      docs.find((doc) => doc.name === 'documents')?.documentation
    ).toContain('content()');
    const workspace = docs.find((doc) => doc.name === 'workspace');
    expect(workspace?.documentation).toContain('WorkspaceNamespace');
    expect(workspace?.documentation).toContain('WorkspacePageOptions');
    expect(workspace?.documentation).toContain('ApiEntityFilterAst');
    expect(workspace?.overview).toContain('page()');
    expect(workspace?.overview).toContain('list()');
    expect(workspace?.overview).toContain('# Type Alias: WorkspaceType');
    expect(workspace?.overview).toContain('calendar_event');
    expect(workspace?.overview).toContain('ai_chat');
    for (const doc of docs) {
      expect(doc.overview.length).toBeGreaterThan(0);
      expect(Buffer.byteLength(doc.overview)).toBeLessThan(16 * 1024);
      expect(doc.documentation).not.toContain('/home/wolf/');
    }
  });
});
