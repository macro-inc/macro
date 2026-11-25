import {
  $getPinnedProperties,
  $getStoredPinnedProperties,
  ADD_PINNED_PROPERTY_COMMAND,
  pinnedPropertiesPlugin,
} from '@core/component/LexicalMarkdown/plugins/pinned-properties/pinnedPropertiesPlugin';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import {
  PropertiesProvider,
  usePropertiesContext,
} from '@property/context/PropertiesContext';
import type { openPropertyEditor } from '@property/editor/state/propertyEditor';
import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import {
  $createParagraphNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
  type SerializedEditorState,
} from 'lexical';
import { createRoot, createSignal, type Setter } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinnedProperties } from '../primitives/create-pinned-properties';
import type { MarkdownDocumentKind } from '../types';
import { InlineTaskProperties } from './InlineTaskProperties';
import { TaskComposerPropertyEditor } from './TaskComposerPropertyEditor';

const mocks = vi.hoisted(() => ({
  editor: undefined as LexicalEditor | undefined,
  properties: () => [] as Property[],
  add: vi.fn(),
  open: vi.fn<typeof openPropertyEditor>(),
  kind: 'document' as MarkdownDocumentKind,
  setProperties: undefined as Setter<Property[]> | undefined,
  fetchDefinition: vi.fn(async (_id: string): Promise<unknown> => null),
  startDates: false,
}));
const entityWrite = vi.fn();

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@property/hooks/useStartDateEnabled', () => ({
  useStartDateEnabled: () => () => mocks.startDates,
}));
vi.mock('@entity', () => ({
  InlineEntity: () => null,
  isTaskEntity: () => false,
}));
vi.mock('@entity/extractors-property', () => ({
  buildTaskProjectDefaultProperty: () => ({
    propertyId: 'pending:project',
    propertyDefinitionId: '00000001-0000-0000-0000-000000000014',
    displayName: 'Project',
    valueType: 'ENTITY',
    value: null,
    isMultiSelect: false,
    owner: { scope: 'system' },
    createdAt: '1970-01-01',
    updatedAt: '1970-01-01',
  }),
  buildStartDateDefaultProperty: () => ({
    propertyId: 'pending:start',
    propertyDefinitionId: '00000001-0000-0000-0000-000000000015',
    displayName: 'Start Date',
    valueType: 'DATE',
    value: null,
    isMultiSelect: false,
    owner: { scope: 'system' },
    createdAt: '1970-01-01',
    updatedAt: '1970-01-01',
  }),
}));
vi.mock('@property/editor/state/propertyEditor', () => ({
  openPropertyEditor: mocks.open,
}));
vi.mock('@property/component/modal', () => ({ Modals: () => null }));
vi.mock('@property/component/modal/CreatePropertyModal', () => ({
  CreatePropertyModal: (props: {
    initialName: string;
    autoPinOnCreate: boolean;
    onPropertyCreated: (id: string, definition: PropertyDefinition) => void;
    onUseBuiltIn: (id: string) => void;
  }) => (
    <>
      <button onClick={() => props.onUseBuiltIn('built-in-contacts')}>
        Use built-in
      </button>
      <button
        onClick={() =>
          props.onPropertyCreated('created-notes', {
            id: 'created-notes',
            display_name: props.initialName,
            data_type: 'STRING',
            is_multi_select: false,
            is_metadata: false,
            is_system: false,
            owner: { scope: 'system' },
            specific_entity_type: null,
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
          })
        }
      >
        Create {props.initialName}
      </button>
    </>
  ),
}));
vi.mock('@property/hooks', async () => ({
  usePropertySelection: (await import('@property/hooks/usePropertySelection'))
    .usePropertySelection,
  useEntityProperties: () => ({
    properties: () => mocks.properties(),
    refetch: vi.fn(),
    addProperty: mocks.add,
    removeProperty: vi.fn(),
  }),
}));
vi.mock('@property/tags', () => ({ InlineFetchedEntityTagsPill: () => null }));
vi.mock('@queries/properties/definitions', () => ({
  useListPropertiesQuery: () => ({ isSuccess: false }),
  fetchPropertyDefinitionWithOptions: mocks.fetchDefinition,
}));
vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: () => ({ isSuccess: true, data: [] }),
}));
vi.mock('@queries/properties/entity', () => ({
  useBulkSaveEntityPropertiesMutation: () => ({ mutateAsync: entityWrite }),
  useEntityPropertiesQuery: () => ({ data: [] }),
}));
vi.mock('@core/component/LexicalMarkdown/component/status/Progress', () => ({
  ProgressChip: () => null,
}));
vi.mock('./MarkdownNameProvider', () => ({
  useMarkdownName: () => ({ displayName: () => 'Document' }),
}));
vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({
    documentId: () => 'doc',
    kind: () => mocks.kind,
    permissions: { canEdit: () => true },
    state: { editor: { md: { editor: mocks.editor } } },
  }),
}));
vi.mock('./InlinePropertyValue', () => ({
  InlinePropertyValue: (props: {
    property: Property;
    valueText?: string;
    unlink?: { available: () => boolean; clear: () => Promise<unknown> };
  }) => {
    const context = usePropertiesContext();
    return (
      <>
        <button
          onClick={() =>
            context.onPropertyUnpinned?.(props.property.propertyId)
          }
        >
          Unpin {props.property.displayName}
          {props.valueText ? ` (${props.valueText})` : ''}
        </button>
        {props.unlink?.available() ? (
          <button
            onClick={() => {
              // The real pill reports a failed save and keeps the values.
              props.unlink?.clear().catch(() => undefined);
            }}
          >
            Unlink {props.property.displayName}
          </button>
        ) : null}
      </>
    );
  },
}));
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mocks.kind = 'document';
  mocks.startDates = false;
});

