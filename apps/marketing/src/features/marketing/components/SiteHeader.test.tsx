import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SiteHeader } from './SiteHeader';

vi.mock('./DemoBookingDialog', () => ({ DemoBookingDialog: () => null }));
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('opens a searchable documentation sidebar on click and restores focus on Escape', async () => {
  render(() => <SiteHeader />);
  const toggle = screen.getByRole('button', { name: 'Open navigation' });
  expect(screen.queryByRole('navigation')).toBeNull();
  fireEvent.click(toggle);
  const nav = screen.getByRole('navigation', { name: 'Main navigation' });
  const search = within(nav).getByRole('searchbox');
  fireEvent.input(search, { target: { value: 'MCP Setup' } });
  expect(
    (await within(nav).findByRole('link', { name: /MCP Setup/ })).getAttribute(
      'href'
    )
  ).toBe('/docs/AI/mcp/overview');
  expect(
    within(nav).queryByRole('link', { name: 'Welcome to Macro' })
  ).toBeNull();
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(search).toHaveProperty('value', '');
  expect(document.activeElement).toBe(search);
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(screen.queryByRole('navigation')).toBeNull();
  expect(document.activeElement).toBe(toggle);
});

it('opens and focuses search with Command or Control K/F, and navigates results', async () => {
  render(() => <SiteHeader />);
  for (const modifier of ['metaKey', 'ctrlKey']) {
    for (const key of ['k', 'f']) {
      const event = new KeyboardEvent('keydown', {
        key,
        [modifier]: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      const search = screen.getByRole('searchbox');
      expect(document.activeElement).toBe(search);
      fireEvent.input(search, { target: { value: 'calednar' } });
      await screen.findByRole('link', { name: /^Calendar Features$/ });
      fireEvent.keyDown(search, { key: 'ArrowDown' });
      expect(document.activeElement?.getAttribute('href')).toBe('/calendar');
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
      expect(document.activeElement).toBe(search);
      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
      expect(search).toHaveProperty('value', '');
      expect(document.activeElement).toBe(search);
    }
  }
});

it('keeps desktop navigation open across content clicks and page mounts', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 768px)',
  }));
  render(() => <SiteHeader currentPath="/docs/product/email" />);
  expect(screen.queryByRole('button', { name: 'Close navigation' })).toBeNull();
  expect(
    screen.getByRole('link', { current: 'page' }).getAttribute('aria-current')
  ).toBe('page');
  fireEvent.pointerDown(document.body);
  expect(screen.getByRole('navigation')).toBeTruthy();
  localStorage.setItem('macro-website-navigation-open', 'false');
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
  expect(screen.getByRole('navigation')).toBeTruthy();
  cleanup();
  render(() => <SiteHeader currentPath="/email" />);
  expect(screen.getByRole('navigation')).toBeTruthy();
});

it('keeps the mobile guide visible until navigation is opened', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-width: 767px)',
  }));
  render(() => <SiteHeader currentPath="/docs/product/email" />);
  expect(screen.queryByRole('navigation')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  expect(screen.getByRole('navigation')).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'Pricing' }));
  expect(screen.queryByRole('navigation')).toBeNull();
});

it('routes feature discovery to visual pages while keeping full guides accessible', async () => {
  render(() => <SiteHeader currentPath="/docs/product/email" />);
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  const nav = screen.getByRole('navigation');
  const emailLinks = within(nav).getAllByRole('link', { name: 'Email' });
  expect(emailLinks.map((link) => link.getAttribute('href'))).toEqual([
    '/email',
  ]);
  fireEvent.input(within(nav).getByRole('searchbox'), {
    target: { value: 'Keyboard-driven email' },
  });
  expect(
    (
      await within(nav).findByRole('link', { name: /^Email Features$/ })
    ).getAttribute('href')
  ).toBe('/email');
});
