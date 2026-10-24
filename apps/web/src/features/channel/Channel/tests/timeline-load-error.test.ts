import { ThrownResultError } from '@core/util/result';
import { describe, expect, it } from 'vitest';
import { timelineLoadError } from '../timeline-load-error';

const failure = (code: string) =>
  new ThrownResultError([{ code, message: code }]);

describe('channel timeline load error', () => {
  it('keeps loaded messages through a failed refresh or older page', () => {
    for (const code of ['SERVER_ERROR', 'NETWORK_ERROR', 'NOT_FOUND'])
      expect(
        timelineLoadError({ error: failure(code), isLoadingError: false })
      ).toBeUndefined();
  });

  it('closes loaded messages once a refresh says access was lost', () => {
    expect(
      timelineLoadError({
        error: failure('UNAUTHORIZED'),
        isLoadingError: false,
      })
    ).toBe('UNAUTHORIZED');
    expect(
      timelineLoadError({ error: failure('FORBIDDEN'), isLoadingError: false })
    ).toBe('FORBIDDEN');
  });

  it('reports every failure of the first load', () => {
    expect(
      timelineLoadError({
        error: failure('SERVER_ERROR'),
        isLoadingError: true,
      })
    ).toBe('LOAD_FAILED');
    expect(timelineLoadError({ error: null, isLoadingError: false })).toBe(
      undefined
    );
  });
});
