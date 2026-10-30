import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { PropertiesProvider } from '@property/context/PropertiesContext';
import type { Property } from '@property/types';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { InlinePropertyValue } from './InlinePropertyValue';

vi.mock('@property/component/PropertyValuePill', () => ({
  PropertyValuePill: (props: {
    hoverActions?: JSX.Element;
    hoverTrailingAction?: JSX.Element;
    opensProject?: boolean;
  }) => (
    <div>
      {props.opensProject ? 'Opens project' : 'Plain pill'}
      {props.hoverTrailingAction}
      {props.hoverActions}
    </div>
  ),
}));
vi.mock('@property/editor/state/propertyEditor', () => ({
  openPropertyEditor: vi.fn(),
}));
afterEach(cleanup);

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
function setup(canEdit = true, canRemove = true) {
  const remove = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const unpin = vi.fn();
  const refresh = vi.fn();
  render(() => (
    <PropertiesProvider
      entityId="doc"
      entityType="DOCUMENT"
      canEdit={canEdit}
      properties={() => [property]}
      onRefresh={refresh}
      onPropertyAdded={refresh}
      onPropertyDeleted={refresh}
      onPropertyUnpinned={unpin}
      removeProperty={remove}
      saveHandler={{ saveProperty: vi.fn(), saveDate: vi.fn() }}
    >
      <InlinePropertyValue
        property={property}
        entityId="doc"
        canManage
        canRemove={canRemove}
      />
    </PropertiesProvider>
  ));
  return { remove, unpin, refresh };
}
it('unpins without removing the saved property', async () => {
  const { remove, unpin } = setup();
  await fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
  expect(unpin).toHaveBeenCalledWith('assignment', 'definition');
  expect(remove).not.toHaveBeenCalled();
});
it('removes the property assignment and its pin after a successful save', async () => {
  const { remove, unpin, refresh } = setup();
  await fireEvent.click(
    screen.getByRole('button', { name: 'Delete from item' })
  );
  await waitFor(() =>
    expect(unpin).toHaveBeenCalledWith('assignment', 'definition')
  );
  expect(remove).toHaveBeenCalledWith('assignment');
  expect(refresh).toHaveBeenCalledOnce();
});
it('keeps the pin if removing the property fails', async () => {
  const { remove, unpin, refresh } = setup();
  remove.mockRejectedValue(new Error('Save failed'));
  await fireEvent.click(
    screen.getByRole('button', { name: 'Delete from item' })
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Delete from item' })
        .hasAttribute('disabled')
    ).toBe(false)
  );
  expect(unpin).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
it('hides management actions for read-only documents', () => {
  setup(false);
  expect(screen.queryByRole('button')).toBeNull();
});

it('allows unpinning protected task properties without exposing deletion', () => {
  setup(true, false);
  expect(screen.getByRole('button', { name: 'Unpin' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Delete from item' })).toBeNull();
});

it("opens a saved task's project, but never from a composer's draft", () => {
  const project: Property = {
    ...property,
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
    displayName: 'Project',
    valueType: 'ENTITY',
    specificEntityType: 'INITIATIVE',
    value: [{ entity_id: 'launch', entity_type: 'INITIATIVE' }],
  };
  const renderPill = (entityId?: string) =>
    render(() => (
      <PropertiesProvider
        entityId={entityId ?? 'draft'}
        entityType="TASK"
        canEdit
        properties={() => [project]}
        onRefresh={vi.fn()}
        onPropertyAdded={vi.fn()}
        onPropertyDeleted={vi.fn()}
        saveHandler={{ saveProperty: vi.fn(), saveDate: vi.fn() }}
      >
        <InlinePropertyValue property={project} entityId={entityId} />
      </PropertiesProvider>
    ));

  renderPill('task');
  expect(screen.getByText('Opens project')).toBeTruthy();
  cleanup();

  renderPill();
  expect(screen.getByText('Plain pill')).toBeTruthy();
});
