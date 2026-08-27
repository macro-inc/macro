/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Harness } from './Harness';

const mocks = vi.hoisted(() => ({
  status: {
    data: {
      registered: false,
      defaultModelId: null as string | null,
      updatedAt: null as string | null,
    },
    isPlaceholderData: false,
  },
  models: {
    data: {
      models: [{ id: 'default-model', displayName: 'Default Model' }],
    },
  },
  save: vi.fn(),
  disconnect: vi.fn(),
  setDefaultModel: vi.fn(),
  toastSuccess: vi.fn(),
  toastFailure: vi.fn(),
}));

vi.mock('@queries/auth/cursor-api-key', () => ({
  useCursorApiKeyStatusQuery: () => mocks.status,
  useSaveCursorApiKey: () => ({
    mutateAsync: mocks.save,
    isPending: false,
  }),
  useDisconnectCursorApiKey: () => ({
    mutateAsync: mocks.disconnect,
    isPending: false,
  }),
  useCursorModelsQuery: () => mocks.models,
  useSetCursorDefaultModel: () => ({
    mutateAsync: mocks.setDefaultModel,
    isPending: false,
  }),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    success: mocks.toastSuccess,
    failure: mocks.toastFailure,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.data = {
    registered: false,
    defaultModelId: null,
    updatedAt: null,
  };
  mocks.status.isPlaceholderData = false;
  mocks.save.mockResolvedValue(undefined);
  mocks.disconnect.mockResolvedValue(undefined);
});

describe('Harness', () => {
  it('shows the three configurable harness options', () => {
    render(() => <Harness />);

    expect(screen.getByRole('heading', { name: 'In-memory' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cursor' })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Bring your own agent' })
    ).toBeTruthy();
    expect(screen.getByText(/This is not a coding harness/)).toBeTruthy();
  });

  it('validates and saves a Cursor API key', async () => {
    render(() => <Harness />);

    const apiKeyInput = screen.getByLabelText('API key');
    const saveButton = screen.getByRole('button', { name: 'Save' });

    expect(apiKeyInput).toHaveProperty('type', 'password');
    expect(saveButton).toHaveProperty('disabled', true);

    fireEvent.input(apiKeyInput, { target: { value: 'not-a-cursor-key' } });
    fireEvent.click(saveButton);

    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.toastFailure).toHaveBeenCalledWith(
      'Cursor API keys start with crsr_'
    );

    fireEvent.input(apiKeyInput, { target: { value: '  crsr_example  ' } });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledWith('crsr_example');
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Cursor connected');
      expect(apiKeyInput).toHaveProperty('value', '');
    });
  });

  it('shows connection status, the default model picker, and disconnect for connected Cursor', async () => {
    mocks.status.data = {
      registered: true,
      defaultModelId: null,
      updatedAt: '2026-08-27T12:00:00Z',
    };

    render(() => <Harness />);

    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.queryByLabelText('API key')).toBeNull();
    expect(screen.getByText(/does not revoke it in Cursor/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Default model'), {
      target: { value: 'default-model' },
    });
    await waitFor(() => {
      expect(mocks.setDefaultModel).toHaveBeenCalledWith('default-model');
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Default model updated');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => {
      expect(mocks.disconnect).toHaveBeenCalledOnce();
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Cursor disconnected');
    });
  });

  it('does not flash the API key form while connection status loads', () => {
    mocks.status.isPlaceholderData = true;

    render(() => <Harness />);

    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByLabelText('API key')).toBeNull();
  });

  it('links the empty BYOA list to the setup documentation', () => {
    render(() => <Harness />);

    expect(screen.getByText('No agents connected')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Setup guide/ })).toHaveProperty(
      'href',
      'https://docs.macro.com/AI/bring-your-own'
    );
  });
});
