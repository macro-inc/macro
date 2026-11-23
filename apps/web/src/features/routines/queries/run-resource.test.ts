import { describe, expect, it } from 'vitest';
import {
  decodeExecutionResource,
  decodeExecutionResult,
  getExecutionResource,
  getHistoryResource,
  getHistorySkip,
  resourcesMatch,
  toHistoryRecord,
} from './run-resource';

const chat = { type: 'chat', id: 'same-id' } as const;
const agent = { type: 'agent', id: 'same-id' } as const;

describe('execution resources', () => {
  it('decodes the closed set of resource types', () => {
    expect(decodeExecutionResource(chat)).toEqual(chat);
    expect(decodeExecutionResource(agent)).toEqual(agent);
  });

  it.for([
    null,
    undefined,
    [],
    'chat',
    {},
    { type: 'unknown', id: 'id' },
    { type: 'chat' },
    { type: 'agent', id: 123 },
    { type: 'agent', id: '' },
    { type: 'chat', id: '  ' },
  ])('rejects malformed resources: %j', (value) => {
    expect(decodeExecutionResource(value)).toBeUndefined();
  });

  it('accepts legacy chat-only executions and prefers typed metadata', () => {
    expect(getExecutionResource({ chat_id: chat.id })).toEqual(chat);
    expect(getExecutionResource({ resource: agent, chat_id: chat.id })).toEqual(
      agent
    );
    expect(getExecutionResource({ resource: agent })).toEqual(agent);
    expect(getExecutionResource({})).toBeUndefined();
    expect(getExecutionResource({ chat_id: 12 })).toBeUndefined();
  });

  it.each([null, {}, { type: 'future', id: chat.id }])(
    'never falls back to chat for explicit invalid resource metadata: %j',
    (resource) => {
      expect(
        getExecutionResource({ resource, chat_id: chat.id })
      ).toBeUndefined();
    }
  );

  it('compares both type and ID', () => {
    expect(resourcesMatch(chat, chat)).toBe(true);
    expect(resourcesMatch(agent, agent)).toBe(true);
    expect(resourcesMatch(chat, agent)).toBe(false);
    expect(resourcesMatch(undefined, agent)).toBe(false);
    expect(resourcesMatch({ ...agent, id: 'other' }, agent)).toBe(false);
  });
});

describe('versioned execution results', () => {
  it('decodes successful and failed envelopes', () => {
    for (const resource of [chat, agent, null, undefined]) {
      const result = { version: 1, resource, error: 'failed' };
      expect(decodeExecutionResult(result)).toEqual(result);
      expect(getHistoryResource({ result, resource_id: 'ignored' })).toEqual(
        resource ?? undefined
      );
    }
    expect(decodeExecutionResult({ version: 1, resource: agent })).toEqual({
      version: 1,
      resource: agent,
    });
    expect(decodeExecutionResult({ version: 1, error: null })).toEqual({
      version: 1,
      error: null,
    });
  });

  it.each([null, '', 'legacy error'])(
    'uses legacy chats only for %j',
    (result) => {
      expect(getHistoryResource({ result, resource_id: chat.id })).toEqual(
        chat
      );
      expect(getHistoryResource({ result })).toBeUndefined();
      expect(getHistoryResource({ result, resource_id: ' ' })).toBeUndefined();
    }
  );

  it.for([
    undefined,
    {},
    [],
    true,
    1,
    { version: 2, resource: agent },
    { version: '1', resource: agent },
    { resource: agent },
    { version: 1, resource: { type: 'future', id: chat.id } },
    { version: 1, resource: { type: 'agent', id: '' } },
    { version: 1, resource: agent, error: {} },
  ])('does not treat unknown/malformed envelopes as legacy: %j', (result) => {
    expect(decodeExecutionResult(result)).toBeUndefined();
    expect(
      getHistoryResource({ result, resource_id: chat.id })
    ).toBeUndefined();
  });

  it('does not fall back when a new run produced no resource', () => {
    expect(
      getHistoryResource({
        result: { version: 1, resource: null, error: 'Preparation failed' },
        resource_id: chat.id,
      })
    ).toBeUndefined();
    expect(
      getHistoryResource({ result: { version: 1 }, resource_id: chat.id })
    ).toBeUndefined();
  });
});

describe('skipped runs', () => {
  const skipped = (condition: unknown) => ({
    version: 1,
    resource: null,
    error: null,
    condition,
  });

  it('decodes unmet and unavailable conditions', () => {
    expect(
      getHistorySkip({
        result: skipped({ status: 'not_met', probability: 0.12 }),
      })
    ).toEqual({ reason: 'not_met', probability: 0.12 });
    expect(
      getHistorySkip({ result: skipped({ status: 'unavailable' }) })
    ).toEqual({ reason: 'unavailable' });
  });

  it.for([null, 'chat-id', {}, skipped(null), skipped({ status: 'other' })])(
    'treats %j as a run, not a skip',
    (result) => {
      expect(getHistorySkip({ result })).toBeUndefined();
    }
  );

  it('carries the skip into history records', () => {
    expect(
      toHistoryRecord({
        id: 'record',
        result: skipped({ status: 'not_met', probability: 0.2 }),
        resource_id: null,
        start_time: '2026-10-05T09:00:00Z',
        end_time: '2026-10-05T09:00:00Z',
        is_success: true,
      })
    ).toMatchObject({
      resource: undefined,
      skipped: { reason: 'not_met', probability: 0.2 },
    });
  });
});

