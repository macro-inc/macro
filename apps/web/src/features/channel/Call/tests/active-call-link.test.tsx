/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { errAsync, okAsync } from 'neverthrow';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveCallLink } from '../ActiveCallLink';

const mocks = vi.hoisted(() => ({
  getCallLink: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock('@service-call/client', () => ({
  callServiceClient: { getCallLink: mocks.getCallLink },
}));
vi.mock('../CallContext', () => ({
  useCallContext: () => ({ activeCallId: () => 'call-id' }),
}));
vi.mock('../../../meetings/use-quick-calls-flag', () => ({
  useQuickCallsFlag: () => () => ({ loading: false, enabled: true }),
}));
vi.mock('@ui', async () => ({
  ...(await import('../../../../components/ui/components/Button')),
  Tooltip: (props: { children: JSX.Element }) => props.children,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCallLink.mockReturnValue(okAsync({ shareToken: 'share-token' }));
  mocks.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.writeText },
  });
});
afterEach(cleanup);

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(() => (
    <QueryClientProvider client={client}>
      <ActiveCallLink />
    </QueryClientProvider>
  ));
  return screen.getByRole('button', { name: 'Copy Meeting Url' });
}

describe('channel call link', () => {
  it('creates and copies a link only after an explicit click', async () => {
    const button = setup();
    expect(mocks.getCallLink).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.writeText).toHaveBeenCalledWith(
        expect.stringContaining('/app/meet/join/share-token')
      )
    );
    expect(mocks.getCallLink).toHaveBeenCalledWith('call-id');
    expect(screen.getByRole('status').textContent).toBe('Meeting URL copied');
  });

  it('offers a retry when loading the link fails', async () => {
    mocks.getCallLink.mockReturnValueOnce(
      errAsync([{ code: 'UNAVAILABLE', message: 'Unavailable' }])
    );
    const button = setup();
    fireEvent.click(button);
    await screen.findByText('Could not load call link. Try again.');
    expect(mocks.writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledTimes(1));
  });

  it('provides a selectable URL when clipboard access fails', async () => {
    mocks.writeText.mockRejectedValue(new Error('Clipboard denied'));
    fireEvent.click(setup());
    const input = await screen.findByRole('textbox', { name: 'Call link' });
    expect((input as HTMLInputElement).value).toContain(
      '/app/meet/join/share-token'
    );
  });
});
