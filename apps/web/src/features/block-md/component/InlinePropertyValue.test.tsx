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
  PropertyValuePill: (props: { hoverActions?: JSX.Element }) => (
    <div>{props.hoverActions}</div>
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
function setup(canEdit = true) {
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
      <InlinePropertyValue property={property} entityId="doc" canManage />
    </PropertiesProvider>
  ));
  return { remove, unpin, refresh };
}
it('unpins without removing the saved property', async () => {
  const { remove, unpin } = setup();
  await fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
  expect(unpin).toHaveBeenCalledWith('assignment');
  expect(remove).not.toHaveBeenCalled();
});
it('removes the property assignment and its pin after a successful save', async () => {
  const { remove, unpin, refresh } = setup();
  await fireEvent.click(
    screen.getByRole('button', { name: 'Delete from item' })
  );
  await waitFor(() => expect(unpin).toHaveBeenCalledWith('assignment'));
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
