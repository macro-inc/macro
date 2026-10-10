import { ListFilterDropdown } from '@app/components/view-shell/ListDropdowns';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DriveState } from '../core/types';
import { createDriveState } from '../primitives/drive-state';
import { useDriveFilters } from './use-drive-filters';

let state: ReturnType<typeof createDriveState>;
vi.mock('../context/drive-context', () => ({
  useDriveView: () => ({ state, actions: { userId: () => 'me' } }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@property/tags/use-tag-filter-group', () => ({
  useTagFilterGroup: () => () => ({ id: 'tags', label: 'Tags', options: [] }),
}));
vi.mock('@queries/contacts/contacts', () => ({ useContacts: () => () => [] }));
vi.mock('@ui', async () => ({
  ...(await import('@ui/utils/classname')),
  ...(await import('@ui/components/Dropdown')),
  ...(await import('@ui/components/Layer')),
}));
vi.mock('@ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/mobile/inputModality', () => ({ isModality: () => false }));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  motionStyles = document.createElement('style');
  motionStyles.textContent =
    '* { transition-duration: 0s; animation-name: none; }';
  document.head.append(motionStyles);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  motionStyles.remove();
  vi.unstubAllGlobals();
});

it.each(['pointer', 'keyboard'])(
  'keeps the Drive Type submenu mounted while Shift-selecting and deselecting file types (%s)',
  async (input) => {
    const [value, setValue] = createSignal<DriveState>({
      location: { kind: 'tab', tab: 'owned' },
      scope: 'default',
      sort: 'updated_at',
      search: '',
      facets: {},
      expandedFolderIds: [],
      favoritesOpen: true,
      rootOpen: true,
      tagsOpen: true,
    });
    render(() => {
      state = createDriveState({
        state: value,
        setState: setValue,
        folders: () => [],
        list: { reset: vi.fn() },
        showList: vi.fn(),
      });
      const filters = useDriveFilters();
      return (
        <ListFilterDropdown
          groups={filters.groups()}
          isSelected={filters.isSelected}
          onSelectionChange={filters.setSelected}
        />
      );
    });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Filter list' }), {
      key: 'Enter',
    });
    const trigger = await screen.findByRole('menuitem', { name: 'Type' });
    // Let the newly opened root menu finish its deferred autofocus first.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    const markdown = await screen.findByRole('menuitemcheckbox', {
      name: 'Markdown',
    });
    const pdf = screen.getByRole('menuitemcheckbox', { name: 'PDFs' });
    const select = (element: HTMLElement) => {
      if (input === 'keyboard') {
        element.focus();
        fireEvent.keyDown(element, { key: 'Enter', shiftKey: true });
      } else
        fireEvent(
          element,
          new MouseEvent('pointerup', {
            button: 0,
            bubbles: true,
            shiftKey: true,
          })
        );
    };

    select(markdown);
    expect(value().facets.type).toEqual(['doc-markdown']);
    expect(markdown.isConnected).toBe(true);
    select(pdf);
    expect(value().facets.type).toEqual(['doc-markdown', 'file-pdf']);
    expect(pdf.getAttribute('aria-checked')).toBe('true');
    select(markdown);
    expect(value().facets.type).toEqual(['file-pdf']);
    expect(markdown.getAttribute('aria-checked')).toBe('false');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(markdown.isConnected).toBe(true);
    pdf.focus();
    fireEvent.keyDown(pdf, { key: 'Enter' });
    await waitFor(() => expect(pdf.isConnected).toBe(false));
    expect(value().facets.type).toBeUndefined();
  }
);
