// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { expect, it, vi } from 'vitest';
import { type ConnectScreen, ScreenProvider } from '../context/screen-context';
import { ScreenPane } from './screen-pane';

it.each([
  { edit: false, touch: false },
  { edit: true, touch: true },
])('hides Take control for %j', ({ edit, touch }) => {
  render(() => (
    <ScreenProvider
      value={{
        host: {
          sessionId: () => 'session',
          harnessId: () => undefined,
          canEdit: () => edit,
          touch: () => touch,
          resolveUrl: async () => '',
        },
        available: () => true,
        open: () => true,
        setOpen: vi.fn(),
      }}
    >
      <ScreenPane connect={async () => ({ disconnect: vi.fn() })} />
    </ScreenProvider>
  ));
  expect(screen.queryByRole('button', { name: 'Take control' })).toBeNull();
});

it('uses the real computer title and recovers from a disconnected empty state through Retry', async () => {
  const connect = vi
    .fn<ConnectScreen>()
    .mockImplementationOnce(async (_target, _url, _control, events) => {
      events.disconnected();
      return { disconnect: vi.fn() };
    })
    .mockImplementation(async (_target, _url, _control, events) => {
      events.connected();
      return { disconnect: vi.fn() };
    });
  render(() => (
    <ScreenProvider
      value={{
        host: {
          sessionId: () => 'session',
          harnessId: () => 'runtime',
          title: () => 'Research computer',
          canEdit: () => true,
          touch: () => false,
          resolveUrl: async () => 'wss://example.invalid/screen',
        },
        available: () => true,
        open: () => true,
        setOpen: vi.fn(),
      }}
    >
      <ScreenPane connect={connect} />
    </ScreenProvider>
  ));
  await screen.findByRole('heading', { name: 'Computer disconnected' });
  expect(screen.getByText('Research computer')).toBeTruthy();
  expect(screen.getByText('Watching')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      screen.queryByRole('heading', { name: 'Computer disconnected' })
    ).toBeNull()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Take control' }));
  await screen.findByText('In control');
});
