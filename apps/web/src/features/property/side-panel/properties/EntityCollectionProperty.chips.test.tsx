import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EntityProperty } from '../../types';
import { EntityCollectionProperty } from './EntityCollectionProperty';

const mocks = vi.hoisted(() => ({
  openDocument: vi.fn(),
  openProject: vi.fn(),
  canEdit: true,
}));

vi.mock('@core/component/LexicalMarkdown/component/core/BlockLink', () => ({
  openDocument: mocks.openDocument,
}));
vi.mock('@app/features/projects/open-project', () => ({
  openProject: mocks.openProject,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => 'layout',
}));
vi.mock('@core/component/DocumentPreview', () => ({
  PopupPreview: () => null,
}));
// Document and task chips read their block from their own preview.
vi.mock('@queries/preview', () => ({
  isAccessiblePreviewItem: () => true,
  useItemPreview: (input: () => { id: string }) => [
    () => ({ fileType: input().id === 'fix-login' ? 'task' : 'md' }),
  ],
}));
vi.mock('@core/constant/allBlocks', () => ({
  itemToBlockName: (item: { fileType: string }) => item.fileType,
}));
vi.mock('../../hooks/usePropertyEntityDisplay', () => ({
  usePropertyEntityDisplay: (
    id: () => string,
    type: () => string | undefined
  ) => ({
    name: () =>
      ({
        ada: 'Ada Lovelace',
        acme: 'Acme',
        'fix-login': 'Fix login',
        roadmap: 'Roadmap',
        launch: 'Launch',
        grace: 'Grace Hopper',
      })[id()],
    icon: () => null,
    isLoading: () => false,
    linkParams: () => undefined,
    nativeProjectId: () => (type() === 'INITIATIVE' ? id() : undefined),
    blockOrFileType: () =>
      ({ CONTACT: 'contact', COMPANY: 'company' })[type() ?? ''] ?? null,
  }),
}));
vi.mock('@property/context/PropertiesContext', () => ({
  usePropertiesContext: () => ({
    canEdit: mocks.canEdit,
    entityType: 'TASK',
  }),
}));
vi.mock('./entity-collection-drop', () => ({
  createEntityCollectionDropTarget: () => undefined,
}));
vi.mock('@property/utils', async () => ({
  getEntityValues: (await import('../../utils/typeGuards')).getEntityValues,
}));
// The real root owns the picker's open state; the picker itself is a stand-in.
vi.mock('@property', async () => {
  const { Root } = await import('../../core/Root');
  const { useProperty } = await import('../../core/context');
  return {
    useProperty,
    Property: {
      Root,
      PopoverEditor: () => (
        <output>
          {useProperty().editorOpen() ? 'Picker open' : 'Picker closed'}
        </output>
      ),
    },
  };
});

const related: EntityProperty = {
  propertyId: 'assignment',
  propertyDefinitionId: 'related',
  displayName: 'Related',
  valueType: 'ENTITY',
  specificEntityType: null,
  isMultiSelect: true,
  value: [
    { entity_id: 'ada', entity_type: 'CONTACT' },
    { entity_id: 'acme', entity_type: 'COMPANY' },
    { entity_id: 'fix-login', entity_type: 'TASK' },
    { entity_id: 'roadmap', entity_type: 'DOCUMENT' },
  ],
  owner: { scope: 'user', user_id: 'macro|owner@example.com' },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

function renderCollection(property: EntityProperty = related) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(() => (
    <EntityCollectionProperty
      entityId="task"
      property={property}
      onSave={onSave}
      onRefresh={async () => {}}
      saving={createSignal(false)}
      actionsBeforeAdd={null}
      actionsAfterAdd={null}
    />
  ));
  return onSave;
}

beforeEach(() => {
  mocks.openDocument.mockClear();
  mocks.openProject.mockClear();
  mocks.canEdit = true;
});
afterEach(cleanup);

it.each([
  ['Ada Lovelace', 'contact', 'ada', undefined],
  ['Acme', 'company', 'acme', undefined],
  ['Fix login', 'task', 'fix-login', {}],
  ['Roadmap', 'md', 'roadmap', {}],
])(
  'opens %s from its chip, in a new split on shift, and leaves the picker closed',
  (name, block, id, params) => {
    renderCollection();
    const value = screen.getByText(name);

    fireEvent.click(value);
    expect(mocks.openDocument).toHaveBeenLastCalledWith(
      block,
      id,
      params,
      false
    );
    fireEvent.click(value, { shiftKey: true });
    expect(mocks.openDocument).toHaveBeenLastCalledWith(
      block,
      id,
      params,
      true
    );
    expect(screen.getByText('Picker closed')).toBeTruthy();
  }
);

it('changes the collection from the add button without opening a value', () => {
  renderCollection();
  fireEvent.click(screen.getByRole('button', { name: 'Add Related' }));
  expect(screen.getByText('Picker open')).toBeTruthy();
  expect(mocks.openDocument).not.toHaveBeenCalled();
});

it('removes one value from its own control without opening it', () => {
  const onSave = renderCollection();
  fireEvent.click(screen.getByRole('button', { name: 'Remove Acme' }));

  expect(onSave).toHaveBeenCalledWith(
    related,
    {
      valueType: 'ENTITY',
      refs: [
        { entity_id: 'ada', entity_type: 'CONTACT' },
        { entity_id: 'fix-login', entity_type: 'TASK' },
        { entity_id: 'roadmap', entity_type: 'DOCUMENT' },
      ],
    },
    expect.any(Function)
  );
  expect(screen.queryByText('Acme')).toBeNull();
  expect(mocks.openDocument).not.toHaveBeenCalled();
  expect(screen.getByText('Picker closed')).toBeTruthy();
});

it('lets a viewer open a value they cannot change', () => {
  mocks.canEdit = false;
  renderCollection();
  expect(screen.queryByRole('button', { name: 'Add Related' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remove Acme' })).toBeNull();

  fireEvent.click(screen.getByText('Acme'));
  expect(mocks.openDocument).toHaveBeenCalledWith(
    'company',
    'acme',
    undefined,
    false
  );
});

it('opens a project value as a project, in a new split on shift', () => {
  renderCollection({
    ...related,
    value: [{ entity_id: 'launch', entity_type: 'INITIATIVE' }],
  });
  fireEvent.click(screen.getByText('Launch'), { shiftKey: true });
  expect(mocks.openProject).toHaveBeenCalledWith('layout', 'launch', {
    newSplit: true,
  });
  expect(mocks.openDocument).not.toHaveBeenCalled();
});

it('shows a value with no page of its own, such as a person, as plain text', () => {
  renderCollection({
    ...related,
    value: [{ entity_id: 'grace', entity_type: 'USER' }],
  });
  const person = screen.getByText('Grace Hopper');
  expect(person.closest('button')).toBeNull();

  fireEvent.click(person);
  expect(mocks.openDocument).not.toHaveBeenCalled();
  expect(mocks.openProject).not.toHaveBeenCalled();
  expect(screen.getByText('Picker closed')).toBeTruthy();
});
