import { describe, expect, it } from 'vitest';
import {
  decodeExecutionResource,
  decodeExecutionResult,
  getExecutionResource,
  getHistoryResource,
  resourcesMatch,
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
