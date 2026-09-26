import { projectDefinitionProperties } from '@app/features/projects/queries/project-properties';
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@property/identifiers';
import type { PropertyOption } from '@property/types';
import { withProjectStatusOptions } from '@property/utils/select-options';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import {
  type ComponentProps,
  createSignal,
  For,
  type ParentProps,
} from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PropertyRootContext,
  type PropertyRootContextValue,
} from '../../core/context';
import type { SelectProperty } from '../../types';
import type { PropertyOptionSelector } from '../selectors/PropertyOptionSelector';
import { SelectEditor } from './SelectEditor';

const catalog = vi.hoisted(() => ({ options: [] as PropertyOption[] }));

vi.mock('@queries/properties/options', () => ({
  usePropertyOptionsQuery: () => ({ data: catalog.options, isLoading: false }),
  useAddPropertyOptionMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('../../utils', async () => ({
  ...(await import('../../utils/typeGuards')),
  ...(await import('../../utils/formatting')),
}));

// Keep the real editor state/save coordination; the presentation stubs expose
// selection and dismissal without the floating UI or option-search machinery.
vi.mock('./EditorPopover', () => ({
  EditorPopover: (props: ParentProps<{ onClose: () => void }>) => (
    <div role="dialog">
      {props.children}
      <button onClick={props.onClose}>Dismiss</button>
    </div>
  ),
}));

vi.mock('../selectors/PropertyOptionSelector', () => ({
  PropertyOptionSelector: (
    props: ComponentProps<typeof PropertyOptionSelector>
  ) => (
    <>
      <ul aria-label="Available options">
        <For each={props.options}>{(option) => <li>{option.label}</li>}</For>
      </ul>
      <button
        onClick={() => {
          props.onToggleOption('doing');
          if (!props.config.isMultiSelect) props.onClose?.();
        }}
      >
        Pick option
      </button>
      <button
        onClick={() => {
          props.clearOption?.onClear();
          props.onClose?.();
        }}
      >
        Clear
      </button>
    </>
  ),
}));

const property: SelectProperty = {
  propertyId: 'status-assignment',
  propertyDefinitionId: 'status-definition',
  displayName: 'Status',
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
  valueType: 'SELECT_STRING',
  value: ['todo'],
};

function setup(value = property) {
  const pending = Promise.withResolvers<void>();
  const onSave = vi.fn(() => pending.promise);
  const onRefresh = vi.fn();
  const [editorOpen, setEditorOpen] = createSignal(true);
  const context: PropertyRootContextValue = {
    property: () => value,
    canEdit: () => true,
    editorOpen,
    openEditor: () => setEditorOpen(true),
    closeEditor: () => setEditorOpen(false),
    onSave,
    onRefresh,
  };
  render(() => (
    <PropertyRootContext.Provider value={context}>
      <SelectEditor />
    </PropertyRootContext.Provider>
  ));
  return { pending, onSave, onRefresh, context };
}

afterEach(cleanup);
beforeEach(() => {
  catalog.options = [];
});

it('offers only the three project statuses even when the shared catalog contains task statuses', () => {
  catalog.options = Object.entries(PROPERTY_OPTION_IDS.STATUS).map(
    ([name, id], display_order) => ({
      id,
      property_definition_id: SYSTEM_PROPERTY_IDS.STATUS,
      value: { type: 'string', value: name },
      display_order,
      created_at: '',
      updated_at: '',
    })
  );
  const [projectStatus] = projectDefinitionProperties([
    {
      definition: {
        id: SYSTEM_PROPERTY_IDS.STATUS,
        display_name: 'Status',
        data_type: 'SELECT_STRING',
        is_system: true,
        is_metadata: false,
        is_multi_select: false,
        owner: { scope: 'system' },
        created_at: '',
        updated_at: '',
      },
      property_options: catalog.options,
    },
  ]);
  if (projectStatus.valueType !== 'SELECT_STRING')
    throw new Error('Expected status');
  setup(projectStatus);
  expect(
    screen.getAllByRole('listitem').map((item) => item.textContent)
  ).toEqual(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']);
});

it('keeps all task statuses available', () => {
  catalog.options = Object.entries(PROPERTY_OPTION_IDS.STATUS).map(
    ([name, id], display_order) => ({
      id,
      property_definition_id: SYSTEM_PROPERTY_IDS.STATUS,
      value: { type: 'string', value: name },
      display_order,
      created_at: '',
      updated_at: '',
    })
  );
  setup({ ...property, propertyDefinitionId: SYSTEM_PROPERTY_IDS.STATUS });
  expect(
    screen.getAllByRole('listitem').map((item) => item.textContent)
  ).toEqual([
    'NOT_STARTED',
    'IN_PROGRESS',
    'IN_REVIEW',
    'COMPLETED',
    'CANCELED',
  ]);
});

it('does not rewrite an existing project status when its picker is dismissed', () => {
  const historicalStatus = {
    ...property,
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.STATUS,
    value: [PROPERTY_OPTION_IDS.STATUS.IN_REVIEW],
  };
  const scoped = withProjectStatusOptions(historicalStatus);
  if (scoped.valueType !== 'SELECT_STRING') throw new Error('Expected status');
  const { onSave } = setup(scoped);
  fireEvent.click(screen.getByText('Dismiss'));
  expect(onSave).not.toHaveBeenCalled();
  expect(scoped.value).toEqual(historicalStatus.value);
});

describe('SelectEditor save dismissal', () => {
  it('closes immediately while saving the selected status', async () => {
    const { pending, onSave, onRefresh, context } = setup();

    fireEvent.click(screen.getByText('Pick option'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSave).toHaveBeenCalledExactlyOnceWith(property, {
      valueType: 'SELECT_STRING',
      values: ['doing'],
    });
    expect(onRefresh).not.toHaveBeenCalled();

    // A slow earlier save must not dismiss a newly opened editor.
    context.openEditor();
    expect(screen.queryByRole('dialog')).not.toBeNull();
    pending.resolve();
    await pending.promise;
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('stays closed on a failed save without refreshing or resubmitting', async () => {
    const { pending, onSave, onRefresh } = setup();

    fireEvent.click(screen.getByText('Pick option'));
    expect(screen.queryByRole('dialog')).toBeNull();

    pending.reject(new Error('save failed'));
    await Promise.resolve();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('closes without saving when nothing changed', () => {
    const { onSave, onRefresh } = setup();

    fireEvent.click(screen.getByText('Dismiss'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('captures accumulated multi-select values before unmounting on dismissal', async () => {
    const multi = { ...property, isMultiSelect: true };
    const { pending, onSave } = setup(multi);

    fireEvent.click(screen.getByText('Pick option'));
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Dismiss'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSave).toHaveBeenCalledExactlyOnceWith(multi, {
      valueType: 'SELECT_STRING',
      values: ['todo', 'doing'],
    });
    pending.resolve();
    await pending.promise;
  });

  it('preserves numeric selection and clearing semantics', async () => {
    const numeric: SelectProperty = {
      ...property,
      valueType: 'SELECT_NUMBER',
    };
    const { pending, onSave } = setup(numeric);

    fireEvent.click(screen.getByText('Clear'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSave).toHaveBeenCalledExactlyOnceWith(numeric, {
      valueType: 'SELECT_NUMBER',
      values: null,
    });
    pending.resolve();
    await pending.promise;
  });
});
