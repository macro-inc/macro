import { describe, expect, it, vi } from 'vitest';
import { parseMacroAppUrl } from './textPastePlugin';

// Keep the parser tests independent of application boot and editor UI wiring.
vi.mock('@core/internal/BlockLoader', () => ({}));
vi.mock('../../utils', () => ({}));
vi.mock('../mentions', () => ({}));

const sessionId = '019507e8-14a3-7bc1-8610-419f16bd03a8';

describe('parseMacroAppUrl', () => {
  it.each(['agents', 'agent'])(
    'recognizes %s session links as agent mentions',
    (route) => {
      expect(
        parseMacroAppUrl(
          `https://dev.macro.com/app/${route}/${sessionId}?message=target&referral_code=ignored`
        )
      ).toEqual({
        isValid: true,
        id: sessionId,
        block: 'agent',
        params: { message: 'target' },
      });
    }
  );

  it.each(['md', 'channel', 'task', 'pr'])(
    'preserves existing %s links',
    (block) => {
      expect(
        parseMacroAppUrl(`https://dev.macro.com/app/${block}/${sessionId}`)
      ).toEqual({ isValid: true, id: sessionId, block, params: {} });
    }
  );

  it.each([
    'https://dev.macro.com/app/agents',
    'https://dev.macro.com/app/agents/not-a-uuid',
    `https://example.com/app/agents/${sessionId}`,
    `https://dev.macro.com/app/unknown-route/${sessionId}`,
  ])('does not convert invalid or foreign links: %s', (url) => {
    expect(parseMacroAppUrl(url).isValid).toBe(false);
  });
});
