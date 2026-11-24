import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import type { Property } from '../types';
import { PropertiesProvider, usePropertiesContext } from './PropertiesContext';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
}));

vi.mock('../editor/state/propertyEditor', () => ({
  openPropertyEditor: mocks.open,
}));

afterEach(() => {
  cleanup();
  mocks.open.mockReset();
});

function OpenSelector() {
  const context = usePropertiesContext();
  context.openPropertySelector();
  return null;
}

function openSelector(
  addProperty: () => Promise<void>,
  onPropertyAddFailed = vi.fn()
) {
  const onPropertyAdded = vi.fn();
  render(() => (
    <PropertiesProvider
      entityId="contact-1"
      entityType="CONTACT"
      canEdit
      properties={(): Property[] => []}
      onRefresh={() => {}}
      onPropertyAdded={onPropertyAdded}
      onPropertyAddFailed={onPropertyAddFailed}
      onPropertyDeleted={() => {}}
      addProperty={addProperty}
      saveHandler={{
        saveProperty: async () => {},
        saveDate: async () => {},
      }}
    >
      <OpenSelector />
    </PropertiesProvider>
  ));
  const { onPropertyAdded: picked } = mocks.open.mock.lastCall![3];
  return { picked, onPropertyAdded, onPropertyAddFailed };
}

it('lets the editor go on while the add is still being sent', async () => {
  const addProperty = vi.fn(() => new Promise<void>(() => {}));
  const { picked, onPropertyAdded } = openSelector(addProperty);

  await picked(['fruit']);

  expect(addProperty).toHaveBeenCalledWith('fruit');
  expect(onPropertyAdded).toHaveBeenCalledWith(['fruit']);
});

it('takes the placeholder row away when the add fails', async () => {
  const { picked, onPropertyAddFailed } = openSelector(() =>
    Promise.reject(new Error('denied'))
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await picked(['fruit']);

  await vi.waitFor(() =>
    expect(onPropertyAddFailed).toHaveBeenCalledWith('fruit')
  );
});
