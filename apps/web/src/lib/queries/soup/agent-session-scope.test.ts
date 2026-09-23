import { NIL_UUID } from '@app/features/next-soup/filters/configs/base';
import { expect, it } from 'vitest';
import { bodyMayContainAgentSessions } from './agent-session-scope';

it.each([
  ['an AST body without an agent-session filter', { df: { l: 'task' } }],
  ['the AST nil-id exclusion', { asf: { l: { id: NIL_UUID } } }],
  ['a legacy body without agent-session filters', { document_filters: {} }],
  [
    'the legacy nil-id exclusion',
    { agent_session_filters: { ids: [NIL_UUID] } },
  ],
  ['request params', { sort_method: 'viewed_at', limit: 50 }],
  ['a key segment that is not an object', 'soup'],
])('excludes %s', (_name, body) => {
  expect(bodyMayContainAgentSessions(body)).toBe(false);
});

it.each([
  ['an AST include', { asf: { l: 'inc' } }],
  ['an AST owner filter', { asf: { l: { o: 'macro|a@macro.com' } } }],
  [
    'an AST expression around the nil id',
    { asf: { '!': { l: { id: NIL_UUID } } } },
  ],
  ['a legacy include', { agent_session_filters: { include: true } }],
  ['legacy session ids', { agent_session_filters: { ids: ['session-1'] } }],
  [
    'legacy owners',
    { agent_session_filters: { ids: [NIL_UUID], owners: ['macro|a'] } },
  ],
])('includes %s', (_name, body) => {
  expect(bodyMayContainAgentSessions(body)).toBe(true);
});
