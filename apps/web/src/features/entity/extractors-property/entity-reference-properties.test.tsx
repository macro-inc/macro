import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EntityData } from '../types/entity';
import { EntityReferenceProperties } from './entity-reference-properties';

const mocks = vi.hoisted(() => ({
  openDocument: vi.fn(),
  returnFocus: vi.fn(),
}));

vi.mock('@core/component/LexicalMarkdown/component/core/BlockLink', () => ({
  openDocument: mocks.openDocument,
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ returnFocus: mocks.returnFocus }),
}));
vi.mock('@property/hooks/usePropertyEntityDisplay', () => ({
  usePropertyEntityDisplay: (id: () => string, type: () => string) => ({
    name: () => ({ acme: 'Acme', globex: 'Globex', ada: 'Ada Lovelace' })[id()],
    icon: () => null,
    isLoading: () => false,
    hasPreviewAccess: () => true,
    blockOrFileType: () => (type() === 'CONTACT' ? 'contact' : 'company'),
    linkParams: () => undefined,
  }),
}));

const EPOCH_ZERO = new Date(0).toISOString();
const companies: SoupProperty = {
  id: 'assignment-companies',
  definition: {
    id: 'companies',
    display_name: 'Companies',
    data_type: 'ENTITY',
    is_metadata: false,
    is_multi_select: true,
    is_system: true,
    owner: { scope: 'system' },
    specific_entity_type: 'COMPANY',
    created_at: EPOCH_ZERO,
    updated_at: EPOCH_ZERO,
  },
  value: {
    type: 'EntityReference',
    value: [
      { entity_id: 'acme', entity_type: 'COMPANY' },
      { entity_id: 'globex', entity_type: 'COMPANY' },
    ],
  },
};
const contacts: SoupProperty = {
  id: 'assignment-contacts',
  definition: {
    id: 'contacts',
    display_name: 'Contacts',
    data_type: 'ENTITY',
    is_metadata: false,
    is_multi_select: true,
    is_system: true,
    owner: { scope: 'system' },
    specific_entity_type: 'CONTACT',
    created_at: EPOCH_ZERO,
    updated_at: EPOCH_ZERO,
  },
  value: {
    type: 'EntityReference',
    value: [{ entity_id: 'ada', entity_type: 'CONTACT' }],
  },
};
const task = {
  id: 'task',
  type: 'document',
  properties: [companies, contacts],
} as unknown as EntityData;

function renderRow() {
  render(() => (
    <>
      <input aria-label="Search" />
      <EntityReferenceProperties
        entity={task}
        propertyIds={['companies', 'contacts']}
        compact={false}
      />
    </>
  ));
}

/**
 * Lets a menu finish closing: Kobalte closes and hands focus back on timers,
 * and jsdom runs no exit animation, so a closed menu waits for one to unmount.
 */
function finishClosing(menu: HTMLElement) {
  vi.runAllTimers();
  const ended = new Event('animationend');
  Object.defineProperty(ended, 'animationName', { value: '' });
  menu.dispatchEvent(ended);
  vi.runAllTimers();
}

beforeEach(() => {
  mocks.openDocument.mockClear();
  mocks.returnFocus.mockClear();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

it('opens a record from its pill, in a new split on shift, and leaves focus where it was', async () => {
  const user = userEvent.setup();
  renderRow();
  const search = screen.getByRole('textbox', { name: 'Search' });
  search.focus();

  await user.click(screen.getByRole('button', { name: 'Companies: Acme' }));
  expect(mocks.openDocument).toHaveBeenLastCalledWith(
    'company',
    'acme',
    undefined,
    false
  );
  expect(document.activeElement).toBe(search);

  await user.keyboard('{Shift>}');
  await user.click(screen.getByRole('button', { name: 'Companies: Acme' }));
  await user.keyboard('{/Shift}');
  expect(mocks.openDocument).toHaveBeenLastCalledWith(
    'company',
    'acme',
    undefined,
    true
  );
  expect(document.activeElement).toBe(search);
});

it('returns focus to the overflow control when its menu is dismissed', async () => {
  renderRow();
  const more = screen.getByRole('button', {
    name: 'Show 1 more property values',
  });
  fireEvent.keyDown(more, { key: 'Enter' });
  const menu = await screen.findByRole('menu');

  vi.useFakeTimers();
  fireEvent.keyDown(menu, { key: 'Escape' });
  finishClosing(menu);
  await Promise.resolve();

  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(more);
  expect(mocks.returnFocus).not.toHaveBeenCalled();
  expect(mocks.openDocument).not.toHaveBeenCalled();
});

it('moves focus off the overflow control to the record after a menu row opens it', async () => {
  renderRow();
  const more = screen.getByRole('button', {
    name: 'Show 1 more property values',
  });
  fireEvent.keyDown(more, { key: 'Enter' });
  const menu = await screen.findByRole('menu');

  vi.useFakeTimers();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Ada Lovelace' }), {
    key: 'Enter',
  });
  finishClosing(menu);
  await Promise.resolve();

  expect(mocks.openDocument).toHaveBeenCalledWith(
    'contact',
    'ada',
    undefined,
    false
  );
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).not.toBe(more);
  expect(mocks.returnFocus).toHaveBeenCalledOnce();
});

it.each([
  {
    how: 'a pointer release',
    // jsdom has no PointerEvent; the menu row reads only these mouse fields.
    pick: (row: HTMLElement) =>
      fireEvent(
        row,
        new MouseEvent('pointerup', {
          bubbles: true,
          button: 0,
          shiftKey: true,
        })
      ),
  },
  {
    how: 'Enter',
    pick: (row: HTMLElement) =>
      fireEvent.keyDown(row, { key: 'Enter', shiftKey: true }),
  },
])(
  'opens a menu row in a new split when shift is held on $how',
  async ({ pick }) => {
    renderRow();
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Show 1 more property values' }),
      { key: 'Enter' }
    );
    const menu = await screen.findByRole('menu');

    vi.useFakeTimers();
    pick(screen.getByRole('menuitem', { name: 'Ada Lovelace' }));
    finishClosing(menu);
    await Promise.resolve();

    expect(mocks.openDocument).toHaveBeenCalledWith(
      'contact',
      'ada',
      undefined,
      true
    );
  }
);
