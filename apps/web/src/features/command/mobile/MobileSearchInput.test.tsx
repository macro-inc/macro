import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { MobileSearchInput } from './MobileSearchInput';
import { SearchState } from './mobileSearchState';

const navigate = vi.fn();
vi.mock('@components/app/mobile/use-mobile-nav', () => ({
  useForegroundMobileView: () => () => 'search',
  useMobileNavNavigate: () => navigate,
}));
vi.mock('@core/mobile/haptics', () => ({ hapticImpact: vi.fn() }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
afterEach(() => {
  cleanup();
  SearchState.close();
  vi.clearAllMocks();
});

it('keeps the same focused input through category and mode changes and Enter only dismisses the keyboard', () => {
  SearchState.open();
  render(() => <MobileSearchInput />);
  const input = screen.getByPlaceholderText('Search…');
  input.focus();
  fireEvent.input(input, { target: { value: 'teo' } });
  SearchState.setCategory('email');
  SearchState.searchFullText();
  expect(document.activeElement).toBe(input);
  expect(screen.getByPlaceholderText('Search…')).toBe(input);
  fireEvent.input(input, { target: { value: 'teo update' } });
  expect(SearchState.mode()).toBe('full-text');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(document.activeElement).not.toBe(input);
  expect(SearchState.isOpen()).toBe(true);
  expect(screen.queryByText('Ask AI')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
  expect(SearchState.isOpen()).toBe(false);
  expect(SearchState.query()).toBe('');
  expect(navigate).toHaveBeenCalledWith('home');
});
