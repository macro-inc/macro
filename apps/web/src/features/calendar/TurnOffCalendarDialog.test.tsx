/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnOffCalendarDialog } from './TurnOffCalendarDialog';

const disableLinkCalendarMock = vi.hoisted(() => vi.fn());

vi.mock('@service-email/client', () => ({
  emailClient: { disableLinkCalendar: disableLinkCalendarMock },
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));

vi.mock('@core/context/user', () => ({ useUserId: () => () => 'macro|self' }));
vi.mock('@queries/calendar/sync', () => ({
  invalidateCalendarViews: vi.fn(),
}));
vi.mock('@queries/auth/user-info', () => ({ invalidateUserInfo: vi.fn() }));
vi.mock('@queries/soup/normalized-cache', () => ({
  invalidateAllSoup: vi.fn(),
}));

let testQueryClient: QueryClient;

vi.mock('@queries/client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

function renderDialog(onClose = vi.fn()) {
  render(() => (
    <QueryClientProvider client={testQueryClient}>
      <TurnOffCalendarDialog
        target={{ linkId: 'inbox-a', emailAddress: 'self@example.com' }}
        onClose={onClose}
      />
    </QueryClientProvider>
  ));
  return onClose;
}

describe('TurnOffCalendarDialog', () => {
  it('names the inbox it is about', () => {
    renderDialog();

    expect(screen.getByText('self@example.com')).toBeTruthy();
  });

  it('turns calendar off for the confirmed inbox and closes', async () => {
    disableLinkCalendarMock.mockResolvedValue(ok({}));
    const onClose = renderDialog();

    screen.getByRole('button', { name: 'Turn off' }).click();
    await vi.waitFor(() =>
      expect(disableLinkCalendarMock).toHaveBeenCalledWith({
        linkId: 'inbox-a',
      })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('leaves the calendar alone when cancelled', () => {
    const onClose = renderDialog();

    screen.getByRole('button', { name: 'Cancel' }).click();

    expect(disableLinkCalendarMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
