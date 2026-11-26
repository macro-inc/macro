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
    name: 'owner@example.com',
    color: '#ff0000',
    emailAddress: 'owner@example.com',
    emailLinkId: 'link-gab',
    isPrimary: true,
  },
  {
    id: 'gab-holidays',
    name: 'Holidays',
    color: '#00ff00',
    emailAddress: 'owner@example.com',
    emailLinkId: 'link-gab',
    isSubscription: true,
  },
  {
    id: 'test-primary',
    name: 'other@example.com',
    color: '#0000ff',
    emailAddress: 'other@example.com',
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
function renderControls(initialSources = SOURCES) {
  const onVisibilityChange = vi.fn<(id: string, visible: boolean) => void>();
  const onGroupVisibilityChange =
    vi.fn<(ids: string[], visible: boolean) => void>();
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
  const [sources, setSources] = createSignal(initialSources);
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
      sources={sources()}
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
  const expandAccount = (email: string) => {
    const control = result.queryByRole('button', { name: `Expand ${email}` });
    if (control) fireEvent.click(control);
  };
  const headerFor = (email: string) => {
    // Resolve the row from the account, not the disclosure button's wrappers.
    const caret =
      result.queryByRole('button', { name: `Collapse ${email}` }) ??
      result.getByRole('button', { name: `Expand ${email}` });
    const header = caret.closest('li')?.firstElementChild;
    if (!(header instanceof HTMLElement)) {
      throw new Error(`missing header for ${email}`);
    }
    return header;
  };
  return {
    ...result,
    onVisibilityChange,
    onGroupVisibilityChange,
    headerFor,
    expandAccount,
    setSources,
  };
}

describe('SourceControls', () => {
  it('shows connected calendars by default', () => {
    const { getByRole, getByText } = renderControls();
    expect(
      getByRole('button', { name: 'Collapse owner@example.com' })
    ).toBeTruthy();
    expect(
      getByRole('button', { name: 'Collapse other@example.com' })
    ).toBeTruthy();
    expect(getByText('Holidays')).toBeTruthy();
  });

  it('shows the primary calendar color on the collapsed account header', () => {
    const { getByRole, headerFor } = renderControls();
    fireEvent.click(
      getByRole('button', { name: 'Collapse owner@example.com' })
    );
    const swatch = headerFor('owner@example.com').querySelector<HTMLElement>(
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
    const header = headerFor('owner@example.com');
    const headerCheckbox = header.querySelector('input[type="checkbox"]');
    const headerText = header.querySelector('.truncate');
    expect(
      headerCheckbox &&
        headerText &&
        headerCheckbox.compareDocumentPosition(headerText) &
          Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    fireEvent.click(
      getByRole('button', { name: 'Collapse owner@example.com' })
    );
    const disclosure = getByRole('button', {
      name: 'Expand owner@example.com',
    });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expandAccount('owner@example.com');
    expect(
      getByRole('button', { name: 'Collapse owner@example.com' }).getAttribute(
        'aria-expanded'
      )
    ).toBe('true');
    expect(onVisibilityChange).not.toHaveBeenCalled();
    const child = getByRole('checkbox', { name: /Holidays/ });
    const childText = getByText('Holidays');
    expect(
      child.compareDocumentPosition(childText) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
  it('reveals an account calendars once expanded', () => {
    const { expandAccount, getByRole, getByText } = renderControls();
    fireEvent.click(
      getByRole('button', { name: 'Collapse owner@example.com' })
    );
    expandAccount('owner@example.com');
    expect(getByText('Holidays')).toBeTruthy();
  });

  it('toggles a single calendar when its row is clicked', () => {
    const { expandAccount, getByText, onVisibilityChange } = renderControls();
    expandAccount('owner@example.com');
    fireEvent.click(getByText('Holidays'));
    expect(onVisibilityChange).toHaveBeenCalledWith('gab-holidays', false);
  });

  it('toggles an account in one visibility update from its header checkbox', () => {
    const { headerFor, onVisibilityChange, onGroupVisibilityChange } =
      renderControls();
    fireEvent.click(
      within(headerFor('owner@example.com')).getByText('owner@example.com')
    );
    expect(onGroupVisibilityChange).toHaveBeenCalledExactlyOnceWith(
      ['gab-primary', 'gab-holidays'],
      false
    );
    expect(onVisibilityChange).not.toHaveBeenCalled();
  });

  it('marks a subscription calendar with an indicator', () => {
    const { expandAccount, container } = renderControls();
    expandAccount('owner@example.com');
    const indicators = container.querySelectorAll(
      '[aria-label="Subscription calendar"]'
    );
    expect(indicators).toHaveLength(1);
  });

  it('names a calendar with a persistent sync failure by its error', () => {
    const { expandAccount, getByRole } = renderControls();
    expandAccount('other@example.com');
    expect(
      getByRole('checkbox', {
        name: /Sync failed: Precondition check failed\./,
      })
    ).toBeTruthy();
  });

  it('leaves a healthy calendar unbadged', () => {
    const { expandAccount, queryByText } = renderControls(SOURCES.slice(0, 2));
    expandAccount('owner@example.com');
    expect(queryByText(/^Sync failed:/)).toBeNull();
  });

  it('opens a newly connected account without reopening a collapsed account', () => {
    const { getByRole, setSources, onGroupVisibilityChange } = renderControls(
      SOURCES.slice(0, 2)
    );
    fireEvent.click(
      getByRole('button', { name: `Collapse ${SOURCES[0].emailAddress}` })
    );
    setSources(SOURCES);
    expect(
      getByRole('button', { name: `Expand ${SOURCES[0].emailAddress}` })
    ).toBeTruthy();
    expect(
      getByRole('button', { name: `Collapse ${SOURCES[2].emailAddress}` })
    ).toBeTruthy();
    expect(onGroupVisibilityChange).not.toHaveBeenCalled();
  });

  it('collapses an account again to hide its calendars', () => {
    const { expandAccount, getByRole, queryByText } = renderControls();
    expandAccount('owner@example.com');
    expect(queryByText('Holidays')).toBeTruthy();
    fireEvent.click(
      getByRole('button', { name: 'Collapse owner@example.com' })
    );
    expect(queryByText('Holidays')).toBeNull();
  });
});