const disposers: (() => void)[] = [];

const property: Property = {
  propertyId: 'assignment',
  propertyDefinitionId: 'definition',
  displayName: 'Review notes',
  valueType: 'STRING',
  value: 'Keep this value',
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const draftDefinition: PropertyDefinitionDomain = {
  id: 'draft-notes',
  displayName: 'Draft notes',
  valueType: 'STRING',
  isMultiSelect: false,
  isMetadata: false,
  isSystem: false,
  owner: { scope: 'system' },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

function setup(initial: Property[] = [], saved?: SerializedEditorState) {
  const editor = createEditor({
    onError: (error) => {
      throw error;
    },
  });
  editor.update(() => $getRoot().append($createParagraphNode()), {
    discrete: true,
  });
  pinnedPropertiesPlugin()(editor);
  if (saved) editor.setEditorState(editor.parseEditorState(saved));
  mocks.editor = editor;
  render(() => {
    const [properties, setProperties] = createSignal(initial);
    mocks.properties = properties;
    mocks.setProperties = setProperties;
    mocks.add.mockImplementation(async () => setProperties([property]));
    return <InlineTaskProperties />;
  });
  return editor;
}

it('pins a newly assigned property and unpins without deleting its value', async () => {
  const editor = setup();
  await fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
  await mocks.open.mock.lastCall?.[3]?.onPropertyAdded?.(['definition']);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Unpin Review notes' })
    ).toBeTruthy()
  );
  expect(mocks.add).toHaveBeenCalledWith('definition');
  expect(editor.getEditorState().read($getPinnedProperties)).toEqual([
    'assignment',
  ]);
  await fireEvent.click(
    screen.getByRole('button', { name: 'Unpin Review notes' })
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Unpin Review notes' })
    ).toBeNull()
  );
  expect(editor.getEditorState().read($getPinnedProperties)).toEqual([]);
  expect(mocks.properties()[0].value).toBe('Keep this value');
});

it('pins the assignment once the server names it, not its temporary id', async () => {
  const editor = setup();
  mocks.add.mockImplementation(() => new Promise<void>(() => {}));
  await fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
  await mocks.open.mock.lastCall?.[3]?.onPropertyAdded?.(['definition']);

  mocks.setProperties?.([
    {
      ...property,
      propertyId: 'optimistic-property:DOCUMENT:doc:definition',
    },
  ]);
  expect(editor.getEditorState().read($getPinnedProperties)).toEqual([]);

  mocks.setProperties?.([property]);
  await waitFor(() =>
    expect(editor.getEditorState().read($getPinnedProperties)).toEqual([
      'assignment',
    ])
  );
});

