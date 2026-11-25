import { describe, expect, it } from 'vitest';
import {
  APP_HANDOFF_MAX_AGE_MS,
  appHandoffFromParams,
  appSignInUrl,
  parseAppHandoff,
  serializeAppHandoff,
} from './app-handoff';

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const HANDOFF_ID = '01938f2e-7c4a-7b3e-9a51-2f6d8c0e4b17';
const NOW = 1_800_000_000_000;

describe('appHandoffFromParams', () => {
  it('reads the challenge and handoff id the app put on the link', () => {
    expect(
      appHandoffFromParams(
        { app_challenge: CHALLENGE, app_handoff: HANDOFF_ID },
        NOW
      )
    ).toEqual({ challenge: CHALLENGE, handoffId: HANDOFF_ID, savedAt: NOW });
  });

  it('ignores a link without a well-formed pair', () => {
    for (const params of [
      {},
      { app_challenge: CHALLENGE },
      { app_handoff: HANDOFF_ID },
      { app_challenge: `${CHALLENGE}=`, app_handoff: HANDOFF_ID },
      { app_challenge: CHALLENGE, app_handoff: 'not-a-uuid' },
      { app_challenge: [CHALLENGE], app_handoff: HANDOFF_ID },
    ])
      expect(appHandoffFromParams(params, NOW)).toBeUndefined();
  });
});

describe('parseAppHandoff', () => {
  const saved = serializeAppHandoff({
    challenge: CHALLENGE,
    handoffId: HANDOFF_ID,
    savedAt: NOW,
  });

  it('keeps a handoff for a day', () => {
    expect(parseAppHandoff(saved, NOW + APP_HANDOFF_MAX_AGE_MS)).toEqual({
      challenge: CHALLENGE,
      handoffId: HANDOFF_ID,
      savedAt: NOW,
    });
    expect(
      parseAppHandoff(saved, NOW + APP_HANDOFF_MAX_AGE_MS + 1)
    ).toBeUndefined();
  });

  it('reads nothing from missing or malformed storage', () => {
    expect(parseAppHandoff(null, NOW)).toBeUndefined();
    expect(parseAppHandoff('{', NOW)).toBeUndefined();
    expect(parseAppHandoff('{"challenge":"x"}', NOW)).toBeUndefined();
  });
});

describe('appSignInUrl', () => {
  it('names the code and the sign-up it redeems for', () => {
    const url = new URL(appSignInUrl('a+b/c', HANDOFF_ID));
    expect(url.protocol).toBe('macro:');
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('token')).toBe('a+b/c');
    expect(url.searchParams.get('app_handoff')).toBe(HANDOFF_ID);
  });
});
