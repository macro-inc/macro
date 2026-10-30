import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { usePropertiesContext } from '../../context/PropertiesContext';
import type { Property } from '../../types';
import { EntityPropertiesSection } from './EntityPropertiesSection';

type PropertiesContext = ReturnType<typeof usePropertiesContext>;
const mocks = vi.hoisted(() => ({
  properties: [] as Property[],
  getProperties: undefined as (() => Property[]) | undefined,
  context: undefined as unknown as PropertiesContext,
  add: vi.fn(),
  remove: vi.fn(),
  save: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('@components/app/side-panel/SidePanel', () => ({
  SidePanel: {
    Grid: (props: { children: JSX.Element }) => <div>{props.children}</div>,
    Loading: () => null,
  },
}));
vi.mock('@core/auth', () => ({ useIsAuthenticated: () => () => true }));
vi.mock('@core/component/DocumentPreview', () => ({
  PopupPreview: () => null,
}));
vi.mock('@core/component/HoverCard', () => ({ HoverCard: () => null }));
vi.mock('@core/component/LexicalMarkdown/component/core/BlockLink', () => ({
  openDocument: vi.fn(),
}));
vi.mock('@core/constant/allBlocks', () => ({ itemToBlockName: vi.fn() }));
vi.mock('@core/util/useSplitNavigationHandler', () => ({
  useSplitNavigationHandler: vi.fn(),
}));
vi.mock('@property', () => ({
  Property: {
    Root: (props: { property: Property }) => (
      <span>{JSON.stringify(props.property.value)}</span>
    ),
  },
  useProperty: vi.fn(),
}));
vi.mock('@property/component/modal', () => ({ Modals: () => null }));
vi.mock('@property/component/propertyValue/PropertyValueIcon', () => ({
  PropertyValueIcon: () => null,
}));
vi.mock('@property/context/PropertiesContext', () => ({
  PropertiesProvider: (
    props: PropertiesContext & { children: JSX.Element }
  ) => {
    mocks.context = props;
    return props.children;
  },
  usePropertiesContext: () => mocks.context,
}));
vi.mock('@property/editor/hooks/useAllProperties', () => ({
  useAllProperties: () => () => [],
}));
vi.mock('@property/hooks', () => ({
  useEntityProperties: () => ({
    properties: () => mocks.getProperties?.() ?? mocks.properties,
    isLoading: () => false,
    error: () => undefined,
    refetch: mocks.refetch,
    addProperty: mocks.add,
    removeProperty: mocks.remove,
  }),
  usePropertyEntityDisplay: vi.fn(),
}));
vi.mock('@property/tags', () => ({
  isTaggableEntityType: () => false,
  TagsRow: () => null,
}));
vi.mock('@property/utils', () => ({
  hasValue: (property: Property) => property.value !== null,
  getEntityValues: () => [],
}));
vi.mock('@queries/preview', () => ({
  isAccessiblePreviewItem: vi.fn(),
  useItemPreview: vi.fn(),
}));
vi.mock('@queries/properties/entity', () => ({
  useBulkSaveEntityPropertiesMutation: () => ({ mutateAsync: mocks.save }),
}));
vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: () => ({ isSuccess: true, data: [] }),
}));
vi.mock('./entity-collection-drop', () => ({
  createEntityCollectionDropTarget: () => undefined,
}));
vi.mock('@ui', async () => ({
  ...(await import('@ui/utils/classname')),
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  Layer: (props: { children: JSX.Element }) => props.children,
  Badge: () => null,
  badgeTriggerClasses: () => '',
}));

function field(id: string, value: string | null = null): Property {
  return {
    propertyId: `instance-${id}`,
    propertyDefinitionId: id,
    displayName: id,
    owner: { scope: 'system' },
    createdAt: new Date(0),
    updatedAt: new Date(0),
    valueType: 'STRING',
    value,
    isMultiSelect: false,
  };
}