it('repins an existing property without assigning it a second time', async () => {
  setup([property]);
  await fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
  await mocks.open.mock.lastCall?.[3]?.onPropertyAdded?.(['definition']);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Unpin Review notes' })
    ).toBeTruthy()
  );
  expect(mocks.add).not.toHaveBeenCalled();
});

it("shows a task's Project with the other task properties, through the same pill", async () => {
  mocks.kind = 'task';
  setup();
  // A task without a project still gets the standard pill, from a placeholder.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Unpin Project' })).toBeTruthy()
  );
});

const dueDate: Property = {
  ...property,
  propertyId: 'due',
  propertyDefinitionId: SYSTEM_PROPERTY_IDS.DUE_DATE,
  displayName: 'Due Date',
  valueType: 'DATE',
  value: new Date(2026, 10, 27),
};
const startDate: Property = {
  ...dueDate,
  propertyId: 'start',
  propertyDefinitionId: SYSTEM_PROPERTY_IDS.START_DATE,
  displayName: 'Start Date',
  value: new Date(2026, 10, 23),
};

it("reads a task's due date pill as the range once a start is set", async () => {
  mocks.kind = 'task';
  mocks.startDates = true;
  setup([dueDate, startDate]);
  await waitFor(() =>
    expect(
      screen.getByRole('button', {
        name: `Unpin Due Date (Nov 23 → Nov 27${new Date().getFullYear() === 2026 ? '' : ', 2026'})`,
      })
    ).toBeTruthy()
  );
  // Start Date is not a default pin, so it has no pill of its own.
  expect(screen.queryByRole('button', { name: /Unpin Start Date/ })).toBeNull();
});

it("keeps a task's due date pill as it was without start dates", async () => {
  mocks.kind = 'task';
  setup([dueDate, startDate]);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Unpin Due Date' })).toBeTruthy()
  );
});

const clearedDefinitions = () =>
  entityWrite.mock.calls.flatMap(([variables]) =>
    variables.properties
      .filter(
        (item: { apiValues: { value: unknown } }) =>
          item.apiValues.value === null
      )
      .map((item: { property: Property }) => item.property.propertyDefinitionId)
  );

it('unlinks both dates from a range pill in one save, as Clear both does', async () => {
  mocks.kind = 'task';
  mocks.startDates = true;
  setup([dueDate, startDate]);

  await fireEvent.click(
    await screen.findByRole('button', { name: 'Unlink Due Date' })
  );

  await waitFor(() =>
    expect(clearedDefinitions()).toEqual([
      SYSTEM_PROPERTY_IDS.START_DATE,
      SYSTEM_PROPERTY_IDS.DUE_DATE,
    ])
  );
  expect(entityWrite).toHaveBeenCalledTimes(1);
});

it('shows both dates cleared from the click, and both back when the save fails', async () => {
  mocks.kind = 'task';
  mocks.startDates = true;
  const save = Promise.withResolvers<void>();
  entityWrite.mockReturnValueOnce(save.promise);
  setup([dueDate, startDate]);
  const range = await screen.findByRole('button', {
    name: /^Unpin Due Date \(Nov 23 → Nov 27/,
  });

  fireEvent.click(screen.getByRole('button', { name: 'Unlink Due Date' }));

  // One step: the pill is empty before the save answers, never the due alone.
  expect(range.textContent).toBe('Unpin Due Date');
  expect(entityWrite).toHaveBeenCalledTimes(1);

  save.reject(new Error('offline'));
  await waitFor(() =>
    expect(range.textContent).toMatch(/^Unpin Due Date \(Nov 23 → Nov 27/)
  );
});

it('offers Unlink on a pill that shows only a start date, and clears it', async () => {
  mocks.kind = 'task';
  mocks.startDates = true;
  setup([{ ...dueDate, value: null } as Property, startDate]);

  await fireEvent.click(
    await screen.findByRole('button', { name: 'Unlink Due Date' })
  );

  await waitFor(() =>
    expect(clearedDefinitions()).toEqual([SYSTEM_PROPERTY_IDS.START_DATE])
  );
});

it('keeps the due date pill on its own Unlink without start dates', async () => {
  mocks.kind = 'task';
  setup([dueDate, startDate]);

  await screen.findByRole('button', { name: 'Unpin Due Date' });
  expect(screen.queryByRole('button', { name: 'Unlink Due Date' })).toBeNull();
});

const taskDefinitions = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
];
const taskProperties: Property[] = taskDefinitions.map(
  (definitionId, index) => ({
    ...property,
    propertyId: `task-${index}`,
    propertyDefinitionId: definitionId,
    displayName: ['Status', 'Priority', 'Assignees'][index],
  })
);

function setupPins(
  editor: LexicalEditor,
  defaults: readonly string[] = taskDefinitions
) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return createPinnedProperties(
      () => editor,
      () => defaults
    );
  });
}