describe('code steps in run history', () => {
  it('decodes each SDK call a code step made', () => {
    const record = toHistoryRecord({
      id: 'record',
      result: {
        version: 1,
        steps: [
          {
            path: '0',
            kind: 'code',
            calls: [
              {
                operation: 'cognition.decisions',
                label: 'Classify content',
                status: 'completed',
                started_ms: 3,
                duration_ms: 240,
              },
              {
                operation: 'email.archiveThread',
                label: 'Archive Thread',
                write: true,
                status: 'refused',
                started_ms: 250,
                duration_ms: 0,
              },
            ],
            calls_truncated: true,
            error: 'Error: can’t make changes in email',
          },
        ],
      },
      resource_id: null,
      start_time: '2026-11-01T09:00:00Z',
      end_time: '2026-11-01T09:00:01Z',
      is_success: false,
    });
    expect(record.steps).toEqual([
      {
        path: '0',
        kind: 'code',
        calls: [
          {
            operation: 'cognition.decisions',
            label: 'Classify content',
            write: false,
            status: 'completed',
            startedMs: 3,
            durationMs: 240,
          },
          {
            operation: 'email.archiveThread',
            label: 'Archive Thread',
            write: true,
            status: 'refused',
            startedMs: 250,
            durationMs: 0,
          },
        ],
        callsTruncated: true,
        error: 'Error: can’t make changes in email',
      },
    ]);
  });
});

describe('step outputs and run starts in run history', () => {
  const run = (startedBy: unknown, extra: object = {}) =>
    toHistoryRecord({
      id: 'record',
      result: {
        version: 1,
        steps: [
          {
            path: '0',
            kind: 'code',
            output: { count: 2, ids: ['a', 'b'] },
          },
          {
            path: '1',
            kind: 'code',
            output: { documentId: 'doc-1' },
          },
          { path: '2', kind: 'agent' },
        ],
        run: {
          at: '2026-11-01T08:00:00Z',
          started_by: startedBy,
          ...extra,
        },
      },
      start_time: '2026-11-01T08:00:01Z',
      is_success: true,
    });

  it('keeps what each step returned', () => {
    const steps = run({ kind: 'manual', by: 'macro|owner@example.com' }).steps;
    expect(
      steps?.map((step) => (step.kind === 'code' ? step.output : null))
    ).toEqual([{ count: 2, ids: ['a', 'b'] }, { documentId: 'doc-1' }, null]);
  });

  it('decodes what started the run, when it counts as happening, and the run before', () => {
    expect(
      run(
        {
          kind: 'schedule',
          schedule: '0 0 9 * * *',
          timezone: 'Europe/Paris',
        },
        {
          timezone: 'Europe/Paris',
          previous_at: '2026-10-31T08:00:00Z',
        }
      ).run
    ).toEqual({
      at: '2026-11-01T08:00:00Z',
      timezone: 'Europe/Paris',
      previousAt: '2026-10-31T08:00:00Z',
      start: {
        kind: 'schedule',
        schedule: '0 0 9 * * *',
        timezone: 'Europe/Paris',
      },
    });
    expect(
      run({ kind: 'event', event: 'email.message_received', entity_id: 't-1' })
        .run?.start
    ).toEqual({
      kind: 'event',
      event: 'email.message_received',
      entityId: 't-1',
    });
    expect(
      run({ kind: 'event', event: 'channel.mentioned', entity_id: null }).run
        ?.start
    ).toEqual({ kind: 'event', event: 'channel.mentioned' });
    // Runs recorded before runs kept what started them have none.
    expect(run({ kind: 'unknown' }).run).toBeUndefined();
  });

  it('decodes whom code steps acted as, ignoring values it does not know', () => {
    const manual = { kind: 'manual', by: 'macro|owner@example.com' };
    expect(run(manual, { code_acts_as: 'owner' }).run?.codeActsAs).toBe(
      'owner'
    );
    expect(run(manual, { code_acts_as: 'agent' }).run?.codeActsAs).toBe(
      'agent'
    );
    expect(run(manual).run).not.toHaveProperty('codeActsAs');
    const unknown = run(manual, { code_acts_as: 'someone' }).run;
    expect(unknown?.start).toEqual({ kind: 'manual', by: manual.by });
    expect(unknown).not.toHaveProperty('codeActsAs');
  });
});