beforeEach(() => {
  mocks.properties = [];
  mocks.getProperties = undefined;
  mocks.add.mockReset().mockResolvedValue(undefined);
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.save.mockReset().mockResolvedValue(undefined);
  mocks.refetch.mockReset();
});
afterEach(cleanup);

it('orders required defaults, uses fetched values, retains custom properties, and protects read-only rows', () => {
  const order = ['Status', 'Priority', 'Assignees', 'Due date'];
  mocks.properties = [
    field('Custom', 'custom'),
    field('Assignees', 'Alice'),
    field('Status', 'Active'),
  ];
  const [canEdit, setCanEdit] = createSignal(true);
  const view = render(() => (
    <EntityPropertiesSection
      entityId="project"
      entityType="INITIATIVE"
      canEdit={canEdit()}
      showTags={false}
      defaultProperties={() => order.map((id) => field(id))}
      requiredPropertyDefinitionIds={order}
      pinnedPropertyDefinitionOrder={order}
    />
  ));
  expect(
    [...view.container.querySelectorAll('span[title]')].map(
      (element) => element.textContent
    )
  ).toEqual([...order, 'Custom']);
  expect(screen.getByText('"Active"')).toBeTruthy();
  expect(screen.getAllByLabelText('Remove from entity')).toHaveLength(1);
  setCanEdit(false);
  expect(screen.queryByLabelText('Remove from entity')).toBeNull();
  expect(screen.queryByRole('button', { name: /Add/ })).toBeNull();
});

it('refreshes native projections after successful add, remove, and save, never before or after failure', async () => {
  const changed = vi.fn();
  mocks.properties = [field('Custom')];
  render(() => (
    <EntityPropertiesSection
      entityId="project"
      entityType="INITIATIVE"
      canEdit
      showTags={false}
      onPropertiesChanged={changed}
    />
  ));
  let added!: () => void;
  mocks.add.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        added = resolve;
      })
  );
  const adding = mocks.context.addProperty!('new-field');
  expect(changed).not.toHaveBeenCalled();
  added();
  await adding;
  expect(changed).toHaveBeenCalledOnce();
  await fireEvent.click(screen.getByLabelText('Remove from entity'));
  expect(mocks.remove).toHaveBeenCalledWith('instance-Custom');
  expect(changed).toHaveBeenCalledTimes(2);
  await mocks.context.saveHandler.saveProperty(field('Custom'), {
    valueType: 'STRING',
    value: 'saved',
  });
  expect(changed).toHaveBeenCalledTimes(3);
  mocks.add.mockRejectedValueOnce(new Error('denied'));
  await expect(mocks.context.addProperty!('other')).rejects.toThrow('denied');
  expect(changed).toHaveBeenCalledTimes(3);
});

it('keeps unpinned assignments visible in the panel when title pins change', () => {
  mocks.properties = [field('Pinned', 'first'), field('Unpinned', 'second')];
  const [pins, setPins] = createSignal(['instance-Pinned']);
  render(() => (
    <EntityPropertiesSection
      entityId="document"
      entityType="DOCUMENT"
      canEdit
      showTags={false}
      defaultPinnedPropertyIds={() => []}
      pinnedPropertyIds={pins}
    />
  ));
  expect(screen.getByText('"first"')).toBeTruthy();
  expect(screen.getByText('"second"')).toBeTruthy();
  setPins([]);
  expect(screen.getByText('"first"')).toBeTruthy();
  expect(screen.getByText('"second"')).toBeTruthy();
  expect(mocks.context.properties()).toHaveLength(2);
  expect(mocks.remove).not.toHaveBeenCalled();
});