it.each(['task', 'snippet', 'skill'] as const)(
  'renders saved pins below a %s title and unpins without losing the value',
  async (kind) => {
    mocks.kind = kind;
    const editor = setup([property]);
    editor.dispatchCommand(ADD_PINNED_PROPERTY_COMMAND, property.propertyId);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Unpin Review notes' })
      ).toBeTruthy()
    );
    await fireEvent.click(
      screen.getByRole('button', { name: 'Unpin Review notes' })
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Unpin Review notes' })
      ).toBeNull()
    );
    expect(mocks.properties()[0].value).toBe('Keep this value');
    expect(editor.getEditorState().read($getStoredPinnedProperties)).toEqual(
      []
    );
  }
);

it('preserves implicit task defaults when pinning the first additional property', async () => {
  mocks.kind = 'task';
  const properties = [...taskProperties, property];
  const editor = setup(properties);
  const pins = setupPins(editor);
  expect(
    editor.getEditorState().read($getStoredPinnedProperties)
  ).toBeUndefined();
  pins.pin(property.propertyId, properties);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Unpin Review notes' })
    ).toBeTruthy()
  );
  expect(editor.getEditorState().read($getPinnedProperties)).toEqual([
    ...taskProperties.map((item) => item.propertyId),
    property.propertyId,
  ]);
  for (const item of taskProperties) {
    expect(
      screen.getByRole('button', { name: `Unpin ${item.displayName}` })
    ).toBeTruthy();
  }
});

it('keeps consecutive pin changes before the editor commits', async () => {
  mocks.kind = 'task';
  const properties = [...taskProperties, property];
  const editor = setup(properties);
  const pins = setupPins(editor);

  pins.pin(property.propertyId, properties);
  pins.unpin(taskProperties[0].propertyId, properties);

  await waitFor(() =>
    expect(editor.getEditorState().read($getStoredPinnedProperties)).toEqual([
      taskProperties[1].propertyId,
      taskProperties[2].propertyId,
      property.propertyId,
    ])
  );
  expect(screen.queryByRole('button', { name: 'Unpin Status' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Unpin Review notes' })
  ).toBeTruthy();
});

it('unpins an implicit task default without dropping the other defaults', async () => {
  mocks.kind = 'task';
  const editor = setup(taskProperties);
  await fireEvent.click(screen.getByRole('button', { name: 'Unpin Status' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Unpin Status' })).toBeNull()
  );
  expect(editor.getEditorState().read($getPinnedProperties)).toEqual([
    taskProperties[1].propertyId,
    taskProperties[2].propertyId,
    'pending:project',
  ]);
  expect(mocks.properties()).toEqual(taskProperties);
});

it('updates task title chips in place when the properties emit new objects', async () => {
  mocks.kind = 'task';
  setup(taskProperties);
  const status = screen.getByRole('button', { name: 'Unpin Status' });

  mocks.setProperties?.(
    taskProperties.map((item) => ({
      ...item,
      displayName: `${item.displayName} saved`,
    }))
  );

  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Unpin Status saved' })).toBe(
      status
    )
  );
});

it('keeps the Project chip mounted when saving assigns its placeholder an ID', async () => {
  mocks.kind = 'task';
  setup(taskProperties);
  const project = await screen.findByRole('button', { name: 'Unpin Project' });

  mocks.setProperties?.([
    ...taskProperties,
    {
      ...property,
      propertyId: 'project-assignment',
      propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
      displayName: 'Project saved',
    },
  ]);

  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Unpin Project saved' })).toBe(
      project
    )
  );
});

