import { expect, test } from '@playwright/test';
import type { FoldedMessage } from '@service-agent-fold/generated/types';
import type { AgentSessionLogEntryDto } from '@service-agent-harness/generated/schemas';
import type { FoldStream } from '../wasm-module';

// The real compiled WASM runs in Chromium. The same fixture is folded natively
// by agent_fold's replay tests; every snapshot/stream split is covered here.
test('load transactions agree for batch, incremental, and snapshot plus streaming', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modulePath = '/apps/web/src/lib/core/agent-fold/wasm/agent_fold.js';
    const wasm = (await import(modulePath)) as {
      default: () => Promise<unknown>;
      FoldStream: new (session: string) => FoldStream;
      fold_session: (
        session: string,
        entries: AgentSessionLogEntryDto[]
      ) => FoldedMessage[];
    };
    await wasm.default();
    const entries: AgentSessionLogEntryDto[] = (
      await (
        await fetch('/crates/agent_fold/fixtures/load_replacement.jsonl')
      ).text()
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const session = '00000000-0000-0000-0000-000000000001';
    const stream = new wasm.FoldStream(session);
    let visible: FoldedMessage[] = [];
    let replacements = 0;
    for (let i = 0; i < entries.length; i++) {
      for (const event of stream.push(entries[i]!)) {
        if (event.kind === 'replace') {
          visible = event.messages;
          replacements++;
        } else if (event.kind === 'new') {
          visible.push(event.message);
        } else if (event.kind === 'update') {
          const at = visible.findIndex(
            (m) =>
              m.turn === event.message.turn &&
              m.author.kind === event.message.author.kind
          );
          visible[at] = event.message;
        }
      }
      const expected = JSON.stringify(
        wasm.fold_session(session, entries.slice(0, i + 1))
      );
      if (
        JSON.stringify(visible) !== expected ||
        JSON.stringify(stream.messages()) !== expected
      )
        throw new Error(`stream diverged at ${i}`);
    }
    const batch = wasm.fold_session(session, entries);
    for (let split = 0; split <= entries.length; split++) {
      const partial = new wasm.FoldStream(session);
      partial.extend(entries.slice(0, split));
      for (const entry of entries.slice(split)) partial.push(entry);
      if (JSON.stringify(partial.messages()) !== JSON.stringify(batch))
        throw new Error(`snapshot split diverged at ${split}`);
      partial.free();
    }
    const text = visible.flatMap((message) =>
      message.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : []))
    );
    const tool = visible
      .flatMap((message) => message.parts)
      .find((part) => part.kind === 'tool_use');
    const thought = visible
      .flatMap((message) => message.parts)
      .find((part) => part.kind === 'thought');
    stream.free();
    document.body.textContent = text.join('\n');
    return {
      text,
      replacements,
      toolStatus: tool?.status,
      thought: thought?.text,
    };
  });
  expect(result).toEqual({
    text: ['question', 'answer', 'next', 'continued'],
    replacements: 2,
    toolStatus: 'completed',
    thought: 'thinking',
  });
  await expect(page.locator('body')).toHaveText(
    'question\nanswer\nnext\ncontinued'
  );
});

test('legacy persisted success survives failed hydration and new generic empty load replaces it', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modulePath = '/apps/web/src/lib/core/agent-fold/wasm/agent_fold.js';
    const wasm = await import(modulePath);
    await wasm.default();
    const entries = (
      await (
        await fetch('/crates/agent_fold/fixtures/legacy_load_context.jsonl')
      ).text()
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const session = '00000000-0000-0000-0000-000000000001';
    const expected = wasm.fold_session(session, entries.slice(0, 6));
    let replacements = 0;
    for (let split = 0; split <= entries.length; split++) {
      const stream = new wasm.FoldStream(session);
      stream.extend(entries.slice(0, split));
      for (let i = split; i < entries.length; i++) {
        for (const event of stream.push(entries[i])) {
          if (split === 0 && event.kind === 'replace') replacements++;
        }
        const batch = wasm.fold_session(session, entries.slice(0, i + 1));
        if (JSON.stringify(stream.messages()) !== JSON.stringify(batch))
          throw new Error(`split ${split}, frame ${i}`);
        if (
          i >= 5 &&
          i < entries.length - 1 &&
          JSON.stringify(batch) !== JSON.stringify(expected)
        )
          throw new Error(`legacy history changed at ${i}`);
      }
      if (stream.messages().length !== 0)
        throw new Error('empty load did not clear history');
      stream.free();
    }
    return { replacements, oldMessages: expected.length };
  });
  expect(result).toEqual({ replacements: 1, oldMessages: 4 });
});

test('terminal replay facts restore idle state while a partial tail continues', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modulePath = '/apps/web/src/lib/core/agent-fold/wasm/agent_fold.js';
    const wasm = await import(modulePath);
    await wasm.default();
    const session = '00000000-0000-0000-0000-000000000001';
    const frame = (direction: string, body: Record<string, unknown>) => ({
      direction,
      content: { type: 'acp', jsonrpc: '2.0', ...body },
    });
    const load = (id: number) =>
      frame('to_runtime', {
        id,
        method: 'session/load',
        params: { sessionId: 's', cwd: '/', mcpServers: [] },
      });
    const update = (kind: string, text: string) =>
      frame('to_server', {
        method: 'session/update',
        params: {
          sessionId: 's',
          update: {
            sessionUpdate: kind,
            content: { type: 'text', text },
          },
        },
      });
    const complete = (kind: string) =>
      frame('to_server', {
        method: '_session/turn_complete',
        params: {
          sessionId: 's',
          outcome: {
            kind,
            ...(kind === 'failed' ? { message: 'failed run' } : {}),
          },
        },
      });
    const response = (id: number) => frame('to_server', { id, result: {} });
    const outcomes: unknown[] = [];
    for (const kind of ['finished', 'cancelled', 'failed']) {
      const entries = [
        load(1),
        update('user_message_chunk', 'question'),
        update('agent_message_chunk', 'answer'),
        complete(kind),
        response(1),
      ];
      const batch = wasm.fold_session(session, entries);
      for (let split = 0; split <= entries.length; split++) {
        const machine = new wasm.FoldStream(session);
        machine.extend(entries.slice(0, split));
        for (const entry of entries.slice(split)) machine.push(entry);
        if (JSON.stringify(machine.messages()) !== JSON.stringify(batch)) {
          throw new Error(`terminal ${kind} diverged at ${split}`);
        }
        machine.free();
      }
      outcomes.push(batch[1].stop);
      if (
        wasm.fold_session(session, [...entries, load(2), response(2)]).length
      ) {
        throw new Error(
          'ordinary successful empty load must still clear history'
        );
      }
    }
    const partial = [
      load(1),
      update('user_message_chunk', 'question'),
      update('agent_message_chunk', 'hel'),
      response(1),
    ];
    const before = wasm.fold_session(session, partial);
    const after = wasm.fold_session(session, [
      ...partial,
      update('agent_message_chunk', 'lo'),
      complete('finished'),
    ]);
    return {
      outcomes,
      partialStop: before[1].stop,
      continuedStop: after[1].stop,
      continuedText: after[1].parts[0].text,
      count: after.length,
    };
  });
  expect(result).toEqual({
    outcomes: [
      { kind: 'end_turn' },
      { kind: 'cancelled' },
      { kind: 'failed', message: 'failed run' },
    ],
    partialStop: null,
    continuedStop: { kind: 'end_turn' },
    continuedText: 'hello',
    count: 2,
  });
});
