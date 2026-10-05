import {
  $getPinnedProperties,
  pinnedPropertiesPlugin,
} from '@core/component/LexicalMarkdown/plugins/pinned-properties/pinnedPropertiesPlugin';
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
} from 'lexical';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { InlineTaskProperties } from './InlineTaskProperties';

const mocks = vi.hoisted(() => ({
  editor: undefined as LexicalEditor | undefined,
  properties: () => [] as Property[],
  add: vi.fn(),
  open: vi.fn<typeof openPropertyEditor>(),
  kind: 'document' as 'document' | 'task',
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
  cleanup();
  vi.clearAllMocks();
  mocks.kind = 'document';
  mocks.projectsEnabled = false;
});

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

function setup(initial: Property[] = []) {
  const editor = createEditor({
    onError: (error) => {
      throw error;
    },
  });
  editor.update(() => $getRoot().append($createParagraphNode()), {
    discrete: true,
  });
  pinnedPropertiesPlugin()(editor);
  mocks.editor = editor;
  render(() => {
    const [properties, setProperties] = createSignal(initial);
    mocks.properties = properties;
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