it('adds side-panel properties without exposing an automatic pin callback', () => {
  const pins: string[] = [];
  const pin = vi.fn((id: string) => pins.push(id));
  const [properties, setProperties] = createSignal<Property[]>([]);
  mocks.getProperties = properties;
  render(() => (
    <EntityPropertiesSection
      entityId="document"
      entityType="DOCUMENT"
      canEdit
      showTags={false}
      pinnedPropertyIds={() => pins}
      onPropertyPinned={pin}
      onPropertyUnpinned={vi.fn()}
    />
  ));
  mocks.context.onPropertyAdded(['Custom']);
  setProperties([field('Custom', 'saved value')]);
  mocks.context.onPropertyAdded(['Custom']);
  expect(screen.getByText('"saved value"')).toBeTruthy();
  expect(mocks.context.onPropertyPinned).toBeUndefined();
  expect(pin).not.toHaveBeenCalled();
  expect(pins).toEqual([]);
});

it('preserves an existing property without reattaching or pinning it', async () => {
  // Set when the task was created from a CRM record, but never pinned.
  mocks.properties = [field('Companies', 'Acme')];
  render(() => (
    <EntityPropertiesSection
      entityId="task"
      entityType="TASK"
      canEdit
      showTags={false}
      pinnedPropertyIds={() => []}
    />
  ));
  expect(screen.getByText('"Acme"')).toBeTruthy();

  mocks.context.onPropertyAdded(['Companies']);
  await mocks.context.addProperty!('Companies');

  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.context.onPropertyPinned).toBeUndefined();
  expect(screen.getByText('"Acme"')).toBeTruthy();
});

it('pins and unpins an assigned property without changing its value or panel visibility', async () => {
  mocks.properties = [field('Custom', 'saved value')];
  const [pins, setPins] = createSignal<string[]>([]);
  const pin = vi.fn((id: string) => setPins([id]));
  const unpin = vi.fn(() => setPins([]));
  const [canEdit, setCanEdit] = createSignal(true);
  render(() => (
    <EntityPropertiesSection
      entityId="document"
      entityType="DOCUMENT"
      canEdit={canEdit()}
      showTags={false}
      pinnedPropertyIds={pins}
      onPropertyPinned={pin}
      onPropertyUnpinned={unpin}
    />
  ));

  await fireEvent.click(
    screen.getByRole('button', { name: 'Pin below title' })
  );
  expect(pin).toHaveBeenCalledWith('instance-Custom', mocks.properties);
  expect(
    screen
      .getByRole('button', { name: 'Unpin from title' })
      .getAttribute('aria-pressed')
  ).toBe('true');
  await fireEvent.click(
    screen.getByRole('button', { name: 'Unpin from title' })
  );
  expect(unpin).toHaveBeenCalledWith(
    'instance-Custom',
    mocks.properties,
    'Custom'
  );
  expect(screen.getByText('"saved value"')).toBeTruthy();
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.context.onPropertyPinned).toBeUndefined();

  setCanEdit(false);
  expect(screen.queryByRole('button', { name: 'Pin below title' })).toBeNull();
});

it('does not offer pinning for placeholders, metadata, or hosts without title pin support', () => {
  mocks.properties = [
    { ...field('Pending'), propertyId: 'pending:Pending' },
    { ...field('Metadata'), isMetadata: true },
  ];
  render(() => (
    <EntityPropertiesSection
      entityId="document"
      entityType="DOCUMENT"
      canEdit
      includeMetadata
      showTags={false}
      pinnedPropertyIds={() => []}
      onPropertyPinned={vi.fn()}
      onPropertyUnpinned={vi.fn()}
    />
  ));
  expect(screen.queryByRole('button', { name: 'Pin below title' })).toBeNull();

  cleanup();
  mocks.properties = [field('Custom')];
  render(() => (
    <EntityPropertiesSection
      entityId="chat"
      entityType="CHAT"
      canEdit
      showTags={false}
    />
  ));
  expect(screen.queryByRole('button', { name: 'Pin below title' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Remove from entity' })
  ).toBeTruthy();
});

it('locks pin actions during removal and unpins only after removal succeeds', async () => {
  mocks.properties = [field('Custom', 'saved value')];
  let finishRemoval!: () => void;
  mocks.remove.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishRemoval = resolve;
      })
  );
  const unpin = vi.fn();
  render(() => (
    <EntityPropertiesSection
      entityId="document"
      entityType="DOCUMENT"
      canEdit
      showTags={false}
      pinnedPropertyIds={() => ['instance-Custom']}
      onPropertyPinned={vi.fn()}
      onPropertyUnpinned={unpin}
    />
  ));

  await fireEvent.click(
    screen.getByRole('button', { name: 'Remove from entity' })
  );
  expect(
    screen
      .getByRole('button', { name: 'Unpin from title' })
      .hasAttribute('disabled')
  ).toBe(true);
  expect(unpin).not.toHaveBeenCalled();
  finishRemoval();
  await vi.waitFor(() =>
    expect(unpin).toHaveBeenCalledWith(
      'instance-Custom',
      mocks.properties,
      'Custom'
    )
  );
});

