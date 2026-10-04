import { describe, expect, it, vi } from 'vitest';
import { parseMacroAppUrl, resolvePastedMacroAppUrl } from './textPastePlugin';

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

  it.each(['md', 'channel', 'task', 'pr', 'initiative'])(
    'preserves existing %s links',
    (block) => {
      expect(
        parseMacroAppUrl(`https://dev.macro.com/app/${block}/${sessionId}`)
      ).toEqual({ isValid: true, id: sessionId, block, params: {} });
    }
  );

  it('does not treat a legacy first pane as a complete legacy link', () => {
    expect(
      parseMacroAppUrl(
        `https://dev.macro.com/app/md/${sessionId}/~/drive/pdf/${sessionId}`
      ).isValid
    ).toBe(false);
  });

  it.each([
    'https://dev.macro.com/app/agents',
    'https://dev.macro.com/app/agents/not-a-uuid',
    `https://example.com/app/agents/${sessionId}`,
    `https://dev.macro.com/app/unknown-route/${sessionId}`,
  ])('does not convert invalid or foreign links: %s', (url) => {
    expect(parseMacroAppUrl(url).isValid).toBe(false);
  });
});

describe('route-aware paste resolver', () => {
  const resolveAppLink = vi.fn(() => ({
    id: sessionId,
    block: 'md' as const,
    params: {},
  }));

  it('uses the app resolver for routed links', () => {
    const url = `https://dev.macro.com/app/drive/md/${sessionId}`;
    expect(resolvePastedMacroAppUrl(url, resolveAppLink)).toEqual({
      id: sessionId,
      block: 'md',
      params: {},
    });
    expect(resolveAppLink).toHaveBeenCalledWith(url);
  });

  it('preserves legacy query parameters without consulting the app resolver', () => {
    resolveAppLink.mockClear();
    expect(
      resolvePastedMacroAppUrl(
        `https://dev.macro.com/app/md/${sessionId}?comment_id=target`,
        resolveAppLink
      )
    ).toEqual({
      isValid: true,
      id: sessionId,
      block: 'md',
      params: { comment_id: 'target' },
    });
    expect(resolveAppLink).not.toHaveBeenCalled();
  });

  it.each([
    ['call', 'call'],
    ['pr', 'pr'],
    ['agents', 'agent'],
  ])(
    'keeps legacy /app/%s links ahead of the route resolver',
    (route, block) => {
      resolveAppLink.mockClear();
      expect(
        resolvePastedMacroAppUrl(
          `https://dev.macro.com/app/${route}/${sessionId}`,
          resolveAppLink
        )
      ).toEqual({ isValid: true, id: sessionId, block, params: {} });
      expect(resolveAppLink).not.toHaveBeenCalled();
    }
  );

  it('delegates a copied layout with a legacy first pane to the route resolver', () => {
    const url = `https://dev.macro.com/app/md/${sessionId}/~/drive/pdf/${sessionId}`;
    const resolveLayout = vi.fn(() => ({
      id: sessionId,
      block: 'pdf' as const,
      params: {},
    }));
    expect(resolvePastedMacroAppUrl(url, resolveLayout)).toEqual({
      id: sessionId,
      block: 'pdf',
      params: {},
    });
    expect(resolveLayout).toHaveBeenCalledWith(url);
  });

  it('leaves unknown links unconverted without an app resolver', () => {
    expect(
      resolvePastedMacroAppUrl(
        `https://dev.macro.com/app/drive/md/${sessionId}`
      )
    ).toBeUndefined();
  });
});
