import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { LINEAR, SUPERHUMAN } from '../core/profiles';
import { HotkeyProfileKeymap } from './hotkey-profile-keymap';

afterEach(cleanup);

function search(text: string) {
  fireEvent.input(screen.getByPlaceholderText('Search shortcuts'), {
    target: { value: text },
  });
}

const sectionTitles = () =>
  screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

describe('HotkeyProfileKeymap', () => {
  it('lists the vendor sections in the vendor order, shared keys included', () => {
    render(() => <HotkeyProfileKeymap profile={SUPERHUMAN} />);
    expect(sectionTitles()).toEqual([
      'Actions',
      'Navigation',
      'Conversations',
      'Labels',
      'Messages',
      'Compose',
      'Pop-out',
      'Folders',
      'Windows',
      'Filters',
    ]);
    expect(screen.getByText('Mark done')).toBeTruthy();
    expect(screen.getByText('Replaces Create menu')).toBeTruthy();
  });

  it('filters by name and by the shortcut a key replaces', () => {
    render(() => <HotkeyProfileKeymap profile={LINEAR} />);

    search('status');
    expect(sectionTitles()).toEqual(['Issue actions']);
    expect(screen.getByText('Change status')).toBeTruthy();
    expect(screen.queryByText('Assign to me')).toBeNull();

    search('sort tasks');
    expect(screen.getByText('Change status')).toBeTruthy();
    expect(screen.queryByText('Set story points')).toBeNull();

    search('no such shortcut');
    expect(screen.getByText('No shortcuts match')).toBeTruthy();
  });
});
