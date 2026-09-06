import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import type { FoldStream } from '../src/lib/core/agent-fold/wasm-module';

let Stream: new (session: string) => FoldStream;

beforeAll(async () => {
  execFileSync('just', ['build-agent-fold-wasm'], {
    cwd: new URL('..', import.meta.url),
    stdio: 'pipe',
  });
  const path = new URL('../src/lib/core/agent-fold/wasm/', import.meta.url);
  const wasm = await import(/* @vite-ignore */ new URL('agent_fold.js', path).href);
  await wasm.default({
    module_or_path: readFileSync(new URL('agent_fold_bg.wasm', path)),
  });
  Stream = wasm.FoldStream;
}, 300_000);

it('decodes durable DTOs, reconciles overlap, and keeps raw frame consumers', () => {
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
  const stream = new Stream(session);
  const raw = new Stream(session);
  try {
    expect(stream.snapshot([boundary])).toEqual(raw.extend([boundary]));
    expect(stream.push_rows([boundary, boundary])).toEqual([]);
    expect(
      stream.push_rows([
        {
          ...boundary,
          id: '00000000-0000-0000-0000-000000000009',
          createdAt: '2026-08-13T00:00:00.000001Z',
        },
      ])
    ).toEqual([]);
    const live = { ...boundary, id: '00000000-0000-0000-0000-000000000003' };
    expect(stream.push_rows([live])).toEqual(raw.push(live));
    expect(stream.messages()).toEqual(raw.messages());
    // Raw protocol APIs still accept frames with no durable metadata.
    raw.snapshot([]);
    expect(raw.extend([chunk('raw')])).toHaveLength(1);
    expect(raw.push(chunk(' tail'))).not.toEqual([]);
    expect(stream.snapshot([])).toEqual([]);
    expect(stream.push_rows([boundary])).not.toEqual([]);
  } finally {
    stream.free();
    raw.free();
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
  const stream = new Stream(session);
  const raw = new Stream(session);
  try {
    stream.snapshot(rows.slice(0, 10));
    raw.extend(rows.slice(0, 10));
    const expected = rows.slice(10).flatMap((row) => raw.push(row));
    expect(expected.some((event) => event.kind === 'replace')).toBe(true);
    expect(stream.push_rows(rows.slice(5))).toEqual(expected);
    expect(stream.messages()).toEqual(raw.messages());
  } finally {
    stream.free();
    raw.free();
  }
});
