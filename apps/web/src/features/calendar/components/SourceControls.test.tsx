/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    syncError: 'Precondition check failed.',
  },
];

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
  vi.unstubAllGlobals();
});
function renderControls() {
  const onVisibilityChange = vi.fn<(id: string, visible: boolean) => void>();
  const onGroupVisibilityChange =
    vi.fn<(ids: string[], visible: boolean) => void>();
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
  const changeVisibility = (ids: readonly string[], visible: boolean) =>
    setHidden((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (visible) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  const result = render(() => (
    <SourceControls
      sources={SOURCES}
      isVisible={(id) => !hidden().has(id)}
      onVisibilityChange={(id, visible) => {
        onVisibilityChange(id, visible);
        changeVisibility([id], visible);
      }}
      onGroupVisibilityChange={(ids, visible) => {
        onGroupVisibilityChange(ids, visible);
        changeVisibility(ids, visible);
      }}
    />
  ));
  const expandAccount = (email: string) =>
    fireEvent.click(result.getByRole('button', { name: `Expand ${email}` }));
  const headerFor = (email: string) => {
    // Works whether the group is currently collapsed or expanded.
    const caret =
      result.queryByRole('button', { name: `Collapse ${email}` }) ??
      result.getByRole('button', { name: `Expand ${email}` });
    const header = caret.parentElement?.parentElement;
    if (!header) throw new Error(`missing header for ${email}`);
    return header;
  };
  return {
    ...result,
    onVisibilityChange,
    onGroupVisibilityChange,
    headerFor,
    expandAccount,
  };
}

describe('SourceControls', () => {
  it('folds each account collapsed by default', () => {
    const { getByRole, queryByText } = renderControls();
    // Every account renders a collapse control, but its calendars stay hidden.
    expect(getByRole('button', { name: 'Expand gab@macro.com' })).toBeTruthy();
    expect(
      getByRole('button', { name: 'Expand gabtest1@macro.com' })
    ).toBeTruthy();
    expect(queryByText('Holidays in United States')).toBeNull();
  });

  it('shows the primary calendar color on the collapsed account header', () => {
    const { headerFor } = renderControls();
    const swatch = headerFor('gab@macro.com').querySelector<HTMLElement>(
      '[aria-hidden="true"][style]'
    );
    expect(swatch?.style.backgroundColor).toBe('rgb(255, 0, 0)');
  });

  it('places checkboxes before labels and keeps expansion separate from visibility', () => {
    const {
      expandAccount,
      getByRole,
      getByText,
      headerFor,
      onVisibilityChange,
    } = renderControls();
    const header = headerFor('gab@macro.com');
    const headerCheckbox = header.querySelector('input[type="checkbox"]');
    const headerText = header.querySelector('.truncate');
    expect(
      headerCheckbox &&
        headerText &&
        headerCheckbox.compareDocumentPosition(headerText) &
          Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    const disclosure = getByRole('button', { name: 'Expand gab@macro.com' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expandAccount('gab@macro.com');
    expect(
      getByRole('button', { name: 'Collapse gab@macro.com' }).getAttribute(
        'aria-expanded'
      )
    ).toBe('true');
    expect(onVisibilityChange).not.toHaveBeenCalled();
    const child = getByRole('checkbox', { name: 'Holidays in United States' });
    const childText = getByText('Holidays in United States');
    expect(
      child.compareDocumentPosition(childText) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
  it('reveals an account calendars once expanded', () => {
    const { expandAccount, getByText } = renderControls();
    expandAccount('gab@macro.com');
    expect(getByText('Holidays in United States')).toBeTruthy();
  });

  it('toggles a single calendar when its row is clicked', () => {
    const { expandAccount, getByText, onVisibilityChange } = renderControls();
    expandAccount('gab@macro.com');
    fireEvent.click(getByText('Holidays in United States'));
    expect(onVisibilityChange).toHaveBeenCalledWith('gab-holidays', false);
  });

  it('toggles an account in one visibility update from its header checkbox', () => {
    const { headerFor, onVisibilityChange, onGroupVisibilityChange } =
      renderControls();
    fireEvent.click(
      within(headerFor('gab@macro.com')).getByText('gab@macro.com')
    );
    expect(onGroupVisibilityChange).toHaveBeenCalledExactlyOnceWith(
      ['gab-primary', 'gab-holidays'],
      false
    );
    expect(onVisibilityChange).not.toHaveBeenCalled();
  });

  it('marks a subscription calendar with an indicator', () => {
    const { expandAccount, container } = renderControls();
    expandAccount('gab@macro.com');
    const indicators = container.querySelectorAll(
      '[title="Subscription calendar"]'
    );
    expect(indicators).toHaveLength(1);
  });

  it('badges a calendar with a persistent sync failure', () => {
    const { expandAccount, container } = renderControls();
    expandAccount('gabtest1@macro.com');
    const badge = container.querySelector(
      '[title="Sync failed: Precondition check failed."]'
    );
    expect(badge).toBeTruthy();
  });

  it('leaves a healthy calendar unbadged', () => {
    const { expandAccount, container } = renderControls();
    expandAccount('gab@macro.com');
    expect(container.querySelector('[title^="Sync failed:"]')).toBeNull();
  });

  it('collapses an account again to hide its calendars', () => {
    const { expandAccount, getByRole, queryByText } = renderControls();
    expandAccount('gab@macro.com');
    expect(queryByText('Holidays in United States')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Collapse gab@macro.com' }));
    expect(queryByText('Holidays in United States')).toBeNull();
  });
});