it('shows implicit task defaults as pinned while preserving deletion guards and explicit empty pins', async () => {
  mocks.properties = [
    field('Status', 'Active'),
    field('Priority', 'High'),
    field('Custom', 'saved'),
  ];
  const defaults = ['Status', 'Priority'];
  const defaultIds = ['instance-Status', 'instance-Priority'];
  const [pins, setPins] = createSignal<string[] | undefined>();
  const pin = vi.fn((id: string) => setPins([...(pins() ?? defaultIds), id]));
  const unpin = vi.fn((id: string) =>
    setPins((pins() ?? defaultIds).filter((current) => current !== id))
  );
  render(() => (
    <EntityPropertiesSection
      entityId="task"
      entityType="TASK"
      canEdit
      showTags={false}
      defaultPinnedPropertyIds={() => defaults}
      defaultTitlePropertyDefinitionIds={() => defaults}
      pinnedPropertyIds={pins}
      onPropertyPinned={pin}
      onPropertyUnpinned={unpin}
    />
  ));
  expect(
    screen.getAllByRole('button', { name: 'Unpin from title' })
  ).toHaveLength(2);
  expect(
    screen.getAllByRole('button', { name: 'Remove from entity' })
  ).toHaveLength(1);
  await fireEvent.click(
    screen.getAllByRole('button', { name: 'Unpin from title' })[0]
  );
  expect(unpin).toHaveBeenCalledWith(
    'instance-Status',
    mocks.properties,
    'Status'
  );
  expect(pins()).toEqual(['instance-Priority']);
  expect(
    screen.getAllByRole('button', { name: 'Unpin from title' })
  ).toHaveLength(1);
  setPins([]);
  expect(screen.queryByRole('button', { name: 'Unpin from title' })).toBeNull();
  expect(
    screen.getAllByRole('button', { name: 'Pin below title' })
  ).toHaveLength(3);
  expect(screen.getByText('"Active"')).toBeTruthy();
  expect(screen.getByText('"High"')).toBeTruthy();
  expect(mocks.remove).not.toHaveBeenCalled();
});

it('pins and unpins a virtual default without creating or deleting an assignment', async () => {
  const placeholder = { ...field('Project'), propertyId: 'pending:Project' };
  const [pins, setPins] = createSignal<string[] | undefined>();
  const pin = vi.fn((id: string) => setPins([id]));
  const unpin = vi.fn(() => setPins([]));
  render(() => (
    <EntityPropertiesSection
      entityId="task"
      entityType="TASK"
      canEdit
      showTags={false}
      defaultProperties={() => [placeholder]}
      defaultTitlePropertyDefinitionIds={() => ['Project']}
      pinnedPropertyIds={pins}
      onPropertyPinned={pin}
      onPropertyUnpinned={unpin}
    />
  ));
  expect(
    screen.queryByRole('button', { name: 'Remove from entity' })
  ).toBeNull();
  await fireEvent.click(
    screen.getByRole('button', { name: 'Unpin from title' })
  );
  expect(pins()).toEqual([]);
  await fireEvent.click(
    screen.getByRole('button', { name: 'Pin below title' })
  );
  expect(pins()).toEqual(['pending:Project']);
  expect(pin).toHaveBeenCalledWith('pending:Project', [placeholder]);
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
