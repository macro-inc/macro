import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type ComponentProps, createSignal, type ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PropertyRootContext,
  type PropertyRootContextValue,
} from '../../core/context';
import type { SelectProperty } from '../../types';
import type { PropertyOptionSelector } from '../selectors/PropertyOptionSelector';
import { SelectEditor } from './SelectEditor';

vi.mock('@queries/properties/options', () => ({
  usePropertyOptionsQuery: () => ({ data: [], isLoading: false }),
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
