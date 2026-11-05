import { describe, expect, it } from 'vitest';
import { AGENT_SETUP_PATH, postAuthTarget } from './post-auth-target';

const newUser = {
  tutorialComplete: false,
  isAgent: false,
  onboardsOnThisDevice: true,
};
const returningUser = { ...newUser, tutorialComplete: true };

describe('postAuthTarget', () => {
  it('sends a new invitee to the team invite before onboarding', () => {
    expect(
      postAuthTarget({ ...newUser, redirect: '/team-invite?id=abc' })
    ).toEqual({ t: 'navigate', to: '/team-invite?id=abc' });
  });

  it('sends a new invitee to a channel invite before onboarding', () => {
    expect(
      postAuthTarget({ ...newUser, redirect: '/channel-invite?id=abc' })
    ).toEqual({ t: 'navigate', to: '/channel-invite?id=abc' });
  });

  it('carries any other deep link through onboarding as next', () => {
    expect(postAuthTarget({ ...newUser, redirect: '/meet/new' })).toEqual({
      t: 'onboarding',
      next: '/meet/new',
    });
  });

  it('onboards without a deep link', () => {
    expect(postAuthTarget({ ...newUser, redirect: undefined })).toEqual({
      t: 'onboarding',
      next: undefined,
    });
  });

  it('returns an onboarded user to the deep link', () => {
    expect(
      postAuthTarget({ ...returningUser, redirect: '/team-invite?id=abc' })
    ).toEqual({ t: 'navigate', to: '/team-invite?id=abc' });
  });

  it('lands an onboarded user on Home without a deep link', () => {
    expect(postAuthTarget({ ...returningUser, redirect: undefined })).toEqual({
      t: 'navigate',
      to: '/',
    });
  });

  it.each<[unknown]>([
    ['https://evil.example/team-invite'],
    ['//evil.example/team-invite'],
    ['/\\evil.example'],
    ['team-invite?id=abc'],
    [['/team-invite?id=abc']],
  ])('ignores an unsafe redirect %o', (redirect) => {
    expect(postAuthTarget({ ...returningUser, redirect })).toEqual({
      t: 'navigate',
      to: '/',
    });
  });

  it('does not treat a lookalike path as an invite', () => {
    expect(
      postAuthTarget({ ...newUser, redirect: '/team-invites-archive' })
    ).toEqual({ t: 'onboarding', next: '/team-invites-archive' });
  });

  it('skips desktop onboarding on mobile and honors the deep link', () => {
    expect(
      postAuthTarget({
        ...newUser,
        onboardsOnThisDevice: false,
        redirect: '/meet/new',
      })
    ).toEqual({ t: 'navigate', to: '/meet/new' });
  });

  it('sends an agent that has not finished setup to agent setup', () => {
    expect(
      postAuthTarget({
        ...newUser,
        isAgent: true,
        redirect: '/team-invite?id=abc',
      })
    ).toEqual({ t: 'navigate', to: AGENT_SETUP_PATH });
  });
});
