import { describe, expect, test } from 'bun:test';
import type { AgentSessionLifecycleEvent } from '../generated/storage/types.gen';
import { hydrateAgentSessionEvent } from '../src/events/hydrate/agentSession';
import type { MacroClient } from '../src/utils/client';

// Handles are lazy, so hydration never touches the network.
const client = {} as MacroClient;

const identity = {
  session_id: '01a00000-0000-7000-8000-00000000000a',
  session_name: 'Fix the flaky test',
  bot_id: '01a00000-0000-7000-8000-0000000000b7',
  bot_name: 'Macro Coder',
  owner_id: 'macro|owner@example.com',
  origin: {
    channel_id: '01a00000-0000-7000-8000-000000000001',
    thread_id: '01a00000-0000-7000-8000-000000000002',
    originating_message_id: '01a00000-0000-7000-8000-000000000003',
  },
};

const settled: AgentSessionLifecycleEvent = {
  event_type: 'agent_session.settled',
  metadata: {
    identity,
    last_turn: {
      turn: 0,
      action_id: '01a00000-0000-7000-8000-000000000004',
      actor: 'macro|asker@example.com',
      announcement_message_id: '01a00000-0000-7000-8000-000000000005',
      stop_reason: 'end_turn',
      excerpt: 'Done.',
    },
  },
};

describe('hydrateAgentSessionEvent', () => {
  test('settled hands out the session, owner, origin, chip, and actor', () => {
    const event = hydrateAgentSessionEvent(client, settled);
    if (event.event_type !== 'agent_session.settled')
      throw new Error(event.event_type);

    expect(event.session.id).toBe(identity.session_id);
    expect(event.owner.id).toBe(identity.owner_id);
    expect(event.channel?.id).toBe(identity.origin.channel_id);
    expect(event.thread).toBeDefined();
    expect(event.announcement?.id).toBe('01a00000-0000-7000-8000-000000000005');
    expect(event.actor?.id).toBe('macro|asker@example.com');
    expect(event.metadata.last_turn?.excerpt).toBe('Done.');
  });

  test('a session opened outside a channel has no origin handles', () => {
    const event = hydrateAgentSessionEvent(client, {
      event_type: 'agent_session.waiting_for_input',
      metadata: {
        identity: { ...identity, origin: null },
        turn: 1,
        action_id: '01a00000-0000-7000-8000-000000000004',
        announcement_message_id: '01a00000-0000-7000-8000-000000000005',
        question: 'Tea or coffee?',
      },
    });
    if (event.event_type !== 'agent_session.waiting_for_input')
      throw new Error(event.event_type);

    expect(event.session.id).toBe(identity.session_id);
    expect(event.channel).toBeUndefined();
    expect(event.thread).toBeUndefined();
    // The chip lives in the origin channel; without one there is nothing to point at.
    expect(event.announcement).toBeUndefined();
    expect(event.metadata.question).toBe('Tea or coffee?');
  });

  test('deleted carries only the identity handles', () => {
    const event = hydrateAgentSessionEvent(client, {
      event_type: 'agent_session.deleted',
      metadata: { identity },
    });
    if (event.event_type !== 'agent_session.deleted')
      throw new Error(event.event_type);

    expect(event.session.id).toBe(identity.session_id);
    expect(event.owner.id).toBe(identity.owner_id);
    expect(event.channel?.id).toBe(identity.origin.channel_id);
  });

  test('mentioned hands out the author and everyone named', () => {
    const event = hydrateAgentSessionEvent(client, {
      event_type: 'agent_session.mentioned',
      metadata: {
        identity,
        action_id: '01a00000-0000-7000-8000-000000000006',
        mentioned_by: 'macro|owner@example.com',
        mentioned: ['macro|reviewer@example.com', 'macro|lead@example.com'],
      },
    });
    if (event.event_type !== 'agent_session.mentioned')
      throw new Error(event.event_type);

    expect(event.session.id).toBe(identity.session_id);
    expect(event.mentionedBy?.id).toBe('macro|owner@example.com');
    expect(event.mentioned.map((user) => user.id)).toEqual([
      'macro|reviewer@example.com',
      'macro|lead@example.com',
    ]);
  });
});
