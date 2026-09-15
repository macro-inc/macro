import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { MACRO_AGENT_BOT_ID } from '@core/constant/macroAgent';
import { MACRO_CODER_BOT_ID } from '@core/constant/macroCoder';
import { describe, expect, it } from 'vitest';
import {
  agentKindNoun,
  isCoderHarness,
  kindForHarness,
  kindForMode,
  modeForKind,
  systemBotKind,
} from './agent-kind';

describe('isCoderHarness', () => {
  it('treats the in-process harnesses as chat', () => {
    expect(isCoderHarness('in-memory')).toBe(false);
    expect(isCoderHarness('macro-inmem')).toBe(false);
    expect(isCoderHarness(undefined)).toBe(false);
    expect(isCoderHarness('')).toBe(false);
  });

  it('treats every coding runtime as a coder', () => {
    expect(isCoderHarness('cursor')).toBe(true);
    expect(isCoderHarness('macrod')).toBe(true);
    expect(isCoderHarness('sandbox')).toBe(true);
    expect(kindForHarness('cursor')).toBe('coder');
    expect(kindForHarness('in-memory')).toBe('agent');
  });
});

describe('systemBotKind', () => {
  it('knows the first-party bots in either id form', () => {
    expect(systemBotKind(MACRO_AGENT_BOT_ID)).toBe('agent');
    expect(systemBotKind(MACRO_CODER_BOT_ID)).toBe('coder');
    expect(systemBotKind(`bot|${CURSOR_BOT_ID}`)).toBe('coder');
  });

  it('has no opinion about other bots', () => {
    expect(
      systemBotKind('11111111-1111-1111-1111-111111111111')
    ).toBeUndefined();
    expect(systemBotKind(undefined)).toBeUndefined();
  });
});

describe('modes and kinds', () => {
  it('round-trips', () => {
    expect(modeForKind(kindForMode('code'))).toBe('code');
    expect(modeForKind(kindForMode('chat'))).toBe('chat');
  });

  it('names the kind', () => {
    expect(agentKindNoun('coder')).toBe('coder');
    expect(agentKindNoun('agent', true)).toBe('agents');
  });
});