it('keeps all task title pins cleared after serialization and reopening', async () => {
  mocks.kind = 'task';
  const editor = setup(taskProperties);
  for (const name of [
    ...taskProperties.map((item) => item.displayName),
    'Project',
  ]) {
    await fireEvent.click(
      screen.getByRole('button', { name: `Unpin ${name}` })
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: `Unpin ${name}` })).toBeNull()
    );
  }
  expect(editor.getEditorState().read($getStoredPinnedProperties)).toEqual([]);
  const saved = editor.getEditorState().toJSON();
  cleanup();
  const reopened = setup(taskProperties, saved);
  expect(reopened.getEditorState().read($getStoredPinnedProperties)).toEqual(
    []
  );
  expect(screen.queryByRole('button', { name: /^Unpin / })).toBeNull();
  expect(mocks.properties()).toEqual(taskProperties);
});

it('resolves a default Project placeholder after assignment and preserves its value on unpin', async () => {
  mocks.kind = 'task';
  const pendingProject: Property = {
    ...property,
    propertyId: `pending:${SYSTEM_PROPERTY_IDS.PROJECT}`,
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
    displayName: 'Project',
    value: null,
  };
  const editor = setup([...taskProperties, property]);
  const pins = setupPins(editor, [
    ...taskDefinitions,
    SYSTEM_PROPERTY_IDS.PROJECT,
  ]);
  pins.pin(property.propertyId, [...taskProperties, pendingProject, property]);
  await waitFor(() =>
    expect(editor.getEditorState().read($getPinnedProperties)).toContain(
      pendingProject.propertyId
    )
  );
  const assignedProject: Property = {
    ...pendingProject,
    propertyId: 'project-assignment',
    value: 'Assigned project',
  };
  mocks.setProperties?.([...taskProperties, assignedProject, property]);
  await waitFor(() =>
    expect(
      screen.getAllByRole('button', { name: 'Unpin Project' })
    ).toHaveLength(1)
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Unpin Project' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Unpin Project' })).toBeNull()
  );
  const savedIds = editor.getEditorState().read($getPinnedProperties);
  expect(savedIds).not.toContain(pendingProject.propertyId);
  expect(savedIds).not.toContain(assignedProject.propertyId);
  expect(savedIds).toContain(property.propertyId);
  expect(
    mocks
      .properties()
      .find((item) => item.propertyId === assignedProject.propertyId)?.value
  ).toBe('Assigned project');
});

it('clears a placeholder-backed Project pin when its assignment disappears before removal finishes', async () => {
  mocks.kind = 'task';
  const pendingProject: Property = {
    ...property,
    propertyId: `pending:${SYSTEM_PROPERTY_IDS.PROJECT}`,
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
    displayName: 'Project',
    value: null,
  };
  const properties = [...taskProperties, pendingProject, property];
  const editor = setup(properties);
  const pins = setupPins(editor, [
    ...taskDefinitions,
    SYSTEM_PROPERTY_IDS.PROJECT,
  ]);
  pins.pin(property.propertyId, properties);
  await waitFor(() =>
    expect(editor.getEditorState().read($getPinnedProperties)).toContain(
      pendingProject.propertyId
    )
  );
  pins.unpin(
    'removed-project-assignment',
    properties,
    SYSTEM_PROPERTY_IDS.PROJECT
  );
  await waitFor(() =>
    expect(editor.getEditorState().read($getPinnedProperties)).not.toContain(
      pendingProject.propertyId
    )
  );
  expect(editor.getEditorState().read($getPinnedProperties)).toContain(
    property.propertyId
  );
});

