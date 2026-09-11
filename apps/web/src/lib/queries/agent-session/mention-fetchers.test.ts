import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clients = vi.hoisted(() => ({
  graphql: vi.fn(),
  preview: vi.fn(),
}));
vi.mock('@service-storage/agent-session-mentions', () => ({
  fetchGraphqlAgentSessionMentions: clients.graphql,
}));
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: { preview: clients.preview },
}));

import {
  agentSessionMentionInput,
  fetchAgentSessionMentionPreviews,
} from './mention-fetchers';

beforeEach(() => vi.clearAllMocks());
const session = {
  id: 'one',
  name: 'Fix menu',
  botId: 'bot',
  ownerId: 'owner',
  createdAt: '',
  updatedAt: '',
  status: 'session/end',
  bot: { id: 'bot', name: 'Ada', avatarUrl: null },
};

describe('mention transport adapters', () => {
  it('opts into sessions and excludes other Soup entity types', () => {
    const input = agentSessionMentionInput();
    expect(input.initial?.limit).toBe(500);
    expect(input.initial?.filters?.agentSessionFilter).toEqual({
      literal: { include: true },
    });
    expect(input.initial?.filters?.documentFilter).toEqual({
      literal: { id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(
      agentSessionMentionInput(['one', 'two']).initial?.filters
        ?.agentSessionFilter
    ).toEqual({
      or: {
        left: { literal: { id: 'one' } },
        right: { literal: { id: 'two' } },
      },
    });
  });
  it('uses GraphQL metadata without a REST waterfall for accessible sessions', async () => {
    clients.graphql.mockResolvedValue([session]);
    const result = await fetchAgentSessionMentionPreviews(['one'], true);
    expect(result.get('one')).toMatchObject({
      access: 'access',
      data: {
        bot: session.bot,
        status: { kind: 'event', event: 'session/end' },
      },
    });
    expect(clients.preview).not.toHaveBeenCalled();
  });
  it('uses REST to distinguish inaccessible and deleted GraphQL omissions', async () => {
    clients.graphql.mockResolvedValue([session]);
    clients.preview.mockResolvedValue(
      ok({
        previews: [
          { id: 'private', type: 'no_access' },
          { id: 'deleted', type: 'does_not_exist' },
        ],
      })
    );
    const result = await fetchAgentSessionMentionPreviews(
      ['one', 'private', 'deleted'],
      true
    );
    expect(clients.preview).toHaveBeenCalledWith(['private', 'deleted']);
    expect(result.get('private')).toEqual({ access: 'no_access' });
    expect(result.get('deleted')).toEqual({ access: 'does_not_exist' });
  });
  it('hydrates REST previews with persona metadata and normalized timestamps', async () => {
    clients.preview.mockResolvedValue(
      ok({
        previews: [
          {
            ...session,
            type: 'access',
            modifiedAt: 'updated',
            status: { kind: 'no_messages' },
          },
        ],
      })
    );
    const result = await fetchAgentSessionMentionPreviews(['one'], false);
    expect(result.get('one')).toMatchObject({
      access: 'access',
      data: { updatedAt: 'updated', bot: { name: 'Ada', avatarUrl: null } },
    });
    expect(clients.graphql).not.toHaveBeenCalled();
  });
});
