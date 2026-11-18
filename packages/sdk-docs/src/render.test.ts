import { readdir, readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

const output = new URL('../dist/docs/', import.meta.url);
const pages = new URL('markdown/', output);

test('the homepage explains entities and links to their reference without test modules', async () => {
  const html = await readFile(new URL('html/index.html', output), 'utf8');
  expect(html).toContain('Build with Macro');
  expect(html).toContain('Quick start');
  expect(html).toContain('Find the right entity');
  expect(html).toContain('Connected mailboxes');
  expect(html).not.toContain('{@link');
  const links = [
    ...html.matchAll(/href="(classes\/[^"#]+\.html)(?:#[^"]*)?"/g),
  ];
  expect(new Set(links.map((link) => link[1])).size).toBeGreaterThanOrEqual(24);
  for (const [, link] of links) {
    expect(await readFile(new URL(`html/${link}`, output), 'utf8')).toContain(
      '<html'
    );
  }
  const files = await readdir(pages, { recursive: true });
  expect(files.filter((file) => /\.(test|spec)(\/|\.)/.test(file))).toEqual([]);
});

test('agent routing and guidance never reach the public reference', async () => {
  const markdown = await readFile(
    new URL(
      'src/entities/databases/namespace/classes/DatabaseNamespace.md',
      pages
    ),
    'utf8'
  );
  expect(markdown).toContain('# Class: DatabaseNamespace');
  const html = await readFile(
    new URL(
      'html/classes/src_entities_databases_namespace.DatabaseNamespace.html',
      output
    ),
    'utf8'
  );
  for (const page of [markdown, html]) {
    expect(page).not.toContain('@agent');
    expect(page).not.toContain('@routing');
    expect(page).not.toContain('Use when working with a Macro database');
    expect(page).not.toContain("check every database's tables");
  }
});

test('public SDK pages preserve signatures and linked wire contracts in both formats', async () => {
  const markdown = await readFile(
    new URL(
      'src/entities/workspace/namespace/classes/WorkspaceNamespace.md',
      pages
    ),
    'utf8'
  );
  expect(markdown).toContain('# Class: WorkspaceNamespace');
  expect(markdown).toContain('page()');
  expect(markdown).toContain('list()');
  expect(markdown).toContain('WorkspacePageOptions');
  expect(markdown).not.toContain('property-client');
  expect(markdown).not.toContain('/home/');
  const wire = await readFile(
    new URL(
      'generated/storage/types.gen/type-aliases/ApiEntityFilterAst.md',
      pages
    ),
    'utf8'
  );
  expect(wire).toContain('ApiEntityFilterAst');
  const html = await readFile(
    new URL(
      'html/classes/src_entities_workspace_namespace.WorkspaceNamespace.html',
      output
    ),
    'utf8'
  );
  expect(html).toContain('WorkspacePageOptions');
  expect(html).toContain('list');
});

test('document content and AI contracts come from the SDK source', async () => {
  const document = await readFile(
    new URL('src/entities/documents/document/classes/Document.md', pages),
    'utf8'
  );
  expect(document).toContain('content()');
  expect(document).not.toContain('property-client');
  const ai = await readFile(
    new URL('src/entities/ai/namespace/classes/AiNamespace.md', pages),
    'utf8'
  );
  expect(ai).toContain('structuredCompletion');
  expect(ai).toContain('decide');
});

test('object aliases expose concrete fields while retaining linked types and descriptions', async () => {
  const patch = await readFile(
    new URL(
      'generated/agent-harness/types.gen/type-aliases/AgentSessionChangesPatchResponse.md',
      pages
    ),
    'utf8'
  );
  expect(patch).toMatch(/^> .*`patch`: `string`/m);
  expect(patch).not.toContain('= `object`');
  expect(patch).toContain(
    'The git-style unified diff of the current changeset.'
  );
  const request = await readFile(
    new URL(
      'generated/cognition/types.gen/type-aliases/StructuredCompletionRequest.md',
      pages
    ),
    'utf8'
  );
  expect(request).toMatch(/^> .*\[`DynamicSchema`\]\(DynamicSchema\.md\)/m);
  expect(request).toContain('## Properties');
});
