import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SiteHeader } from './SiteHeader';

// Booking is independent of the public navigation interaction.
vi.mock('./DemoBookingDialog', () => ({ DemoBookingDialog: () => null }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 768px) and (hover: hover)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mousePointer(type: string) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  return event;
}

it('opens on mouse hover and keeps the mark linked to the landing page', () => {
  render(() => <SiteHeader />);
  const home = screen.getByRole('link', { name: 'Macro home' });
  expect(home.getAttribute('href')).toBe('/');
  expect(home.getAttribute('target')).toBe('_self');
  expect(screen.queryByRole('navigation')).toBeNull();
  fireEvent(home.parentElement!, mousePointer('pointerenter'));
  const nav = screen.getByRole('navigation', { name: 'Main navigation' });
  expect(home.getAttribute('aria-expanded')).toBe('true');
  expect(
    within(nav).getByRole('link', { name: 'Tasks' }).getAttribute('href')
  ).toBe('/tasks');
  fireEvent(home.parentElement!, mousePointer('pointerleave'));
  expect(screen.getByRole('navigation')).toBeTruthy();
  vi.advanceTimersByTime(350);
  expect(screen.queryByRole('navigation')).toBeNull();
});

it('opens with Down Arrow, keeps focused links available, and returns focus with Escape', () => {
  render(() => <SiteHeader />);
  const home = screen.getByRole('link', { name: 'Macro home' });
  home.focus();
  fireEvent.keyDown(home, { key: 'ArrowDown' });
  const email = within(screen.getByRole('navigation')).getByRole('link', {
    name: 'Email',
  });
  expect(document.activeElement).toBe(email);
  fireEvent(home.parentElement!, mousePointer('pointerleave'));
  expect(screen.getByRole('navigation')).toBeTruthy();
  fireEvent.keyDown(email, { key: 'Escape' });
  expect(screen.queryByRole('navigation')).toBeNull();
  expect(document.activeElement).toBe(home);
});

it('uses a single hamburger touch toggle and closes when leaving navigation', () => {
  render(() => <SiteHeader />);
  const home = screen.getByRole('link', { name: 'Macro home' });
  const touch = new Event('pointerenter', { bubbles: true });
  Object.defineProperty(touch, 'pointerType', { value: 'touch' });
  fireEvent(home.parentElement!, touch);
  expect(screen.queryByRole('navigation')).toBeNull();
  const toggle = screen.getByRole('button', { name: 'Open navigation' });
  expect(toggle.querySelector('.site-menu-mark')).toBeTruthy();
  expect(toggle.querySelector('svg')).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByRole('navigation')).toBeTruthy();
  fireEvent.keyDown(toggle, { key: 'Escape' });
  expect(document.activeElement).toBe(toggle);
  expect(screen.queryByRole('navigation')).toBeNull();
  fireEvent.click(toggle);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('navigation')).toBeNull();
  fireEvent.click(toggle);
  fireEvent.focusOut(toggle, {
    relatedTarget: screen.getByRole('link', { name: 'Open app' }),
  });
  expect(screen.queryByRole('navigation')).toBeNull();
});

it('keeps narrow-screen keyboard navigation inside the open menu', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-width: 767px)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  render(() => <SiteHeader />);
  const home = screen.getByRole('link', { name: 'Macro home' });
  fireEvent(home.parentElement!, mousePointer('pointerenter'));
  expect(screen.queryByRole('navigation')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  const last = within(screen.getByRole('navigation')).getByRole('link', {
    name: 'Book a demo',
  });
  const toggle = screen.getByRole('button', { name: 'Close navigation' });
  toggle.focus();
  fireEvent.keyDown(toggle, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(document.activeElement).toBe(toggle);
});

it('allows crossing the gap and cancels dismissal while over the dropdown', () => {
  render(() => <SiteHeader />);
  const menu = screen.getByRole('link', { name: 'Macro home' }).parentElement!;
  fireEvent(menu, mousePointer('pointerenter'));
  fireEvent(menu, mousePointer('pointerleave'));
  vi.advanceTimersByTime(300);
  const nav = screen.getByRole('navigation');
  fireEvent(nav, mousePointer('pointerenter'));
  vi.advanceTimersByTime(1000);
  expect(screen.getByRole('navigation')).toBe(nav);
  fireEvent(menu, mousePointer('pointerleave'));
  vi.advanceTimersByTime(200);
  fireEvent(menu, mousePointer('pointerenter'));
  vi.advanceTimersByTime(1000);
  expect(screen.getByRole('navigation')).toBe(nav);
  fireEvent(menu, mousePointer('pointerleave'));
  vi.advanceTimersByTime(350);
  expect(screen.queryByRole('navigation')).toBeNull();
});

it('cancels a pending close when keyboard navigation opens and dismisses immediately on Escape', () => {
  render(() => <SiteHeader />);
  const home = screen.getByRole('link', { name: 'Macro home' });
  fireEvent(home.parentElement!, mousePointer('pointerenter'));
  fireEvent(home.parentElement!, mousePointer('pointerleave'));
  vi.advanceTimersByTime(200);
  fireEvent.keyDown(home, { key: 'ArrowDown' });
  vi.advanceTimersByTime(350);
  expect(screen.getByRole('navigation')).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('navigation')).toBeNull();
  vi.advanceTimersByTime(350);
  expect(screen.queryByRole('navigation')).toBeNull();
});

it('cleans up the dismissal timer on unmount', () => {
  const view = render(() => <SiteHeader />);
  const menu = screen.getByRole('link', { name: 'Macro home' }).parentElement!;
  fireEvent(menu, mousePointer('pointerenter'));
  fireEvent(menu, mousePointer('pointerleave'));
  expect(vi.getTimerCount()).toBe(1);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
