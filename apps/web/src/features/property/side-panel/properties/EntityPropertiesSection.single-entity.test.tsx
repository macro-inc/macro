import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { usePropertiesContext } from '../../context/PropertiesContext';
import type { EntityProperty, Property } from '../../types';
import { EntityPropertiesSection } from './EntityPropertiesSection';

type PropertiesContext = ReturnType<typeof usePropertiesContext>;
const mocks = vi.hoisted(() => ({
  properties: [] as Property[],
  context: undefined as unknown as PropertiesContext,
  openDocument: vi.fn(),
  openProject: vi.fn(),
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
vi.mock('@core/constant/allBlocks', () => ({ itemToBlockName: vi.fn() }));
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
vi.mock('../../hooks/usePropertyEntityDisplay', () => ({
  usePropertyEntityDisplay: (
    id: () => string,
    type: () => string | undefined
  ) => ({
    name: () =>
      ({ 'fix-login': 'Fix login', launch: 'Launch', grace: 'Grace Hopper' })[
        id()
      ],
    icon: () => null,
    isLoading: () => false,
    linkParams: () => undefined,
    nativeProjectId: () => (type() === 'INITIATIVE' ? id() : undefined),
    blockOrFileType: () => (type() === 'TASK' ? 'task' : null),
  }),
}));
vi.mock('@property/hooks', async () => ({
  useEntityProperties: () => ({
    properties: () => mocks.properties,
    isLoading: () => false,
    error: () => undefined,
    refetch: vi.fn(),
    isCacheMaintained: () => true,
    addProperty: vi.fn(),
    removeProperty: vi.fn(),
  }),
  usePropertyEntityDisplay: (
    await import('../../hooks/usePropertyEntityDisplay')
  ).usePropertyEntityDisplay,
}));
vi.mock('@property/tags', () => ({
  isTaggableEntityType: () => false,
  TagsRow: () => null,
}));
vi.mock('@property/utils', async () => {
  const guards = await import('../../utils/typeGuards');
  return { hasValue: guards.hasValue, getEntityValues: guards.getEntityValues };
});
vi.mock('@queries/preview', () => ({
  isAccessiblePreviewItem: vi.fn(),
  useItemPreview: vi.fn(),
}));
vi.mock('@queries/properties/entity', () => ({
  useBulkSaveEntityPropertiesMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: () => ({ isSuccess: true, data: [] }),
}));
vi.mock('./entity-collection-drop', () => ({
  createEntityCollectionDropTarget: () => undefined,
}));
// The real root owns the picker's open state. The plain pill and the picker are
// stand-ins: the pill opens the picker, as the real one does.
vi.mock('@property', async () => {
  const { Root } = await import('../../core/Root');
  const { useProperty } = await import('../../core/context');
  const children = (props: { children?: JSX.Element }) => props.children;
  return {
    useProperty,
    Property: {
      Root,
      Tooltip: children,
      Pill: (props: { children?: JSX.Element }) => {
        const ctx = useProperty();
        return (
          <button
            type="button"
            aria-label="Plain pill"
            onClick={(event) => ctx.openEditor(event.currentTarget)}
          >
            {props.children}
          </button>
        );
      },
      Icon: () => null,
      Text: () => null,
      Caret: () => null,
      Empty: (props: { label: JSX.Element }) => <span>{props.label}</span>,
      PopoverEditor: () => (
        <output>
          {useProperty().editorOpen() ? 'Picker open' : 'Picker closed'}
        </output>
      ),
    },
  };
});

function single(
  displayName: string,
  value: EntityProperty['value'],
  specificEntityType: EntityProperty['specificEntityType'] = null
): EntityProperty {
  return {
    propertyId: `instance-${displayName}`,
    propertyDefinitionId: displayName,
    displayName,
    valueType: 'ENTITY',
    specificEntityType,
    isMultiSelect: false,
    value,
    owner: { scope: 'user', user_id: 'macro|owner@example.com' },
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

function renderPanel(canEdit = true) {
  render(() => (
    <EntityPropertiesSection
      entityId="task"
      entityType="TASK"
      canEdit={canEdit}
      showTags={false}
    />
  ));
}

beforeEach(() => {
  mocks.openDocument.mockClear();
  mocks.openProject.mockClear();
  mocks.properties = [
    single(
      'Parent Task',
      [{ entity_id: 'fix-login', entity_type: 'TASK' }],
      'TASK'
    ),
  ];
});
afterEach(cleanup);

it('opens the linked item from its name, in a new split on shift, and leaves the picker closed', () => {
  renderPanel();
  const name = screen.getByRole('button', { name: 'Open Fix login' });

  fireEvent.click(name);
  expect(mocks.openDocument).toHaveBeenLastCalledWith(
    'task',
    'fix-login',
    undefined,
    false
  );
  fireEvent.click(name, { shiftKey: true });
  expect(mocks.openDocument).toHaveBeenLastCalledWith(
    'task',
    'fix-login',
    undefined,
    true
  );
  expect(screen.getByText('Picker closed')).toBeTruthy();
});

it('changes the value from its own control without opening the item', () => {
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: 'Change Parent Task' }));
  expect(screen.getByText('Picker open')).toBeTruthy();
  expect(mocks.openDocument).not.toHaveBeenCalled();
});

it('gives a viewer the link without the control that changes it', () => {
  renderPanel(false);
  expect(
    screen.queryByRole('button', { name: 'Change Parent Task' })
  ).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Open Fix login' }));
  expect(mocks.openDocument).toHaveBeenCalledWith(
    'task',
    'fix-login',
    undefined,
    false
  );
});

it('opens a project value as a project', () => {
  mocks.properties = [
    single('Related', [{ entity_id: 'launch', entity_type: 'INITIATIVE' }]),
  ];
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: 'Open project Launch' }));
  expect(mocks.openProject).toHaveBeenCalledWith('layout', 'launch', {
    newSplit: false,
  });
  expect(screen.getByText('Picker closed')).toBeTruthy();
});

it('keeps one pill that opens the picker for an empty value or a person', () => {
  mocks.properties = [
    single('Parent Task', null, 'TASK'),
    single('Related', [{ entity_id: 'grace', entity_type: 'USER' }]),
  ];
  renderPanel();
  expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();

  const pills = screen.getAllByRole('button', { name: 'Plain pill' });
  expect(pills).toHaveLength(2);
  fireEvent.click(pills[1]);
  expect(screen.getAllByText('Picker open')).toHaveLength(1);
  expect(mocks.openDocument).not.toHaveBeenCalled();
});
