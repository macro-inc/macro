/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarSource } from '../types';
import { SourceControls } from './SourceControls';

const SOURCES: CalendarSource[] = [
  {
    id: 'gab-primary',
    name: 'gab@macro.com',
    color: '#ff0000',
    emailAddress: 'gab@macro.com',
    emailLinkId: 'link-gab',
    isPrimary: true,
  },
  {
    id: 'gab-holidays',
    name: 'Holidays in United States',
    color: '#00ff00',
    emailAddress: 'gab@macro.com',
    emailLinkId: 'link-gab',
    isSubscription: true,
  },
  {
    id: 'test-primary',
    name: 'gabtest1@macro.com',
    color: '#0000ff',
    emailAddress: 'gabtest1@macro.com',
    emailLinkId: 'link-test',
    isPrimary: true,
  },
];

function renderControls() {
  const onVisibilityChange = vi.fn<(id: string, visible: boolean) => void>();
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
  const result = render(() => (
    <SourceControls
      sources={SOURCES}
      isVisible={(id) => !hidden().has(id)}
      onVisibilityChange={(id, visible) => {
        onVisibilityChange(id, visible);
        setHidden((current) => {
          const next = new Set(current);
          if (visible) next.delete(id);
          else next.add(id);
          return next;
        });
      }}
    />
  ));
  const headerFor = (email: string) => {
    const caret = result.getByRole('button', { name: `Collapse ${email}` });
    const header = caret.parentElement;
    if (!header) throw new Error(`missing header for ${email}`);
    return header;
  };
  return { ...result, onVisibilityChange, headerFor };
}

describe('SourceControls', () => {
  it('folds calendars under a header per account', () => {
    const { getByText, getByRole } = renderControls();
    expect(getByText('Holidays in United States')).toBeTruthy();
    // Each account renders its own collapse control.
    expect(
      getByRole('button', { name: 'Collapse gab@macro.com' })
    ).toBeTruthy();
    expect(
      getByRole('button', { name: 'Collapse gabtest1@macro.com' })
    ).toBeTruthy();
  });

  it('toggles a single calendar when its row is clicked', () => {
    const { getByText, onVisibilityChange } = renderControls();
    fireEvent.click(getByText('Holidays in United States'));
    expect(onVisibilityChange).toHaveBeenCalledWith('gab-holidays', false);
  });

  it('toggles every calendar in an account from its header checkbox', () => {
    const { headerFor, onVisibilityChange } = renderControls();
    fireEvent.click(
      within(headerFor('gab@macro.com')).getByText('gab@macro.com')
    );
    expect(onVisibilityChange).toHaveBeenCalledWith('gab-primary', false);
    expect(onVisibilityChange).toHaveBeenCalledWith('gab-holidays', false);
  });

  it('marks a subscription calendar with an indicator', () => {
    const { container } = renderControls();
    const indicators = container.querySelectorAll(
      '[title="Subscription calendar"]'
    );
    expect(indicators).toHaveLength(1);
  });

  it('collapses an account to hide its calendars', () => {
    const { getByRole, queryByText } = renderControls();
    fireEvent.click(getByRole('button', { name: 'Collapse gab@macro.com' }));
    expect(queryByText('Holidays in United States')).toBeNull();
    // The collapsed account's caret flips to an expand control.
    expect(getByRole('button', { name: 'Expand gab@macro.com' })).toBeTruthy();
    // The other account stays expanded.
    expect(
      getByRole('button', { name: 'Collapse gabtest1@macro.com' })
    ).toBeTruthy();
  });
});
