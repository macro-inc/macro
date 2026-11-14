import { describe, expect, it } from 'vitest';
import {
  inviteBlocker,
  type TeamAgentDraft,
  teamAgentDraftProblems,
  teamAgentRequest,
} from './team-agent-draft';

describe('team agent draft', () => {
  it('sends a trimmed request once every field is filled in', () => {
    const request = teamAgentRequest({
      name: '  Ada ',
      jobDescription: ' Triage support email. ',
      personality: ' Warm and concise. ',
      size: 'large',
      avatarUrl: undefined,
      purchaseKey: 'purchase-1',
    });

    expect(request).toEqual({
      name: 'Ada',
      jobDescription: 'Triage support email.',
      personality: 'Warm and concise.',
      size: 'large',
      avatarUrl: null,
      purchaseKey: 'purchase-1',
    });
  });

  it('sends the picked voice, and leaves it out when none is picked', () => {
    const draft: TeamAgentDraft = {
      name: 'Ada',
      jobDescription: 'Triage support email.',
      personality: 'Warm and concise.',
      size: 'standard',
      avatarUrl: undefined,
      purchaseKey: 'purchase-1',
    };

    expect(teamAgentRequest({ ...draft, voice: 'aura-2-thalia-en' })).toEqual({
      name: 'Ada',
      jobDescription: 'Triage support email.',
      personality: 'Warm and concise.',
      size: 'standard',
      avatarUrl: null,
      purchaseKey: 'purchase-1',
      voice: 'aura-2-thalia-en',
    });
    expect(teamAgentRequest(draft)).not.toHaveProperty('voice');
  });

  it('requires a name, job description, personality and size', () => {
    const draft = {
      name: '   ',
      jobDescription: '',
      personality: '\n',
      size: undefined,
      avatarUrl: undefined,
      purchaseKey: 'purchase-1',
    };

    expect(teamAgentDraftProblems(draft)).toEqual({
      name: 'required',
      jobDescription: 'required',
      personality: 'required',
      size: 'required',
    });
    expect(teamAgentRequest(draft)).toBeUndefined();
  });

  it('counts characters the way the server does, not UTF-16 units', () => {
    // 64 emoji are 128 UTF-16 units but 64 characters: within the limit.
    const sixtyFourEmoji = '🤖'.repeat(64);
    const draft: TeamAgentDraft = {
      name: sixtyFourEmoji,
      jobDescription: 'x'.repeat(4000),
      personality: 'y'.repeat(4001),
      size: 'standard',
      avatarUrl: 'https://static.macro.com/file/avatar',
      purchaseKey: 'purchase-1',
    };

    expect(teamAgentDraftProblems(draft)).toEqual({ personality: 'too_long' });
    expect(
      teamAgentDraftProblems({ ...draft, name: `${sixtyFourEmoji}!` }).name
    ).toBe('too_long');
    expect(teamAgentRequest(draft)).toBeUndefined();
  });
});

describe('inviteBlocker', () => {
  it('names the first thing to fix: missing fields, then long ones, then the size', () => {
    expect(
      inviteBlocker({
        name: 'required',
        personality: 'too_long',
        size: 'required',
      })
    ).toBe('fields');
    expect(inviteBlocker({ personality: 'too_long', size: 'required' })).toBe(
      'too_long'
    );
    expect(inviteBlocker({ size: 'required' })).toBe('size');
    expect(inviteBlocker({})).toBeUndefined();
  });
});
