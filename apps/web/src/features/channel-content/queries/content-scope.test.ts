import {
  NIL_UUID,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { describe, expect, it } from 'vitest';
import { channelContentScope } from './content-scope';

const references = [
  { entity_id: 'doc', entity_type: 'document', created_at: '2026-09-14' },
  { entity_id: 'doc', entity_type: 'document', created_at: '2026-09-13' },
  { entity_id: 'task', entity_type: 'task', created_at: '2026-09-13' },
  {
    entity_id: 'agent',
    entity_type: 'agent_session',
    created_at: '2026-09-13',
  },
  { entity_id: 'image', entity_type: 'static/image', created_at: '2026-09-13' },
];

describe('channel content scope', () => {
  it('keeps file membership and exclusions when refinements are reset or replaced', () => {
    const reset = channelContentScope('files', 'channel', references);
    expect(reset.include.documentId).toEqual(['doc', 'task']);
    expect(reset.exclude.subType).toContain('task');
    expect(reset.exclude.fileAssoc).toEqual(['assoc:image', 'assoc:video']);
    const filtered = channelContentScope(
      'files',
      'channel',
      references,
      queryStateFrom({
        include: {
          documentId: ['elsewhere'],
          fileAssoc: ['assoc:pdf'],
          channelId: ['elsewhere'],
        },
      })
    );
    expect(filtered.include.documentId).toEqual(reset.include.documentId);
    expect(filtered.include.fileAssoc).toEqual(['assoc:pdf']);
    expect(filtered.include.channelId).toEqual([NIL_UUID]);
  });
  it('preserves task status and assignee filters within the shared document scope', () => {
    const properties = [
      { propertyId: 'status', type: 'select' as const, value: 'completed' },
      { propertyId: 'assignee', type: 'entity' as const, value: 'person' },
    ];
    const scope = channelContentScope(
      'tasks',
      'channel',
      references,
      queryStateFrom({ include: { properties } })
    );
    expect(scope.include.subType).toEqual(['task']);
    expect(scope.include.documentId).toEqual(['doc', 'task']);
    expect(scope.include.properties).toEqual(properties);
  });
  it('uses an empty scope rather than querying all documents or agents', () => {
    expect(
      channelContentScope('files', 'channel', []).include.documentId
    ).toEqual([NIL_UUID]);
    expect(
      channelContentScope('agents', 'channel', []).include.agentSessionId
    ).toEqual([NIL_UUID]);
  });
  it('opts into only the agent sessions actually shared here', () => {
    const scope = channelContentScope('agents', 'channel', references);
    expect(scope.include.agentSessionId).toEqual(['agent']);
    expect(scope.include.includeAgentSessions).toBe(true);
    expect(scope.include.documentId).toEqual([NIL_UUID]);
  });
  it('keeps calls scoped to the channel when other filters change', () => {
    const scope = channelContentScope(
      'calls',
      'channel',
      [],
      queryStateFrom({
        include: { callChannelId: ['elsewhere'], callStatus: 'MISSED' },
      })
    );
    expect(scope.include.callChannelId).toEqual(['channel']);
    expect(scope.include.callStatus).toBe('MISSED');
    expect(scope.include.documentId).toEqual([NIL_UUID]);
  });
});
