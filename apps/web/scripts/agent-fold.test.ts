import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { beforeAll, expect, it } from 'vitest';
import type { FoldStream } from '../src/lib/core/agent-fold/wasm-module';

let Stream: new (session: string) => FoldStream;

beforeAll(async () => {
  // Keep the worker responsive to Vitest RPC while a cold WASM build runs.
  await promisify(execFile)('just', ['build-agent-fold-wasm'], {
    cwd: new URL('..', import.meta.url),
    maxBuffer: 10 * 1024 * 1024,
  });
  const path = new URL('../src/lib/core/agent-fold/wasm/', import.meta.url);
  const wasm = await import(/* @vite-ignore */ new URL('agent_fold.js', path).href);
  await wasm.default({
    module_or_path: readFileSync(new URL('agent_fold_bg.wasm', path)),
  });
  Stream = wasm.FoldStream;
}, 300_000);

it('decodes durable DTOs, reconciles overlap, and folds a batch like a stream', () => {
  const session = '00000000-0000-0000-0000-00000000000a';
  const chunk = (text: string) => ({
    direction: 'to_server' as const,
    content: {
      type: 'acp',
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'runtime',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text },
        },
      },
    },
  });
  const boundary = {
    ...chunk('same'),
    id: '00000000-0000-0000-0000-000000000002',
    createdAt: '2026-08-13T00:00:00.000002Z',
    userId: 'macro|reader@example.com',
  };
  const confirmed = (row: typeof boundary) => ({ kind: 'confirmed' as const, row });
  const stream = new Stream(session);
  const other = new Stream(session);
  try {
    // A snapshot and the same row confirmed derive the same view.
    stream.push([{ kind: 'snapshot', rows: [boundary] }]);
    other.push([{ kind: 'snapshot', rows: [] }]);
    other.push([confirmed(boundary)]);
    expect(stream.messages()).toEqual(other.messages());
    // Rows the snapshot already holds, and rows behind its cursor, change nothing.
    expect(stream.push([confirmed(boundary), confirmed(boundary)])).toEqual([]);
    expect(
      stream.push([
        confirmed({
          ...boundary,
          id: '00000000-0000-0000-0000-000000000009',
          createdAt: '2026-08-13T00:00:00.000001Z',
        }),
      ])
    ).toEqual([]);
    // A new row folds, and both streams still agree.
    const live = { ...boundary, id: '00000000-0000-0000-0000-000000000003' };
    expect(stream.push([confirmed(live)])).toEqual(other.push([confirmed(live)]));
    expect(stream.messages()).toEqual(other.messages());
    // A fresh snapshot resets the committed tier: the boundary folds again.
    expect(stream.push([{ kind: 'snapshot', rows: [] }])).not.toEqual([]);
    expect(stream.push([confirmed(boundary)])).not.toEqual([]);
  } finally {
    stream.free();
    other.free();
  }
});

it('preserves replacement events and later updates within one durable batch', () => {
  const session = '00000000-0000-0000-0000-00000000000a';
  const rows = readFileSync(
    new URL('../../../crates/agent_fold/fixtures/load_replacement.jsonl', import.meta.url),
    'utf8'
  ).trim().split('\n').map((line, index) => ({
    ...JSON.parse(line),
    id: `00000000-0000-0000-0000-${index.toString(16).padStart(12, '0')}`,
    createdAt: '2026-08-13T00:00:00Z',
  }));
  const confirmed = (row: (typeof rows)[number]) => ({ kind: 'confirmed' as const, row });
  const stream = new Stream(session);
  const one = new Stream(session);
  try {
    stream.push([{ kind: 'snapshot', rows: rows.slice(0, 10) }]);
    one.push([{ kind: 'snapshot', rows: rows.slice(0, 10) }]);
    const expected = rows.slice(10).flatMap((row) => one.push([confirmed(row)]));
    expect(expected.some((event) => event.kind === 'replace')).toBe(true);
    // Overlap with the snapshot is dropped; the rest folds as if one at a time.
    expect(stream.push(rows.slice(5).map(confirmed))).toEqual(expected);
    expect(stream.messages()).toEqual(one.messages());
  } finally {
    stream.free();
    one.free();
  }
});
