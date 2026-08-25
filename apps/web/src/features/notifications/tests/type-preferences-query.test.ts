import { QueryClient, QueryObserver } from '@tanstack/query-core';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_NOTIFICATION_TYPE_PREFERENCES,
  notificationTypePreferencesPlaceholder,
} from '../notification-preferences-placeholder';

const PREFERENCES_KEY = ['notification', 'preferences'] as const;

function hangingPreferences() {
  return new Promise<typeof EMPTY_NOTIFICATION_TYPE_PREFERENCES>(() => {
    /* stay pending so the observer is fetching */
  });
}

describe('notificationTypePreferencesPlaceholder', () => {
  it('uses an empty disabled list when nothing is cached', () => {
    expect(notificationTypePreferencesPlaceholder(undefined)).toEqual(
      EMPTY_NOTIFICATION_TYPE_PREFERENCES
    );
  });

  it('keeps the last disabled list', () => {
    expect(
      notificationTypePreferencesPlaceholder({
        disabled_types: ['channel_mention'],
      })
    ).toEqual({ disabled_types: ['channel_mention'] });
  });

  it('does not report isLoading on first fetch', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const observer = new QueryObserver(client, {
      queryKey: PREFERENCES_KEY,
      queryFn: hangingPreferences,
      placeholderData: notificationTypePreferencesPlaceholder,
    });

    const result = observer.getCurrentResult();
    expect(result.isLoading).toBe(false);
    expect(result.isPlaceholderData).toBe(true);
    expect(result.data).toEqual(EMPTY_NOTIFICATION_TYPE_PREFERENCES);

    observer.destroy();
    client.clear();
  });

  it('keeps the last disabled types while a refetch is in flight', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const cached = { disabled_types: ['channel_mention'] };
    client.setQueryData(PREFERENCES_KEY, cached);

    const observer = new QueryObserver(client, {
      queryKey: PREFERENCES_KEY,
      queryFn: hangingPreferences,
      placeholderData: notificationTypePreferencesPlaceholder,
    });
    observer.subscribe(() => {
      /* keep the observer active so invalidate refetches */
    });

    void client.invalidateQueries({ queryKey: PREFERENCES_KEY });
    await Promise.resolve();

    const result = observer.getCurrentResult();
    expect(result.isLoading).toBe(false);
    expect(result.data).toEqual(cached);

    observer.destroy();
    client.clear();
  });
});
