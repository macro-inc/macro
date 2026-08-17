import type { Link as EmailLink } from '@service-email/generated/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailKeys } from './keys';
import { useDisableCalendarMutation } from './link';

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
  }) as unknown as EmailLink;

const cachedLinks = () =>
  testQueryClient.getQueryData<{ links: EmailLink[] }>(emailKeys.links.queryKey)
    ?.links ?? [];

const cachedLink = (id: string) => cachedLinks().find((it) => it.id === id);

let dispose: (() => void) | undefined;

function renderHook<T>(factory: () => T): T {
  let hook!: T;
  dispose = render(
    () => (
      <QueryClientProvider client={testQueryClient}>
        {(() => {
          hook = factory();
          return null as unknown as JSX.Element;
        })()}
      </QueryClientProvider>
    ),
    document.body
  );
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  testQueryClient.setQueryData(emailKeys.links.queryKey, {
    links: [link('inbox-a'), link('inbox-b')],
  });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  testQueryClient.clear();
});

describe('useDisableCalendarMutation', () => {
  it('marks only the target inbox as deliberately calendar-less', async () => {
    disableLinkCalendarMock.mockResolvedValue(ok({}));
    const disable = renderHook(() => useDisableCalendarMutation());

    await disable.mutateAsync('inbox-a');

    expect(cachedLink('inbox-a')).toMatchObject({
      calendar_disabled: true,
      needs_calendar_permission: true,
    });
    expect(cachedLink('inbox-b')).toMatchObject({
      calendar_disabled: false,
      needs_calendar_permission: false,
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
    const disable = renderHook(() => useDisableCalendarMutation());

    await expect(disable.mutateAsync('inbox-a')).rejects.toThrow();

    expect(cachedLink('inbox-a')).toMatchObject({
      calendar_disabled: false,
      needs_calendar_permission: false,
    });
    expect(invalidateCalendarViewsMock).not.toHaveBeenCalled();
  });
});
