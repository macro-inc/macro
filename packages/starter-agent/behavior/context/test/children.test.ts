import { describe, expect, test } from 'bun:test';
import {
  anthropicUpstream,
  childEnvironment,
  claudeAccess,
} from '../children.ts';

const parent = {
  PATH: '/run/current-system/sw/bin',
  HOME: '/home/macro/agent',
  LANG: 'C.UTF-8',
  TZ: 'UTC',
  DISPLAY: ':1',
  PULSE_SERVER: 'unix:/run/pulse',
  XDG_RUNTIME_DIR: '/run/user/1000',
  MUPPET_BROWSER_CDP_URL: 'http://127.0.0.1:9223',
  MACRO_API_KEY: 'mak_secret',
  CREDENTIALS_DIRECTORY: '/run/credentials/macro-agent.service',
  MUPPET_CREDENTIALS_FILE: '/run/credentials/macro-agent.service/agent.env',
  AWS_SECRET_ACCESS_KEY: 'other',
};

describe('childEnvironment', () => {
  test('passes only the baseline, never the parent wholesale', () => {
    expect(childEnvironment(parent)).toEqual({
      PATH: '/run/current-system/sw/bin',
      HOME: '/home/macro/agent',
      LANG: 'C.UTF-8',
      TZ: 'UTC',
      DISPLAY: ':1',
      PULSE_SERVER: 'unix:/run/pulse',
      XDG_RUNTIME_DIR: '/run/user/1000',
      MUPPET_BROWSER_CDP_URL: 'http://127.0.0.1:9223',
    });
  });

  test('adds what the caller asks for, and drops what it unsets', () => {
    expect(
      childEnvironment(
        { PATH: '/bin', DISPLAY: ':1' },
        { GIT_TERMINAL_PROMPT: '0', DISPLAY: undefined }
      )
    ).toEqual({ PATH: '/bin', GIT_TERMINAL_PROMPT: '0' });
  });
});

describe('claudeAccess', () => {
  const relay = { url: 'http://127.0.0.1:41234', token: 'capability' };

  test('in Macro-credits mode, Claude reaches the gateway through the relay, never with the real token', () => {
    const access = claudeAccess(
      {
        MACRO_API_KEY: 'mak_secret',
        ANTHROPIC_BASE_URL: 'https://egress/brain/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'mak_secret',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        CLAUDE_CODE_OAUTH_TOKEN: 'never',
      },
      relay
    );
    expect(access).toEqual({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:41234/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'capability',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    });
    expect(JSON.stringify(access)).not.toContain('mak_secret');
  });

  test('without them, nothing: the claude wrapper signs in itself', () => {
    expect(claudeAccess({ MACRO_API_KEY: 'mak_secret' }, relay)).toEqual({});
  });
});

describe('anthropicUpstream', () => {
  test('is the gateway and its token in Macro-credits mode, and nothing otherwise', () => {
    expect(
      anthropicUpstream({
        ANTHROPIC_BASE_URL: 'https://egress/brain/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'mak_secret',
      })
    ).toEqual({ url: 'https://egress/brain/anthropic', token: 'mak_secret' });
    expect(anthropicUpstream({ MACRO_API_KEY: 'mak_secret' })).toBeUndefined();
  });
});
