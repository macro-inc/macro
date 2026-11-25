import { describe, expect, it, vi } from 'vitest';
import {
  directMessageTeammate,
  firstTeammateMessage,
} from './team-agent-greeting';

const owner = 'macro|owner@example.com';
const teammate = 'macro|ada@agents.macro.invalid';

vi.mock('@queries/auth/user-name-cache-runtime', () => ({
  userNameCache: () => ({
    read: (id: string) => ({
      loading: false,
      name: { is_agent: id === teammate },
      updatedAt: 0,
    }),
  }),
}));

describe('the teammate welcome action', () => {
  it('requires an actual 1:1 DM with a teammate account', () => {
    expect(directMessageTeammate(owner, [teammate, owner])).toBe(teammate);
    expect(
      directMessageTeammate(owner, [teammate, 'macro|other@example.com'])
    ).toBeUndefined();
    expect(
      directMessageTeammate(owner, [owner, teammate, 'macro|other@example.com'])
    ).toBeUndefined();
    expect(
      directMessageTeammate(owner, [owner, 'macro|person@example.com'])
    ).toBeUndefined();
  });

  it('waits for the start of the timeline and selects exactly one teammate message', () => {
    const beforeGreeting = [
      { type: 'activity' },
      { type: 'message', message: { id: 'owner-message', sender_id: owner } },
    ] as const;
    const timeline = [
      ...beforeGreeting,
      { type: 'message', message: { id: 'greeting', sender_id: teammate } },
      { type: 'message', message: { id: 'later-answer', sender_id: teammate } },
    ] as const;

    expect(
      firstTeammateMessage(beforeGreeting, teammate, true)
    ).toBeUndefined();
    expect(
      firstTeammateMessage(timeline.slice(3), teammate, false)
    ).toBeUndefined();
    expect(firstTeammateMessage(timeline, teammate, true)).toBe('greeting');
    expect(firstTeammateMessage([...timeline], teammate, true)).toBe(
      'greeting'
    );
  });
});
