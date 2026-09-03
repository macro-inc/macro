import { ThrownResultError } from '@core/util/result';
import { describe, expect, it } from 'vitest';
import {
  GITHUB_TOO_MANY_PENDING_LINKS_MESSAGE,
  githubLinkStartFailureMessage,
} from './github-link';

describe('githubLinkStartFailureMessage', () => {
  const fallback = 'Failed to start GitHub connect flow';

  it('names the 24-hour wait when too many links are already in progress', () => {
    const error = new ThrownResultError([
      {
        code: 'TOO_MANY_PENDING_LINKS',
        message: 'Too many pending connections',
      },
    ]);

    expect(githubLinkStartFailureMessage(error, fallback)).toBe(
      GITHUB_TOO_MANY_PENDING_LINKS_MESSAGE
    );
  });

  it('keeps the fallback for other failures', () => {
    const error = new ThrownResultError([
      { code: 'HTTP_ERROR', message: 'HTTP error! status: 500' },
    ]);

    expect(githubLinkStartFailureMessage(error, fallback)).toBe(fallback);
  });
});
