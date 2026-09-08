/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiKeys } from './ApiKeys';

const mocks = vi.hoisted(() => ({
  query: {
    isSuccess: true,
    isLoading: false,
    isError: false,
    data: [
      { id: 'key-1', name: 'Build server', createdAt: '2026-09-01T12:00:00Z' },
    ],
  },
  create: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@queries/user-api-keys/user-api-keys', () => ({
  useUserApiKeysQuery: () => mocks.query,
  useCreateUserApiKeyMutation: () => ({
    isPending: false,
    mutateAsync: mocks.create,
  }),
  useDeleteUserApiKeyMutation: () => ({
    isPending: false,
    mutateAsync: mocks.remove,
  }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@entity', () => ({ formatRelativeTimestamp: () => 'a week ago' }));
vi.mock('@channel/Bots/CredentialField', () => ({
  CredentialField: (props: { label: string; value: string }) => (
    <label>
      {props.label}
      <input readOnly value={props.value} />
    </label>
  ),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

it('validates the nested form and reveals the new secret only until leaving it', async () => {
  mocks.create.mockResolvedValue({
    id: 'created',
    name: 'Local scripts',
    key: 'test-only-secret',
  });
  const view = render(() => <ApiKeys />);
  await fireEvent.click(view.getByRole('button', { name: 'Create key' }));
  const page = within(view.getByRole('region', { name: 'New API key' }));
  expect(view.queryByRole('dialog')).toBeNull();
  await fireEvent.click(page.getByRole('button', { name: 'Create key' }));
  expect(mocks.create).not.toHaveBeenCalled();
  expect(page.getByText('API key name must not be empty')).toBeTruthy();
  await fireEvent.input(page.getByRole('textbox', { name: /Name/ }), {
    target: { value: '  Local scripts  ' },
  });
  await fireEvent.click(page.getByRole('button', { name: 'Create key' }));
  await waitFor(() =>
    expect(view.getByDisplayValue('test-only-secret')).toBeTruthy()
  );
  expect(mocks.create).toHaveBeenCalledWith({ name: 'Local scripts' });
  await fireEvent.click(view.getByRole('button', { name: 'Done' }));
  await fireEvent.click(view.getByRole('button', { name: 'Create key' }));
  expect(view.queryByDisplayValue('test-only-secret')).toBeNull();
  expect(view.getByRole('textbox', { name: /Name/ })).toHaveProperty(
    'value',
    ''
  );
});

it('requires confirmation on a nested page before revoking a key', async () => {
  mocks.remove.mockResolvedValue(undefined);
  const view = render(() => <ApiKeys />);
  await fireEvent.click(
    view.getByRole('button', { name: 'Delete Build server' })
  );
  expect(mocks.remove).not.toHaveBeenCalled();
  const page = within(view.getByRole('region', { name: 'Delete API key' }));
  expect(view.queryByRole('dialog')).toBeNull();
  await fireEvent.click(page.getByRole('button', { name: 'Cancel' }));
  expect(mocks.remove).not.toHaveBeenCalled();
  await fireEvent.click(
    view.getByRole('button', { name: 'Delete Build server' })
  );
  await fireEvent.click(view.getByRole('button', { name: 'Delete key' }));
  await waitFor(() =>
    expect(mocks.remove).toHaveBeenCalledWith({ id: 'key-1' })
  );
});
