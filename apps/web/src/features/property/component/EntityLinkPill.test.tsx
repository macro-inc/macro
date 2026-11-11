import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useProperty } from '../core/context';
import { Root } from '../core/Root';
import type { EntityProperty } from '../types';
import { EntityLinkPill } from './EntityLinkPill';

const mocks = vi.hoisted(() => ({
  openDocument: vi.fn(),
  blockType: (): string | undefined => 'company',
  loading: false,
}));

vi.mock('@core/component/LexicalMarkdown/component/core/BlockLink', () => ({
  openDocument: mocks.openDocument,
}));
vi.mock('../hooks/usePropertyEntityDisplay', () => ({
  usePropertyEntityDisplay: () => ({
    name: () => 'Acme',
    icon: () => null,
    blockOrFileType: () => mocks.blockType(),
    isLoading: () => mocks.loading,
    linkParams: () => undefined,
  }),
}));

const company: EntityProperty = {
  propertyId: 'assignment',
  propertyDefinitionId: 'company',
  displayName: 'Company',
  valueType: 'ENTITY',
  specificEntityType: 'COMPANY',
  isMultiSelect: false,
  value: [{ entity_id: 'acme', entity_type: 'COMPANY' }],
  owner: { scope: 'user', user_id: 'macro|owner@example.com' },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

function EditorState() {
  const ctx = useProperty();
  return <output>{ctx.editorOpen() ? 'Editing' : 'Not editing'}</output>;
}

function renderPill(canEdit = true, label?: string) {
  render(() => (
    <Root property={company} canEdit={canEdit}>
      <EntityLinkPill
        property={company}
        label={label}
        fallback={<span>Plain pill</span>}
        openLabel={(name) => `Open ${name}`}
        changeLabel="Change company"
      />
      <EditorState />
    </Root>
  ));
}

beforeEach(() => {
  mocks.openDocument.mockClear();
  mocks.blockType = () => 'company';
  mocks.loading = false;
});
afterEach(cleanup);

it('opens the item from its name, in a new split on shift', () => {
  renderPill();
  const name = screen.getByRole('button', { name: 'Open Acme' });

  fireEvent.click(name);
  expect(mocks.openDocument).toHaveBeenLastCalledWith(
    'company',
    'acme',
    undefined,
    false
  );
  fireEvent.click(name, { shiftKey: true });
  expect(mocks.openDocument).toHaveBeenLastCalledWith(
    'company',
    'acme',
    undefined,
    true
  );
  expect(screen.getByText('Not editing')).toBeTruthy();
});

it('changes the item from the caret without opening it', () => {
  renderPill();
  fireEvent.click(screen.getByRole('button', { name: 'Change company' }));
  expect(screen.getByText('Editing')).toBeTruthy();
  expect(mocks.openDocument).not.toHaveBeenCalled();
});

it('still opens the item for someone who cannot change it', () => {
  renderPill(false);
  expect(screen.queryByRole('button', { name: 'Change company' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open Acme' }));
  expect(mocks.openDocument).toHaveBeenCalledOnce();
});

it('stays a plain pill when the item cannot be opened', () => {
  mocks.blockType = () => undefined;
  renderPill();
  expect(screen.getByText('Plain pill')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});

it('keeps the split pill while the item is still loading', () => {
  mocks.blockType = () => undefined;
  mocks.loading = true;
  renderPill();
  expect(screen.queryByText('Plain pill')).toBeNull();
  const name = screen.getByRole('button', { name: 'Open Acme' });
  expect(name.hasAttribute('disabled')).toBe(true);
  fireEvent.click(name);
  expect(mocks.openDocument).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Change company' }));
  expect(screen.getByText('Editing')).toBeTruthy();
});

it('shows the property name before the value when labelled', () => {
  renderPill(true, 'Customer');
  expect(
    screen.getByRole('button', { name: 'Open Acme' }).textContent
  ).toContain('Customer:');
});
