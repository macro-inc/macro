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
  }) => (
    <div>
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
function setup(canEdit = true, value: Property['value'] = 'Keep this value') {
  const remove = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const save = vi
    .fn<(...args: unknown[]) => Promise<void>>()
    .mockResolvedValue(undefined);
  const unpin = vi.fn();
  const refresh = vi.fn();
  const shown = { ...property, value } as Property;
  render(() => (
    <PropertiesProvider
      entityId="doc"
      entityType="DOCUMENT"
      canEdit={canEdit}
      properties={() => [shown]}
      onRefresh={refresh}
      onPropertyAdded={refresh}
      onPropertyDeleted={refresh}
      onPropertyUnpinned={unpin}
      removeProperty={remove}
      saveHandler={{ saveProperty: save, saveDate: vi.fn() }}
    >
      <InlinePropertyValue property={shown} entityId="doc" canManage />
    </PropertiesProvider>
  ));
  return { remove, save, unpin, refresh };
}
it('unpins without removing the saved property', async () => {
  const { remove, unpin } = setup();
  await fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
  expect(unpin).toHaveBeenCalledWith('assignment', 'definition');
  expect(remove).not.toHaveBeenCalled();
});
it('unlinks by clearing the value and keeps the pin', async () => {
  const { remove, save, unpin } = setup();
  await fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]?.[1]).toEqual({ valueType: 'STRING', value: null });
  expect(unpin).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});
it('offers no unlink when the property has no value', () => {
  setup(true, null);
  expect(screen.getByRole('button', { name: 'Unpin' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull();
});
it('never offers deleting the property from the item', () => {
  setup();
  expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
});
it('hides management actions for read-only documents', () => {
  setup(false);
  expect(screen.queryByRole('button')).toBeNull();
});
