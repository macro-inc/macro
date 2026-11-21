/** @vitest-environment jsdom */
import { ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { inboxSuggestionQueryOptions } from './link';

const mocks = vi.hoisted(() => ({
  suggestion: vi.fn(),
  providers: vi.fn(),
  assertAccount: vi.fn(),
}));
vi.mock('@service-email/client', () => ({
  emailClient: { imapSuggestion: mocks.suggestion },
}));
vi.mock('@queries/auth/outlook-link', () => ({
  fetchEmailConnectionProviders: mocks.providers,
}));
vi.mock('@queries/auth/account-scope', () => ({
  assertQueryAccount: mocks.assertAccount,
  currentQueryAccount: () => undefined,
  isCurrentQueryAccount: () => true,
  mutationQueryAccount: () => undefined,
}));
beforeEach(() => vi.resetAllMocks());
const viewer = { userId: 'macro|owner@example.com', session: 1 };

it.each([false, true])(
  'respects Outlook enrollment capability after an MX hint (%s)',
  async (available) => {
    mocks.suggestion.mockResolvedValue(
      ok({ email: 'owner@example.com', offer: 'outlook' })
    );
    mocks.providers.mockResolvedValue({
      gmail: true,
      outlook: available,
      imap: true,
    });
    const options = inboxSuggestionQueryOptions(viewer, true);
    const result = await options.queryFn({
      signal: new AbortController().signal,
    });
    expect(result.offer).toBe(available ? 'outlook' : 'none');
    expect(mocks.providers).toHaveBeenCalledTimes(1);
  }
);

it('never authorizes OAuth when provider capabilities fail to load', async () => {
  mocks.suggestion.mockResolvedValue(
    ok({ email: 'owner@example.com', offer: 'outlook' })
  );
  mocks.providers.mockRejectedValue(new Error('capability read failed'));
  const options = inboxSuggestionQueryOptions(viewer, true);
  await expect(
    options.queryFn({ signal: new AbortController().signal })
  ).rejects.toThrow('capability read failed');
});

it('keeps a known Fastmail IMAP suggestion without an OAuth capability request', async () => {
  mocks.suggestion.mockResolvedValue(
    ok({ email: 'owner@example.com', offer: 'imap' })
  );
  const result = await inboxSuggestionQueryOptions(viewer, true).queryFn({
    signal: new AbortController().signal,
  });
  expect(result.offer).toBe('imap');
  expect(mocks.providers).not.toHaveBeenCalled();
});

it('separates capability-backed suggestions across sessions of the same account', () => {
  expect(inboxSuggestionQueryOptions(viewer, true).queryKey).not.toEqual(
    inboxSuggestionQueryOptions({ ...viewer, session: 2 }, true).queryKey
  );
});

it('rejects a suggestion if the account changes during capability loading', async () => {
  mocks.suggestion.mockResolvedValue(
    ok({ email: 'owner@example.com', offer: 'outlook' })
  );
  mocks.providers.mockResolvedValue({ gmail: true, outlook: true, imap: true });
  mocks.assertAccount
    .mockImplementationOnce(() => {})
    .mockImplementationOnce(() => {})
    .mockImplementationOnce(() => {
      throw new Error('stale account');
    });
  await expect(
    inboxSuggestionQueryOptions(viewer, true).queryFn({
      signal: new AbortController().signal,
    })
  ).rejects.toThrow('stale account');
});
