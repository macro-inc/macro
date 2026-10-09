import { readFileSync } from 'node:fs';
import { applyLayout, readLayout } from '@macro-inc/collaboration/forms/layout';
import { LoroDoc } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import forms from './forms';

// Produced by the Rust Forms codec, also read by the browser's codec tests.
const fixture = readFileSync(
  new URL(
    '../../../../crates/forms/fixtures/collaboration/rust-seeded.loro',
    import.meta.url
  )
);
const call = (value: unknown) =>
  forms.request('http://worker/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });

describe('Forms editing endpoint', () => {
  it('edits a Rust snapshot and returns a mergeable binary delta', async () => {
    const human = LoroDoc.fromSnapshot(fixture);
    const original = readLayout(human);
    const ai = structuredClone(original);
    ai.sections[0]!.title = 'AI title';
    const response = await call({
      snapshot: fixture.toString('base64'),
      layout: ai,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'application/octet-stream'
    );
    const changed = structuredClone(original);
    changed.sections[0]!.description = 'Human description';
    applyLayout(human, original, changed);
    human.commit();
    human.import(new Uint8Array(await response.arrayBuffer()));
    expect(readLayout(human).sections[0]).toMatchObject({
      title: 'AI title',
      description: 'Human description',
    });
  });
  it('rejects malformed snapshots and malformed question data', async () => {
    expect(
      (await call({ snapshot: 'invalid', layout: { sections: [] } })).status
    ).toBe(422);
    expect(
      (
        await call({
          snapshot: '',
          layout: { sections: [{ id: 'invalid', kind: 'questions' }] },
        })
      ).status
    ).toBe(400);
  });
  it('bounds incoming request bytes before decoding snapshots', async () => {
    const response = await forms.request('http://worker/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'x'.repeat(8 * 1024 * 1024 + 1),
    });
    expect(response.status).toBe(413);
  });
});
