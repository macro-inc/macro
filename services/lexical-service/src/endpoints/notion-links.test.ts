import '../polyfills/prism';
import { expect, it } from 'bun:test';
import { LoroDoc } from 'loro-crdt';
import app from '../index';
import { notionLinkDelta } from './notion-links';

const documentId = '0e5b6a2c-7c39-4a63-9a0c-5c1f2f6c0001';
const databaseId = '0e5b6a2c-7c39-4a63-9a0c-5c1f2f6c0002';
const tableId = '0e5b6a2c-7c39-4a63-9a0c-5c1f2f6c0003';
const viewId = '0e5b6a2c-7c39-4a63-9a0c-5c1f2f6c0004';
const page = '3fb607323e2e80629886fc0c028d50a7';
const container = '11111111111141118111111111111111';
const view = '22222222222242228222222222222222';

function post(path: string, body: unknown, authenticated = true) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authenticated ? { 'x-internal-auth-key': 'test-key' } : {}),
      },
      body: JSON.stringify(body),
    },
    { INTERNAL_AUTH_KEY: 'test-key' }
  );
}

it('rewrites only exact hyperlink registers in a real Notion snapshot and replays as a no-op', async () => {
  const pageUrl = `https://www.notion.so/Start-Here-${page}`;
  const viewUrl = `https://www.notion.so/${container}?v=${view}`;
  const blockUrl = `${pageUrl}#${view}`;
  const response = await post('/snapshot/notion', {
    markdown: [
      `[**Start Here**](${pageUrl})`,
      `<mention-database url="${viewUrl}">Work Board</mention-database>`,
      `[Original block](${blockUrl})`,
      `\`[Example](${pageUrl})\``,
      `[Outside](https://example.test/${page})`,
    ].join('\n\n'),
    links: { pages: {}, users: {} },
  });
  expect(response.status).toBe(200);
  const { snapshot } = (await response.json()) as { snapshot: string };
  const bytes = Buffer.from(snapshot, 'base64');
  const replacements = [
    { id: page, destination: { type: 'page', documentId } },
    {
      id: container,
      viewId: view,
      destination: { type: 'database', databaseId, tableId, viewId },
    },
  ] as const;

  const inspected = notionLinkDelta(bytes, []);
  expect(inspected.references).toEqual([
    { id: page },
    { id: container, viewId: view },
  ]);
  expect(inspected.update).toBeUndefined();

  expect(
    (await post('/snapshot/notion-links', { snapshot, replacements }, false))
      .status
  ).toBe(401);
  const patchResponse = await post('/snapshot/notion-links', {
    snapshot,
    replacements,
  });
  expect(patchResponse.status).toBe(200);
  const patch = (await patchResponse.json()) as {
    rewritten: number;
    update: string;
    revision: string;
  };
  expect(patch.revision).toBe(inspected.revision);
  expect(patch.rewritten).toBe(2);

  const result = new LoroDoc();
  result.import(bytes);
  result.import(Buffer.from(patch.update, 'base64'));
  const json = JSON.stringify(result.toJSON());
  expect(json).toContain(`/app/md/${documentId}`);
  expect(json).toContain(
    `/app/database/${databaseId}?tableId=${tableId}&viewId=${viewId}`
  );
  expect(json).toContain(blockUrl);
  expect(json).toContain(`[Example](${pageUrl})`);
  expect(json).toContain(`https://example.test/${page}`);
  expect(
    notionLinkDelta(result.export({ mode: 'snapshot' }), [...replacements])
      .rewritten
  ).toBe(0);
  result.free();
});