it('selects a shared property and edits its draft value without an entity write', async () => {
  const onAdd = vi.fn(async () => {});
  const [values, setValues] = createStore<Record<string, PropertyApiValues>>(
    {}
  );
  render(() => (
    <PropertiesProvider
      entityType="TASK"
      canEdit
      properties={() => []}
      onRefresh={() => {}}
      onPropertyAdded={() => {}}
      onPropertyDeleted={() => {}}
      saveHandler={{ saveProperty: async () => {}, saveDate: async () => {} }}
    >
      <TaskComposerPropertyEditor
        definitions={[draftDefinition]}
        properties={[]}
        onAdd={onAdd}
        onSave={(id, value) => setValues(id, value)}
      />
    </PropertiesProvider>
  ));

  await fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
  await fireEvent.click(screen.getByText('Draft notes'));
  await waitFor(() => expect(onAdd).toHaveBeenCalledWith('draft-notes'));
  await fireEvent.input(screen.getByPlaceholderText('Enter Draft notes'), {
    target: { value: 'Remember this' },
  });
  await fireEvent.click(screen.getByText('Set Draft notes', { exact: false }));
  await waitFor(() =>
    expect(screen.queryByPlaceholderText('Enter Draft notes')).toBeNull()
  );
  expect(values['draft-notes']).toEqual({
    valueType: 'STRING',
    value: 'Remember this',
  });
  expect(entityWrite).not.toHaveBeenCalled();

  await fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
  await fireEvent.click(screen.getByText('Draft notes'));
  await fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByPlaceholderText('Enter Draft notes')).toBeNull()
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
  expect(screen.getByText('Draft notes')).toBeTruthy();
  expect(values['draft-notes']).toEqual({
    valueType: 'STRING',
    value: 'Remember this',
  });
  expect(entityWrite).not.toHaveBeenCalled();
});

it('creates a property through the shared dialog and saves its value into the draft', async () => {
  const onAdd = vi.fn(async () => {});
  const [values, setValues] = createStore<Record<string, PropertyApiValues>>(
    {}
  );
  render(() => (
    <PropertiesProvider
      entityType="TASK"
      canEdit
      properties={() => []}
      onRefresh={() => {}}
      onPropertyAdded={() => {}}
      onPropertyDeleted={() => {}}
      saveHandler={{ saveProperty: async () => {}, saveDate: async () => {} }}
    >
      <TaskComposerPropertyEditor
        definitions={[]}
        properties={[]}
        onAdd={onAdd}
        onSave={(id, value) => setValues(id, value)}
      />
    </PropertiesProvider>
  ));

  await fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
  await fireEvent.input(screen.getByPlaceholderText('Choose a property...'), {
    target: { value: 'New notes' },
  });
  await fireEvent.click(screen.getByText('Create property "New notes"'));
  await fireEvent.click(
    screen.getByRole('button', { name: 'Create New notes' })
  );
  await waitFor(() =>
    expect(onAdd).toHaveBeenCalledWith(
      'created-notes',
      expect.objectContaining({
        definition: expect.objectContaining({
          id: 'created-notes',
          is_multi_select: false,
        }),
        property_options: [],
      })
    )
  );
  await fireEvent.input(await screen.findByPlaceholderText('Enter New notes'), {
    target: { value: 'Created value' },
  });
  await fireEvent.click(screen.getByText('Set New notes', { exact: false }));
  expect(values['created-notes']).toEqual({
    valueType: 'STRING',
    value: 'Created value',
  });
  expect(entityWrite).not.toHaveBeenCalled();
});

it('leaves creation for the built-in property the create dialog suggests', async () => {
  mocks.fetchDefinition.mockResolvedValueOnce({
    definition: {
      id: 'built-in-contacts',
      display_name: 'Built-in contacts',
      data_type: 'STRING',
      is_multi_select: false,
      is_metadata: false,
      is_system: true,
      owner: { scope: 'system' },
      specific_entity_type: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    },
    property_options: [],
  });
  const onAdd = vi.fn(async () => {});
  const [values, setValues] = createStore<Record<string, PropertyApiValues>>(
    {}
  );
  render(() => (
    <PropertiesProvider
      entityType="TASK"
      canEdit
      properties={() => []}
      onRefresh={() => {}}
      onPropertyAdded={() => {}}
      onPropertyDeleted={() => {}}
      saveHandler={{ saveProperty: async () => {}, saveDate: async () => {} }}
    >
      <TaskComposerPropertyEditor
        definitions={[]}
        properties={[]}
        onAdd={onAdd}
        onSave={(id, value) => setValues(id, value)}
      />
    </PropertiesProvider>
  ));

  await fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
  await fireEvent.input(screen.getByPlaceholderText('Choose a property...'), {
    target: { value: 'Contact' },
  });
  await fireEvent.click(screen.getByText('Create property "Contact"'));
  await fireEvent.click(screen.getByRole('button', { name: 'Use built-in' }));

  // The built-in is selected like a listed property: nothing was created.
  await waitFor(() => expect(onAdd).toHaveBeenCalledWith('built-in-contacts'));
  expect(onAdd).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Create Contact' })).toBeNull();
  await fireEvent.input(
    await screen.findByPlaceholderText('Enter Built-in contacts'),
    { target: { value: 'Ada' } }
  );
  await fireEvent.click(
    screen.getByText('Set Built-in contacts', { exact: false })
  );
  expect(values['built-in-contacts']).toEqual({
    valueType: 'STRING',
    value: 'Ada',
  });
  expect(entityWrite).not.toHaveBeenCalled();
});

