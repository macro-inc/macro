import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type ParentProps, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { TasksCreateAction } from './tasks-create-action';

const mocks = vi.hoisted(() => ({
  popover: vi.fn(),
  create: vi.fn(),
  properties: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@queries/properties/entity', () => ({
  fetchEntityProperties: mocks.properties,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ popoverSplit: mocks.popover }),
}));
vi.mock('@app/features/block-md/util/taskComposerProperties', () => ({
  createTaskWithProperties: mocks.create,
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ isSuccess: true, data: { team: {} } }),
}));
vi.mock('./components/TasksCreateMenu', () => ({
  TasksCreateMenu: (props: { onCreateSubtask: () => void }) => (
    <button onClick={props.onCreateSubtask}>Subtask</button>
  ),
}));
vi.mock('@property/editors/selectors/PropertyEntitySelector', () => ({
  PropertyEntitySelector: (props: {
    setSelectedOptions: (ids: Set<string>) => void;
  }) => (
    <button onClick={() => props.setSelectedOptions(new Set(['parent-1']))}>
      Choose parent
    </button>
  ),
}));
vi.mock('@app/features/property/tags/TagEditorDialog', () => ({
  TagEditorDialog: () => null,
}));
vi.mock('@ui', () => ({
  Dialog: Object.assign(
    (props: ParentProps<{ open: boolean }>) => (
      <Show when={props.open}>
        <div>{props.children}</div>
      </Show>
    ),
    { Title: (props: ParentProps) => <h2>{props.children}</h2> }
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('passes the chosen parent into one task creation and warns without retrying if linking was rejected', async () => {
  render(() => <TasksCreateAction presentation="toolbar" projectsEnabled />);
  fireEvent.click(screen.getByRole('button', { name: 'Subtask' }));
  expect(mocks.popover).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Choose parent' }));
  const request = mocks.popover.mock.calls[0][0];
  mocks.create.mockResolvedValue({ documentId: 'child-1' });
  mocks.properties.mockResolvedValue([]);
  const definitions = new Map();
  const history = vi.fn();
  const values = [
    [
      SYSTEM_PROPERTY_IDS.PARENT_TASK,
      {
        valueType: 'ENTITY',
        refs: [{ entity_id: 'stale-parent', entity_type: 'TASK' }],
      },
    ],
  ];
  await request.params.createTask(
    'Step',
    'Details',
    values,
    definitions,
    history
  );
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
    'Step',
    'Details',
    [
      [
        SYSTEM_PROPERTY_IDS.PARENT_TASK,
        {
          valueType: 'ENTITY',
          refs: [{ entity_id: 'parent-1', entity_type: 'TASK' }],
        },
      ],
    ],
    definitions,
    history,
    undefined
  );
  expect(mocks.failure).toHaveBeenCalledWith(
    expect.stringContaining('do not create it again')
  );
  mocks.failure.mockClear();
  mocks.properties.mockResolvedValue([
    {
      propertyDefinitionId: SYSTEM_PROPERTY_IDS.PARENT_TASK,
      valueType: 'ENTITY',
      value: [{ entity_id: 'parent-1', entity_type: 'TASK' }],
    },
  ]);
  await request.params.createTask('Step', 'Details', [], definitions, history);
  expect(mocks.failure).not.toHaveBeenCalled();
});
