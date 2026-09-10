import type { Link as EmailLink } from '@service-email/generated/schemas';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emailKeys } from './keys';
import { useDisableCalendarMutation } from './link';
import { mountEmailMutation } from './tests/mutation';

const disableLinkCalendarMock = vi.hoisted(() => vi.fn());
const invalidateCalendarViewsMock = vi.hoisted(() => vi.fn());

vi.mock('@service-email/client', () => ({
  emailClient: { disableLinkCalendar: disableLinkCalendarMock },
}));

vi.mock('@queries/calendar/sync', () => ({
  invalidateCalendarViews: invalidateCalendarViewsMock,
}));

vi.mock('@queries/auth/user-info', () => ({ invalidateUserInfo: vi.fn() }));
vi.mock('@queries/soup/normalized-cache', () => ({
  invalidateAllSoup: vi.fn(),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'macro|self' }));

let testQueryClient: QueryClient;

vi.mock('../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

const link = (id: string): EmailLink =>
  ({
    id,
    macro_id: 'macro|self',
    email_address: `${id}@example.com`,
    needs_calendar_permission: false,
    calendar_disabled: false,
    has_calendar_data: true,
  }) as unknown as EmailLink;

const cachedLinks = () =>
  testQueryClient.getQueryData<{ links: EmailLink[] }>(emailKeys.links.queryKey)
    ?.links ?? [];

const cachedLink = (id: string) => cachedLinks().find((it) => it.id === id);

beforeEach(() => {
  vi.clearAllMocks();
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  testQueryClient.setQueryData(emailKeys.links.queryKey, {
    links: [link('inbox-a'), link('inbox-b')],
  });
});

describe('useDisableCalendarMutation', () => {
  it('marks only the target inbox as deliberately calendar-less', async () => {
    disableLinkCalendarMock.mockResolvedValue(ok({}));
    const disable = mountEmailMutation(
      useDisableCalendarMutation,
      testQueryClient
    );

    await disable.mutateAsync('inbox-a');

    expect(cachedLink('inbox-a')).toMatchObject({
      calendar_disabled: true,
      needs_calendar_permission: true,
      has_calendar_data: false,
    });
    expect(cachedLink('inbox-b')).toMatchObject({
      calendar_disabled: false,
      needs_calendar_permission: false,
      has_calendar_data: true,
    });
    expect(disableLinkCalendarMock).toHaveBeenCalledWith({
      linkId: 'inbox-a',
    });
    expect(invalidateCalendarViewsMock).toHaveBeenCalledTimes(1);
  });

  it('restores the previous links when the request fails', async () => {
    disableLinkCalendarMock.mockResolvedValue(
      err([{ code: 'HTTP_ERROR' as const, message: 'nope' }])
    );
    const disable = mountEmailMutation(
      useDisableCalendarMutation,
      testQueryClient
    );

    await expect(disable.mutateAsync('inbox-a')).rejects.toThrow();

    expect(cachedLink('inbox-a')).toMatchObject({
      calendar_disabled: false,
      needs_calendar_permission: false,
      has_calendar_data: true,
    });
    expect(invalidateCalendarViewsMock).not.toHaveBeenCalled();
  });
});