it('opens the suggested built-in property on the value the draft holds', async () => {
  mocks.fetchDefinition.mockResolvedValueOnce({
    definition: {
      id: 'built-in-contacts',
      display_name: 'Built-in contacts',
      data_type: 'STRING',
      is_multi_select: false,
      is_metadata: false,
      is_system: true,
      owner: { scope: 'system' },
      specific_entity_type: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    },
    property_options: [],
  });
  render(() => (
    <PropertiesProvider
      entityType="TASK"
      canEdit
      properties={() => []}
      onRefresh={() => {}}
      onPropertyAdded={() => {}}
      onPropertyDeleted={() => {}}
      saveHandler={{ saveProperty: async () => {}, saveDate: async () => {} }}
    >
      <TaskComposerPropertyEditor
        definitions={[]}
        properties={[
          {
            propertyId: 'compose-Built-in contacts',
            propertyDefinitionId: 'built-in-contacts',
            displayName: 'Built-in contacts',
            isMultiSelect: false,
            owner: { scope: 'system' },
            specificEntityType: null,
            updatedAt: new Date(0),
            createdAt: new Date(0),
            valueType: 'STRING',
            value: 'Grace',
          },
        ]}
        onAdd={async () => {}}
        onSave={() => {}}
      />
    </PropertiesProvider>
  ));

  await fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
  await fireEvent.input(screen.getByPlaceholderText('Choose a property...'), {
    target: { value: 'Contact' },
  });
  await fireEvent.click(screen.getByText('Create property "Contact"'));
  await fireEvent.click(screen.getByRole('button', { name: 'Use built-in' }));

  // A host that edits the property with its own control never lists it, so
  // the value the editor starts from is the one the host passed in.
  expect(await screen.findByDisplayValue('Grace')).toBeTruthy();
});

it('hands focus back to the search field when the create dialog closes', async () => {
  mocks.fetchDefinition.mockResolvedValueOnce({
    definition: {
      id: 'built-in-contacts',
      display_name: 'Built-in contacts',
      data_type: 'STRING',
      is_multi_select: false,
      is_metadata: false,
      is_system: true,
      owner: { scope: 'system' },
      specific_entity_type: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    },
    property_options: [],
  });
  render(() => (
    <PropertiesProvider
      entityType="TASK"
      canEdit
      properties={() => []}
      onRefresh={() => {}}
      onPropertyAdded={() => {}}
      onPropertyDeleted={() => {}}
      saveHandler={{ saveProperty: async () => {}, saveDate: async () => {} }}
    >
      <TaskComposerPropertyEditor
        definitions={[]}
        properties={[]}
        onAdd={async () => {}}
        onSave={() => {}}
      />
    </PropertiesProvider>
  ));

  await fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
  await fireEvent.input(screen.getByPlaceholderText('Choose a property...'), {
    target: { value: 'Contact' },
  });
  await fireEvent.click(screen.getByText('Create property "Contact"'));
  // A press focuses the button, and the dialog takes that focus with it when
  // it unmounts. Left on the page, the next keys would reach app shortcuts.
  const useBuiltIn = screen.getByRole('button', { name: 'Use built-in' });
  useBuiltIn.focus();
  await fireEvent.click(useBuiltIn);

  const value = await screen.findByPlaceholderText('Enter Built-in contacts');
  expect(document.activeElement).toBe(value);
});
