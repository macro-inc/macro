import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('../../features/setup/Homepage', () => ({
  Homepage: () => <h1>Homepage</h1>,
}));
vi.mock('../../features/marketing/views/ProductChannelsPage', () => ({
  RouteChannels: () => <h1>Channels</h1>,
}));
vi.mock('../utils/utilFavicon', () => ({ utilFaviconEffect: () => {} }));
vi.mock('../../lib/theme/utils/themeUtils', () => ({
  systemThemeEffect: () => {},
  applyTheme: () => {},
}));
vi.mock('../../features/marketing/components/DemoMentionMenu', () => ({
  DemoMentionMenu: () => null,
}));
vi.mock('../components/dialogs/DialogTheme', () => ({
  DialogTheme: () => null,
}));
vi.mock('../../features/marketing/components/DemoBookingDialog', () => ({
  DemoBookingDialog: () => null,
}));

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 768px)',
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('scrollTo', () => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps the same sidebar and search field when navigating Home to Chat and back', async () => {
  render(() => <App />);
  const nav = screen.getByRole('navigation', { name: 'Main navigation' });
  const search = within(nav).getByRole('searchbox');
  fireEvent.click(within(nav).getByRole('link', { name: 'Chat' }));
  await screen.findByRole('heading', { name: 'Channels' });
  expect(window.location.pathname).toBe('/channels');
  expect(screen.getByRole('navigation')).toBe(nav);
  fireEvent.click(within(nav).getAllByRole('link', { name: 'Home' })[0]);
  await screen.findByRole('heading', { name: 'Homepage' });
  await waitFor(() => expect(window.location.pathname).toBe('/'));
  expect(screen.getByRole('navigation')).toBe(nav);
  expect(within(nav).getByRole('searchbox')).toBe(search);
});
