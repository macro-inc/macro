import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { usePropertiesContext } from '../../context/PropertiesContext';
import type { Property } from '../../types';
import { EntityPropertiesSection } from './EntityPropertiesSection';

type PropertiesContext = ReturnType<typeof usePropertiesContext>;
const mocks = vi.hoisted(() => ({
  properties: [] as Property[],
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
    properties: () => mocks.properties,
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
  useTagsQuery: () => ({ data: [] }),
}));
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  Layer: (props: { children: JSX.Element }) => props.children,
  Badge: () => null,
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
