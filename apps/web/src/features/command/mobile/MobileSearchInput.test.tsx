import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileSearchInput } from './MobileSearchInput';
import { SearchState } from './mobileSearchState';

const navigate = vi.fn();
vi.mock('../../universal-input/use-universal-input', () => ({
  useUniversalInputEnabled: () => () => false,
}));
vi.mock('@components/app/mobile/use-mobile-nav', () => ({
  useForegroundMobileView: () => () => 'search',
  useMobileNavNavigate: () => navigate,
}));
vi.mock('@core/mobile/haptics', () => ({ hapticImpact: vi.fn() }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  SearchState.close();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('keeps the same focused input through category, mode and Enter changes', () => {
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
  expect(document.activeElement).toBe(input);
  expect(SearchState.isOpen()).toBe(true);
  expect(screen.queryByText('Ask AI')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
  expect(SearchState.isOpen()).toBe(false);
  expect(SearchState.query()).toBe('');
  expect(navigate).toHaveBeenCalledWith('home');
});
