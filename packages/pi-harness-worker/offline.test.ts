import { expect, test } from 'bun:test';
import { applyBrainEvent } from '../starter-agent/behavior/brain/contracts.ts';
import {
  firstStart,
  queued,
} from '../starter-agent/behavior/brain/test/fixture.ts';
import {
  charter,
  input,
  job,
  pack,
  trusted,
} from '../starter-agent/behavior/brain/test/prompt-fixture.ts';
import { createParentFixture } from './parent-fixture.ts';

const root = process.env.PI_PROOF_ROOT;
if (!root) throw new Error('Run this proof via bun run test:offline');

const { assembleBrainPrompt } = await import(
  '../starter-agent/behavior/brain/prompt.ts'
);
const { fauxAssistantMessage, fauxToolCall } = await import(
  '@earendil-works/pi-ai/providers/faux'
);
const { openOfflineSession, toolName } = await import('./worker.ts');

const prompt = await assembleBrainPrompt(job, trusted, input);
const attempt = firstStart.attempt;
const running = applyBrainEvent({ ...queued, job }, firstStart);
const toolCall = fauxAssistantMessage(
  fauxToolCall(toolName, { record: 'fixture' }, { id: 'provider-call-1' }),
  { stopReason: 'toolUse' }
);

test('cold-loads only the explicit tool with an empty resource loader', async () => {
  const { session, extensionsResult } = await openOfflineSession(
    root,
    prompt.systemPrompt,
    async () => {
      throw new Error('Cold load attempted to dispatch the fixture tool');
    }
  );

  try {
    expect(extensionsResult.extensions).toEqual([]);
    expect(extensionsResult.errors).toEqual([]);
    expect(session.getCallableToolNames()).toEqual([toolName]);
  } finally {
    session.dispose();
  }
});

test('streams one pinned turn through the sole parent-permitted fake tool', async () => {
  const stop = new AbortController();
  const parent = createParentFixture(
    attempt,
    stop.signal,
    async () => 'Fake value'
  );
  const { session, installFakeProvider } = await openOfflineSession(
    root,
    prompt.systemPrompt,
    (record, signal) => parent.dispatch(attempt, record, signal)
  );
  const faux = installFakeProvider();
  const textDeltas: string[] = [];
  const unsubscribe = session.subscribe((event) => {
    if (
      event.type === 'message_update' &&
      event.assistantMessageEvent.type === 'text_delta'
    )
      textDeltas.push(event.assistantMessageEvent.delta);
  });

  try {
    expect(faux.state.callCount).toBe(0);
    await expect(
      parent.dispatch(attempt, 'another-record', undefined)
    ).rejects.toThrow('outside fixture grant');

    const userMessage = JSON.stringify(prompt.input);
    faux.setResponses([
      ({ messages }) => {
        const system = messages.find((message) => message.role === 'system');
        expect(system?.sections?.preamble).toBe(prompt.systemPrompt);
        expect(system?.sections?.preamble).toEndWith(`${charter}\n\n${pack}`);
        expect(system?.toolsAdded?.map(({ name }) => name)).toEqual([toolName]);
        expect(messages).toContainEqual(
          expect.objectContaining({
            role: 'user',
            content: [{ type: 'text', text: userMessage }],
          })
        );
        return toolCall;
      },
      ({ messages }) => {
        expect(messages).toContainEqual(
          expect.objectContaining({
            role: 'toolResult',
            toolCallId: 'provider-call-1',
            isError: false,
            content: [{ type: 'text', text: 'Fake value' }],
          })
        );
        return fauxAssistantMessage('Fixture record summarized.');
      },
    ]);
    await session.prompt(userMessage);

    expect(faux.state.callCount).toBe(2);
    const reply = session.getLastAssistantText();
    expect(reply).toBe('Fixture record summarized.');
    expect(textDeltas.join('')).toBe('Fixture record summarized.');
    expect(parent.receipts).toEqual([
      {
        attempt,
        actionId: 'read-fixture-record',
        status: 'committed',
        externalRef: 'fixture',
      },
    ]);

    const usage = {
      kind: 'reported' as const,
      inputTokens: 0,
      outputTokens: 0,
    };
    for (const message of session.agent.state.messages) {
      if (message.role !== 'assistant') continue;

      usage.inputTokens +=
        message.usage.input +
        message.usage.cacheRead +
        message.usage.cacheWrite;
      usage.outputTokens += message.usage.output;
    }

    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);
    const checkpoint = {
      pins: running.job.prompt,
      reply,
      state: applyBrainEvent(running, {
        kind: 'attempt_finished',
        attempt,
        outcome: 'succeeded',
        usage,
        effectReceipts: parent.receipts,
      }),
    };
    expect(checkpoint).toMatchObject({
      pins: job.prompt,
      reply: 'Fixture record summarized.',
      state: { kind: 'finished', outcome: 'succeeded', usage },
    });
  } finally {
    unsubscribe();
    session.dispose();
  }
});

