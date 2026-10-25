import { HashRouter, Route } from '@solidjs/router';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createResource, Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicBookingShell } from './public-booking-shell';

const platform = vi.hoisted(() => ({ native: true }));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => platform.native,
}));

beforeEach(() => {
  platform.native = true;
  vi.stubGlobal('scrollTo', vi.fn());
  window.history.replaceState(null, '', '/app/#/app/book/team');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('native booking navigation', () => {
  it.each([
    ['/book/team', 'Choose an event'],
    ['/book/team/meeting', 'This booking page is unavailable.'],
    ['/booking/booking-id#private-token', 'Loading booking…'],
    ['/booking/booking-id#private-token', 'You’re booked'],
  ])(
    'returns from %s to the app without reloading (%s)',
    async (path, text) => {
      window.history.replaceState(null, '', `/app/#/app${path}`);
      const historyLength = window.history.length;
      render(() => (
        <HashRouter base="/app">
          <Route path="/" component={() => <h1>Macro home</h1>} />
          <Route
            path={['/book/*path', '/booking/:id']}
            component={() => (
              <PublicBookingShell>
                <p>{text}</p>
              </PublicBookingShell>
            )}
          />
        </HashRouter>
      ));

      expect(screen.getByText(text)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Back to Macro' }));

      expect(
        await screen.findByRole('heading', { name: 'Macro home' })
      ).toBeTruthy();
      expect(window.location.pathname).toBe('/app/');
      expect(window.location.hash).toBe('#/app');
      expect(window.history.length).toBe(historyLength);
    }
  );

  it('keeps the exit available while the booking content is suspended', async () => {
    function PendingPage() {
      const [page] = createResource(() => new Promise<string>(() => {}));
      return <p>{page()}</p>;
    }
    render(() => (
      <HashRouter base="/app">
        <Route path="/" component={() => <h1>Macro home</h1>} />
        <Route
          path="/book/*path"
          component={() => (
            <PublicBookingShell>
              <Suspense fallback={<p>Loading booking page…</p>}>
                <PendingPage />
              </Suspense>
            </PublicBookingShell>
          )}
        />
      </HashRouter>
    ));

    expect(screen.getByText('Loading booking page…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Macro' }));
    expect(
      await screen.findByRole('heading', { name: 'Macro home' })
    ).toBeTruthy();
  });

  it.each(['browser', 'embedded'])(
    'omits native chrome for %s pages',
    (surface) => {
      platform.native = surface !== 'browser';
      if (surface === 'embedded') vi.stubGlobal('parent', {});
      render(() => (
        <HashRouter base="/app">
          <Route
            path="/book/*path"
            component={() => (
              <PublicBookingShell>
                <p>Choose an event</p>
              </PublicBookingShell>
            )}
          />
        </HashRouter>
      ));

      expect(screen.getByText('Choose an event')).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: 'Back to Macro' })
      ).toBeNull();
    }
  );
});
