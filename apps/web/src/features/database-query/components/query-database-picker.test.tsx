import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryDatabasePicker } from './query-database-picker';

const databases = [
  { id: 'support', name: 'Example · Support desk' },
  { id: 'sales', name: 'Example · Sales pipeline' },
];

beforeEach(() => {
  const computedStyle = window.getComputedStyle;
  vi.stubGlobal('getComputedStyle', (element: Element) => {
    const style = computedStyle(element);
    // Match browser defaults so Kobalte does not wait for a nonexistent JSDOM animation.
    style.animationName ||= 'none';
    return style;
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('database source picker', () => {
  it('searches database names, selects with the keyboard, and restores trigger focus', async () => {
    const [value, setValue] = createSignal<string>();
    const result = render(() => (
      <QueryDatabasePicker
        databases={databases}
        value={value()}
        onChange={setValue}
      />
    ));
    const trigger = result.getByRole('button', { name: 'Database: Automatic' });
    trigger.focus();
    fireEvent.click(trigger);
    const search = await screen.findByRole('combobox', {
      name: 'Search databases',
    });
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.input(search, { target: { value: 'pipeline' } });
    await screen.findByRole('option', { name: 'Example · Sales pipeline' });
    expect(
      screen.queryByRole('option', { name: 'Example · Support desk' })
    ).toBeNull();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(value()).toBe('sales'));
    await waitFor(() =>
      expect(
        screen.queryByRole('combobox', { name: 'Search databases' })
      ).toBeNull()
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(trigger.getAttribute('aria-label')).toBe(
      'Database: Example · Sales pipeline'
    );
    result.unmount();
  });

  it('closes when reselecting Automatic and when escaping the search', async () => {
    const change = vi.fn();
    const result = render(() => (
      <QueryDatabasePicker databases={databases} onChange={change} />
    ));
    const trigger = result.getByRole('button', { name: 'Database: Automatic' });
    fireEvent.click(trigger);
    const automatic = await screen.findByRole('option', { name: /Automatic/ });
    fireEvent.click(automatic);
    await waitFor(() => expect(change).toHaveBeenCalledWith(undefined));
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    fireEvent.click(trigger);
    const search = await screen.findByRole('combobox', {
      name: 'Search databases',
    });
    fireEvent.input(search, { target: { value: 'missing' } });
    await screen.findByText('No databases found');
    fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    expect(change).toHaveBeenCalledTimes(1);
    result.unmount();
  });

  it('labels automatic resolution and keeps a verified explicit label when the list is loading', () => {
    const result = render(() => (
      <QueryDatabasePicker
        databases={[]}
        loading
        resolvedName="Support desk"
        onChange={() => {}}
      />
    ));
    expect(
      result.getByRole('button', { name: 'Database: Support desk (automatic)' })
    ).toBeTruthy();
    result.unmount();
    const explicit = render(() => (
      <QueryDatabasePicker
        databases={[]}
        value="support"
        loading
        resolvedName="Support desk"
        onChange={() => {}}
      />
    ));
    expect(
      explicit.getByRole('button', { name: 'Database: Support desk' })
    ).toBeTruthy();
    explicit.unmount();
  });
});
