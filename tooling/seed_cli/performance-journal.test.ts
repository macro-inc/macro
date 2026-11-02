import { afterEach, expect, test } from 'bun:test';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PerformanceJournal } from './performance-journal';

const directories: string[] = [];
function journalPath() {
  const directory = mkdtempSync(join(tmpdir(), 'performance-journal-'));
  directories.push(directory);
  return join(directory, 'journal.jsonl');
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true });
});

test('resume reuses acknowledged IDs without issuing another mutation', async () => {
  const path = journalPath();
  const first = new PerformanceJournal(path, 'local-persona');
  await first.create('document.0', async () => 'created-id');
  const resumed = new PerformanceJournal(path, 'local-persona');
  expect(resumed.dataset).toBe(first.dataset);
  expect(
    await resumed.create('document.0', async () => {
      throw new Error('must not run');
    })
  ).toBe('created-id');
});

test('lost response remains ambiguous rather than creating a duplicate on resume', async () => {
  const path = journalPath();
  const first = new PerformanceJournal(path, 'local-persona');
  await expect(
    first.create('message.0', async () => {
      throw new Error('lost response');
    })
  ).rejects.toThrow('lost response');
  expect(() => new PerformanceJournal(path, 'local-persona')).toThrow(
    'Unacknowledged writes: message.0'
  );
});

test('a journal cannot be reused for another account or backend', () => {
  const path = journalPath();
  new PerformanceJournal(path, 'first-origin-and-persona');
  expect(
    () => new PerformanceJournal(path, 'other-origin-and-persona')
  ).toThrow('another origin or persona');
});

test('verified absent writes can be reconciled without losing acknowledged IDs', async () => {
  const path = journalPath();
  const first = new PerformanceJournal(path, 'local-persona');
  await first.create('document.0', async () => 'saved-id');
  await expect(
    first.create('session.0', async () => {
      throw new Error('rejected');
    })
  ).rejects.toThrow('rejected');
  appendFileSync(
    path,
    `${JSON.stringify({ kind: 'not-created', key: 'session.0' })}\n`
  );
  const resumed = new PerformanceJournal(path, 'local-persona');
  expect(resumed.completed.get('document.0')).toBe('saved-id');
  expect(await resumed.create('session.0', async () => 'new-id')).toBe(
    'new-id'
  );
});
