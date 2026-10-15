import {
  $getPinnedProperties,
  $getStoredPinnedProperties,
  ADD_PINNED_PROPERTY_COMMAND,
  pinnedPropertiesPlugin,
} from '@core/component/LexicalMarkdown/plugins/pinned-properties/pinnedPropertiesPlugin';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { usePropertiesContext } from '@property/context/PropertiesContext';
import type { openPropertyEditor } from '@property/editor/state/propertyEditor';
import type { Property } from '@property/types';
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
import { afterEach, expect, it, vi } from 'vitest';
import { createPinnedProperties } from '../primitives/create-pinned-properties';
import type { MarkdownDocumentKind } from '../types';
import { InlineTaskProperties } from './InlineTaskProperties';

const mocks = vi.hoisted(() => ({
  editor: undefined as LexicalEditor | undefined,
  properties: () => [] as Property[],
  add: vi.fn(),
  open: vi.fn<typeof openPropertyEditor>(),
  kind: 'document' as MarkdownDocumentKind,
  setProperties: undefined as Setter<Property[]> | undefined,
  projectsEnabled: false,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.projectsEnabled }),
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
}));
vi.mock('@property/editor/state/propertyEditor', () => ({
  openPropertyEditor: mocks.open,
}));
vi.mock('@property/component/modal', () => ({ Modals: () => null }));
vi.mock('@property/hooks', () => ({
  useEntityProperties: () => ({
    properties: () => mocks.properties(),
    refetch: vi.fn(),
    addProperty: mocks.add,
    removeProperty: vi.fn(),
  }),
}));
vi.mock('@property/tags', () => ({ InlineFetchedEntityTagsPill: () => null }));
vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: () => ({ isSuccess: true, data: [] }),
}));
vi.mock('@queries/properties/entity', () => ({
  useBulkSaveEntityPropertiesMutation: () => ({ mutateAsync: vi.fn() }),
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
  InlinePropertyValue: (props: { property: Property }) => {
    const context = usePropertiesContext();
    return (
      <button
        onClick={() => context.onPropertyUnpinned?.(props.property.propertyId)}
      >
        Unpin {props.property.displayName}
      </button>
    );
  },
}));
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  cleanup();
  vi.clearAllMocks();
  mocks.kind = 'document';
  mocks.projectsEnabled = false;
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
  mocks.projectsEnabled = true;
  setup();
  // A task without a project still gets the standard pill, from a placeholder.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Unpin Project' })).toBeTruthy()
  );

  cleanup();
  mocks.projectsEnabled = false;
  setup();
  expect(screen.queryByRole('button', { name: 'Unpin Project' })).toBeNull();
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
  ]);
  expect(mocks.properties()).toEqual(taskProperties);
});

it('keeps all task title pins cleared after serialization and reopening', async () => {
  mocks.kind = 'task';
  const editor = setup(taskProperties);
  for (const item of taskProperties) {
    await fireEvent.click(
      screen.getByRole('button', { name: `Unpin ${item.displayName}` })
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: `Unpin ${item.displayName}` })
      ).toBeNull()
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
  mocks.projectsEnabled = true;
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
  mocks.projectsEnabled = true;
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