test('cancels Pi while the fake tool child is active and fences late dispatch', async () => {
  const stop = new AbortController();
  const ready = Promise.withResolvers<{
    child: { pid: number; signalCode: string | null };
    signal: AbortSignal;
  }>();

  const parent = createParentFixture(attempt, stop.signal, async (signal) => {
    if (!signal) throw new Error('Pi did not supply a tool abort signal');

    const child = Bun.spawn(
      [
        process.execPath,
        '--no-env-file',
        '-e',
        'console.log("ready"); await Bun.stdin.text()',
      ],
      {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'inherit',
        env: { HOME: process.env.HOME },
        timeout: 4000,
        killSignal: 'SIGTERM',
      }
    );
    const kill = () => child.kill('SIGKILL');
    signal.addEventListener('abort', kill, { once: true });
    const reader = child.stdout.getReader();

    try {
      if (signal.aborted) kill();
      const { value } = await reader.read();
      if (new TextDecoder().decode(value) !== 'ready\n')
        throw new Error('Fixture child exited before readiness');

      ready.resolve({ child, signal });
      await child.exited;
      signal.throwIfAborted();
      throw new Error('Fixture child exited without cancellation');
    } finally {
      reader.releaseLock();
      signal.removeEventListener('abort', kill);
      if (child.exitCode === null && child.signalCode === null) kill();
      await child.exited;
    }
  });

  const { session, installFakeProvider } = await openOfflineSession(
    root,
    prompt.systemPrompt,
    (record, signal) => parent.dispatch(attempt, record, signal)
  );
  const faux = installFakeProvider();
  faux.setResponses([toolCall]);
  const turn = session.prompt(JSON.stringify(prompt.input));

  try {
    const started = await Promise.race([ready.promise, turn]);
    if (!started) throw new Error('Pi did not start the fixture tool child');

    const { child, signal } = started;
    expect(process.kill(child.pid, 0)).toBe(true);
    await expect(
      parent.dispatch({ ...attempt, leaseEpoch: 0 }, 'fixture', undefined)
    ).rejects.toThrow('stale attempt');

    stop.abort();
    const abort = session.abort();
    await expect(
      parent.dispatch(attempt, 'fixture', undefined)
    ).rejects.toThrow('stale attempt');
    await Promise.all([abort, turn]);

    expect(session.isIdle).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(child.signalCode).toBe('SIGKILL');
    expect(() => process.kill(child.pid, 0)).toThrow(/ESRCH/);
    expect(faux.state.callCount).toBe(1);
    expect(parent.receipts).toEqual([
      { attempt, actionId: 'read-fixture-record', status: 'unknown_outcome' },
    ]);
    const cancelled = applyBrainEvent(running, {
      kind: 'attempt_finished',
      attempt,
      outcome: 'cancelled',
      usage: { kind: 'unknown_cut' },
      effectReceipts: parent.receipts,
    });
    expect(cancelled).toMatchObject({
      kind: 'finished',
      outcome: 'cancelled',
      usage: { kind: 'unknown_cut' },
    });
  } finally {
    stop.abort();
    await Promise.all([session.abort(), turn]);
    session.dispose();
  }
});
