import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { createComponent, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { EntityAppearance } from '../core/appearance';
import { AppearancePicker } from './appearance-picker';

function renderPicker(mobile = false) {
  const change = vi.fn();
  const close = vi.fn();
  render(() => {
    const [appearance, setAppearance] = createSignal<EntityAppearance>({
      icon: null,
      color: null,
    });
    const [recent, setRecent] = createSignal<
      NonNullable<EntityAppearance['icon']>[]
    >([]);
    return createComponent(AppearancePicker, {
      get appearance() {
        return appearance();
      },
      defaultIcon: 'md',
      onChange(value) {
        change(value);
        setAppearance(value);
      },
      onClose: close,
      get recent() {
        return recent();
      },
      onPick: (icon) => setRecent([icon]),
      saving: false,
      mobile,
    });
  });
  return { change, close };
}

describe('appearance picker interaction', () => {
  it('chooses icons and colors without closing, and Remove retains the color', () => {
    const { change, close } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Star' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    expect(change).toHaveBeenLastCalledWith({
      icon: { kind: 'macro', name: 'star' },
      color: 'blue',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(change).toHaveBeenLastCalledWith({ icon: null, color: 'blue' });
    expect(close).not.toHaveBeenCalled();
  });

  it('searches emoji on the Icons tab and keeps keyboard selection in the grid', async () => {
    const { change } = renderPicker();
    const search = screen.getByRole('textbox', { name: 'Search icons' });
    fireEvent.input(search, { target: { value: 'rocket' } });
    const rocket = await screen.findByLabelText('Rocket', {
      selector: 'button',
    });
    rocket.scrollIntoView = vi.fn();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rocket);
    fireEvent.click(rocket);
    expect(change).toHaveBeenLastCalledWith({
      icon: { kind: 'emoji', value: '🚀' },
      color: null,
    });
    fireEvent.keyDown(rocket, { key: 'c' });
    expect(document.activeElement).toBe(search);
    expect(search instanceof HTMLInputElement && search.value).toBe('rocketc');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() =>
      expect(search instanceof HTMLInputElement && search.value).toBe('')
    );
  });

  it('filters one-character searches rather than showing unrelated emoji', async () => {
    renderPicker();
    const search = screen.getByRole('textbox', { name: 'Search icons' });
    fireEvent.input(search, { target: { value: 'rocket' } });
    await screen.findByLabelText('Rocket', { selector: 'button' });
    fireEvent.input(search, { target: { value: '{' } });
    expect(
      screen.queryByLabelText('Rocket', { selector: 'button' })
    ).toBeNull();
  });

  it('keeps the focused emoji mounted when Recent gains the chosen emoji', async () => {
    renderPicker();
    fireEvent.click(screen.getByRole('radio', { name: 'Emoji' }));
    const rocket = await screen.findByLabelText('Rocket', {
      selector: 'button',
    });
    rocket.focus();
    fireEvent.click(rocket);
    expect(rocket.isConnected).toBe(true);
    expect(document.activeElement).toBe(rocket);
  });

  it('preserves grid columns across section boundaries with partial final rows', () => {
    renderPicker();
    const key = screen.getByRole('button', { name: 'Key' });
    const file = screen.getByRole('button', { name: 'File' });
    key.scrollIntoView = vi.fn();
    file.scrollIntoView = vi.fn();
    key.focus();
    fireEvent.keyDown(key, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(file);
    fireEvent.keyDown(file, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(key);
  });

  // These flows mount the full shared emoji catalog, including under parallel suite load.
  it('does not replace a focused Recent emoji when it is selected again', async () => {
    renderPicker();
    fireEvent.click(screen.getByRole('radio', { name: 'Emoji' }));
    fireEvent.click(
      await screen.findByLabelText('Rocket', { selector: 'button' })
    );
    const recent = screen.getByLabelText('🚀', { selector: 'button' });
    recent.focus();
    fireEvent.click(recent);
    expect(recent.isConnected).toBe(true);
    expect(document.activeElement).toBe(recent);
  }, 15_000);

  it('uses eight columns for vertical navigation on mobile', () => {
    renderPicker(true);
    const key = screen.getByRole('button', { name: 'Key' });
    const book = screen.getByRole('button', { name: 'Book open' });
    key.scrollIntoView = vi.fn();
    book.scrollIntoView = vi.fn();
    key.focus();
    fireEvent.keyDown(key, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(book);
    fireEvent.keyDown(book, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(key);
  });

  it('resets category selection when search returns to the top', async () => {
    renderPicker();
    fireEvent.click(screen.getByRole('radio', { name: 'Emoji' }));
    const heading = await screen.findByText('Flags', { selector: 'h3' });
    const section = heading.closest('section');
    if (!section) throw new Error('Missing emoji section');
    section.scrollIntoView = vi.fn();
    const categories = within(screen.getByLabelText('Emoji categories'));
    const flags = categories.getByRole('button', { name: 'Flags' });
    fireEvent.click(flags);
    expect(flags.getAttribute('aria-pressed')).toBe('true');
    fireEvent.input(screen.getByRole('textbox', { name: 'Search emoji' }), {
      target: { value: 'rocket' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(flags.getAttribute('aria-pressed')).toBe('false');
    expect(
      categories
        .getByRole('button', { name: 'Smileys & people' })
        .getAttribute('aria-pressed')
    ).toBe('true');
  }, 15_000);
});
