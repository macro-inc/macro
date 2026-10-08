import type { Link as EmailLink } from '@service-email/generated/schemas';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { onlineManager } from '@tanstack/query-core';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, type Ok, ok } from 'neverthrow';
import { Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailKeys } from './keys';
import { useDisableCalendarMutation, usePrimaryEmailLinkId } from './link';
import { mountEmailMutation } from './tests/mutation';

const disableLinkCalendarMock = vi.hoisted(() => vi.fn());
const getLinksMock = vi.hoisted(() => vi.fn());
const invalidateCalendarViewsMock = vi.hoisted(() => vi.fn());

vi.mock('@service-email/client', () => ({
  emailClient: {
    disableLinkCalendar: disableLinkCalendarMock,
    getLinks: getLinksMock,
  },
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

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

it('does not suspend an offline composer when its primary-inbox lookup resumes', async () => {
  testQueryClient.removeQueries({ queryKey: emailKeys.links.queryKey });
  onlineManager.setOnline(false);
  const { promise, resolve } =
    Promise.withResolvers<Ok<{ links: EmailLink[] }, unknown>>();
  getLinksMock.mockReturnValue(promise);
  const Composer = () => {
    const primary = usePrimaryEmailLinkId();
    return <input aria-label="Composer" data-inbox={primary()} />;
  };
  render(() => (
    <QueryClientProvider client={testQueryClient}>
      <Suspense fallback={<div>Hidden composer</div>}>
        <Composer />
      </Suspense>
    </QueryClientProvider>
  ));
  const editor = screen.getByRole('textbox');
  onlineManager.setOnline(true);
  await vi.waitFor(() => expect(getLinksMock).toHaveBeenCalledOnce());
  expect(screen.queryByRole('textbox')).toBe(editor);
  resolve(ok({ links: [{ ...link('primary'), is_primary: true }] }));
  await vi.waitFor(() =>
    expect(editor.getAttribute('data-inbox')).toBe('primary')
  );
  expect(screen.getByRole('textbox')).toBe(editor);
});

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
  it('does not offer re-enable while the server is still deleting calendar data', async () => {
    let finish!: (value: Ok<Record<string, never>, never>) => void;
    disableLinkCalendarMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const disable = mountEmailMutation(
      useDisableCalendarMutation,
      testQueryClient
    );
    const pending = disable.mutateAsync('inbox-a');
    await vi.waitFor(() =>
      expect(disableLinkCalendarMock).toHaveBeenCalledOnce()
    );
    expect(disable.isPending).toBe(true);
    expect(cachedLink('inbox-a')).toMatchObject({
      calendar_disabled: false,
      needs_calendar_permission: false,
      has_calendar_data: true,
    });
    finish(ok({}));
    await pending;
    expect(cachedLink('inbox-a')).toMatchObject({
      calendar_disabled: true,
      needs_calendar_permission: true,
      has_calendar_data: false,
    });
  });

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

  it('keeps the previous links when the request fails', async () => {
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
