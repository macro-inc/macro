import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import type { Property, PropertyApiValues } from '../../types';
import {
  type CollectionSaveOutcome,
  EntityCollectionProperty,
} from './EntityCollectionProperty';

const mocks = vi.hoisted(() => ({
  detached: [] as Promise<unknown>[],
}));
vi.mock('@core/component/DocumentPreview', () => ({
  PopupPreview: () => null,
}));
vi.mock('@core/component/HoverCard', () => ({ HoverCard: () => null }));
vi.mock('@core/component/LexicalMarkdown/component/core/BlockLink', () => ({
  openDocument: vi.fn(),
}));
vi.mock('@core/constant/allBlocks', () => ({ itemToBlockName: vi.fn() }));
vi.mock('@core/util/fireAndForget', () => ({
  fireAndForget: (work: Promise<unknown>) => {
    mocks.detached.push(work);
  },
}));
vi.mock('@core/util/useSplitNavigationHandler', () => ({
  useSplitNavigationHandler: vi.fn(),
}));
vi.mock('@property', () => ({
  Property: {
    Root: (props: { children: JSX.Element }) => props.children,
    PopoverEditor: () => null,
  },
  useProperty: () => ({ editorOpen: () => false, openEditor: vi.fn() }),
}));
vi.mock('@property/context/PropertiesContext', () => ({
  usePropertiesContext: () => ({ canEdit: true, entityType: 'TASK' }),
}));
vi.mock('@property/hooks/usePropertyEntityLink', () => ({
  usePropertyEntityLink: (reference: () => { entity_id: string }) => ({
    display: { name: () => reference().entity_id, icon: () => null },
    canOpen: () => true,
    open: vi.fn(),
  }),
}));
vi.mock('@property/utils', () => ({
  getEntityValues: (property: Property) =>
    property.valueType === 'ENTITY' ? (property.value ?? []) : [],
}));
vi.mock('@queries/preview', () => ({
  isAccessiblePreviewItem: vi.fn(),
  useItemPreview: vi.fn(),
}));
vi.mock('./entity-collection-drop', () => ({
  createEntityCollectionDropTarget: () => undefined,
}));
vi.mock('@ui', async () => ({
  ...(await import('@ui/utils/classname')),
  Button: (
    props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { tooltip?: string }
  ) => (
    <button
      type="button"
      aria-label={props['aria-label']}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
  Layer: (props: { children: JSX.Element }) => props.children,
}));

const acme = { entity_id: 'acme', entity_type: 'COMPANY' as const };
const globex = { entity_id: 'globex', entity_type: 'COMPANY' as const };
const companies: Property = {
  propertyId: 'instance-companies',
  propertyDefinitionId: 'companies',
  displayName: 'Companies',
  owner: { scope: 'system' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
  valueType: 'ENTITY',
  value: [acme, globex],
  isMultiSelect: true,
};

type Save = (
  property: Property,
  values: PropertyApiValues,
  onAccepted: () => void
) => Promise<void>;

function renderCompanies(onSave: Save) {
  const onRefresh = vi.fn(async (_outcome: CollectionSaveOutcome) => {});
  const saving = createSignal(false);
  render(() => (
    <EntityCollectionProperty
      entityId="task"
      onRefresh={onRefresh}
      property={companies}
      onSave={onSave}
      saving={saving}
      actionsBeforeAdd={null}
      actionsAfterAdd={null}
    />
  ));
  return onRefresh;
}

const addButton = () =>
  screen.getByRole<HTMLButtonElement>('button', { name: 'Add Companies' });

afterEach(() => {
  cleanup();
  mocks.detached = [];
});

it('unlocks the row once a save is accepted locally, while its commit never arrives', async () => {
  let accept!: () => void;
  const onSave = vi.fn<Save>((_property, _values, onAccepted) => {
    accept = onAccepted;
    return new Promise<void>(() => {});
  });
  const onRefresh = renderCompanies(onSave);

  await fireEvent.click(screen.getByRole('button', { name: 'Remove acme' }));

  expect(onSave.mock.calls[0][1]).toEqual({
    valueType: 'ENTITY',
    refs: [globex],
  });
  expect(addButton().disabled).toBe(true);

  accept();

  expect(addButton().disabled).toBe(false);
  expect(screen.queryByText('acme')).toBeNull();
  expect(screen.getByText('globex')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Remove globex' })).toBeTruthy();
  expect(onRefresh).not.toHaveBeenCalled();
});

it('puts the stored values back and rereads them when an accepted save fails', async () => {
  let reject!: (error: Error) => void;
  const onSave = vi.fn<Save>((_property, _values, onAccepted) => {
    onAccepted();
    return new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
  });
  const onRefresh = renderCompanies(onSave);

  await fireEvent.click(screen.getByRole('button', { name: 'Remove acme' }));
  expect(screen.queryByText('acme')).toBeNull();

  reject(new Error('denied'));
  await mocks.detached[0];

  expect(screen.getByText('acme')).toBeTruthy();
  expect(addButton().disabled).toBe(false);
  expect(onRefresh.mock.calls).toEqual([['failed']]);
});

it('keeps a newer save in charge of the row when an older one commits', async () => {
  const commits: Array<() => void> = [];
  const onSave = vi.fn<Save>((_property, _values, onAccepted) => {
    if (commits.length === 0) onAccepted();
    return new Promise<void>((resolve) => {
      commits.push(resolve);
    });
  });
  const onRefresh = renderCompanies(onSave);

  await fireEvent.click(screen.getByRole('button', { name: 'Remove acme' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Remove globex' }));
  expect(onSave.mock.calls[1][1]).toEqual({ valueType: 'ENTITY', refs: null });
  expect(addButton().disabled).toBe(true);

  commits[0]();
  await mocks.detached[0];

  expect(addButton().disabled).toBe(true);
  expect(screen.queryByText('globex')).toBeNull();
  expect(onRefresh.mock.calls).toEqual([['saved']]);
});

it('keeps every remaining reference when the query rewrites its list in place after a removal', async () => {
  // A query result is a store, and reconcile moves the remaining references
  // up by rewriting the objects already in the list.
  const [query, setQuery] = createStore<{ property: Property }>({
    property: {
      ...companies,
      value: [
        { entity_id: 'acme', entity_type: 'COMPANY' },
        { entity_id: 'globex', entity_type: 'COMPANY' },
        { entity_id: 'initech', entity_type: 'COMPANY' },
      ],
    },
  });
  const saved: PropertyApiValues[] = [];
  const onSave: Save = async (_property, values, onAccepted) => {
    saved.push(values);
    onAccepted();
  };
  render(() => (
    <EntityCollectionProperty
      entityId="task"
      onRefresh={async () => {}}
      property={query.property}
      onSave={onSave}
      saving={createSignal(false)}
      actionsBeforeAdd={null}
      actionsAfterAdd={null}
    />
  ));

  await fireEvent.click(screen.getByRole('button', { name: 'Remove acme' }));
  await mocks.detached[0];
  setQuery(
    'property',
    'value',
    reconcile([
      { entity_id: 'globex', entity_type: 'COMPANY' as const },
      { entity_id: 'initech', entity_type: 'COMPANY' as const },
    ])
  );

  expect(screen.getAllByText('globex')).toHaveLength(1);
  expect(screen.getAllByText('initech')).toHaveLength(1);

  await fireEvent.click(screen.getByRole('button', { name: 'Remove initech' }));
  expect(saved[1]).toEqual({
    valueType: 'ENTITY',
    refs: [{ entity_id: 'globex', entity_type: 'COMPANY' }],
  });
});
