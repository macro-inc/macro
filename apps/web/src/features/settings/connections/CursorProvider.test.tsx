/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CursorProvider } from './CursorProvider';

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
    isSuccess: true,
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

beforeAll(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.data = {
    registered: false,
    defaultModelId: null,
    updatedAt: null,
  };
  mocks.status.isPlaceholderData = false;
  mocks.models.data = {
    models: [{ id: 'default-model', displayName: 'Default Model' }],
  };
  mocks.save.mockResolvedValue(undefined);
  mocks.disconnect.mockResolvedValue(undefined);
});

describe('CursorProvider', () => {
  it('validates and saves a Cursor API key', async () => {
    render(() => <CursorProvider />);

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

  it('shows the default model picker and disconnect when connected', async () => {
    mocks.status.data = {
      registered: true,
      defaultModelId: null,
      updatedAt: '2026-08-27T12:00:00Z',
    };
    mocks.models.data = {
      models: [
        { id: 'default-model', displayName: 'Default Model' },
        { id: 'grok-4.6', displayName: 'Grok 4.6' },
      ],
    };

    render(() => <CursorProvider />);

    expect(screen.getByRole('img', { name: 'Connected' })).toBeTruthy();
    expect(screen.queryByLabelText('API key')).toBeNull();
    const picker = screen.getByRole('button', { name: /Default Model/ });
    expect(picker.textContent).toContain('Default Model');
    expect(picker.getAttribute('aria-haspopup')).toBe('listbox');

    fireEvent.click(
      screen.getByRole('button', { name: 'Disconnect from Macro' })
    );

    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(
      screen.getAllByText(/does not revoke the key in Cursor/).length
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => {
      expect(mocks.disconnect).toHaveBeenCalledOnce();
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Cursor disconnected');
    });
  });

  it('does not flash the API key form while connection status loads', () => {
    mocks.status.isPlaceholderData = true;

    render(() => <CursorProvider />);

    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(screen.queryByLabelText('API key')).toBeNull();
  });

  it('shows Loading models while the roster is empty', () => {
    mocks.status.data = {
      registered: true,
      defaultModelId: null,
      updatedAt: '2026-08-27T12:00:00Z',
    };
    mocks.models.data = { models: [] };

    render(() => <CursorProvider />);

    const picker = document.getElementById('cursor-default-model');
    expect(picker).toBeTruthy();
    expect(picker).toHaveProperty('disabled', true);
    expect(picker?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status', { name: 'Loading models' })).toBeTruthy();
    expect(screen.queryByText('Loading models…')).toBeNull();
  });
});
