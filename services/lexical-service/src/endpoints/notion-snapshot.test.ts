import '../polyfills/prism';
import { describe, expect, it } from 'bun:test';
import { LoroDoc } from 'loro-crdt';
import app from '../index';

const request = (body: unknown, authenticated = true) =>
  app.request(
    '/snapshot/notion',
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

const page = {
  markdown:
    '# Launch\nOwned by <mention-user url="user://12345678-1234-1234-1234-123456789abc">Teo</mention-user>, see <mention-page url="https://www.notion.so/Spec-3fb607323e2e80629886fc0c028d50a7">Spec</mention-page>',
  links: {
    pages: {
      '3fb607323e2e80629886fc0c028d50a7': {
        documentId: '0e5b6a2c-7c39-4a63-9a0c-5c1f2f6c0001',
        name: 'Spec',
      },
    },
    users: {
      '12345678123412341234123456789abc': {
        userId: 'macro|teo@acme.test',
        email: 'teo@acme.test',
      },
    },
  },
};

describe('notion snapshot endpoint', () => {
  it('returns a loadable Loro snapshot and its Macro markdown', async () => {
    const response = await request(page);
    expect(response.status).toBe(200);
    const body: { snapshot: string; markdown: string } = await response.json();
    const doc = new LoroDoc();
    doc.import(Buffer.from(body.snapshot, 'base64'));
    expect(doc.toJSON()).toBeTruthy();
    expect(body.markdown).toContain('# Launch');
    expect(body.markdown).toContain('<m-user-mention>');
    expect(body.markdown).toContain(
      '"documentId":"0e5b6a2c-7c39-4a63-9a0c-5c1f2f6c0001"'
    );
  });

  it('requires internal authentication', async () => {
    expect((await request(page, false)).status).toBe(401);
  });

  it('rejects a request without links', async () => {
    expect((await request({ markdown: page.markdown })).status).toBe(400);
  });
});
