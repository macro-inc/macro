/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CursorConnectPage } from './CursorConnectPage';
import { chooseModelOption } from './tests/select-helpers';

vi.mock('@ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ui')>()),
  confirmDialog: vi.fn(async () => true),
}));

const mocks = vi.hoisted(() => ({
  status: {
    isSuccess: true,
    isError: false,
    isPlaceholderData: false,
    data: {
      registered: false,
      defaultModelId: null as string | null,
      defaultEffort: null as string | null,
      updatedAt: null as string | null,
    },
  },
  models: {
    data: {
      status: 'available' as const,
      currentModel: 'default-model',
      models: [
        { id: 'default-model', name: 'Default Model' },
        { id: 'composer', name: 'Composer' },
      ],
    },
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  },
  save: vi.fn(),
  disconnect: vi.fn(),
  setDefaultModel: vi.fn(),
  toastSuccess: vi.fn(),
  toastFailure: vi.fn(),
  capabilityTargets: [] as unknown[],
  composerEffort: {
    id: 'reasoning_effort',
    name: 'Reasoning effort',
    description: null,
    category: 'thought_level',
    type: 'select' as const,
    currentValue: 'low',
    options: [
      { name: 'Low', value: 'low', description: null, group: null },
      { name: 'High', value: 'high', description: null, group: null },
    ],
  },
}));

vi.mock('@queries/auth/cursor-api-key', () => ({
  useCursorApiKeyStatusQuery: () => mocks.status,
  useSaveCursorApiKey: () => ({ mutateAsync: mocks.save, isPending: false }),
  useDisconnectCursorApiKey: () => ({
    mutateAsync: mocks.disconnect,
    isPending: false,
  }),
  useSetCursorDefaultModel: () => ({
    mutateAsync: mocks.setDefaultModel,
    isPending: false,
  }),
}));

vi.mock('@queries/agents/models', () => ({
  useAgentModelsQuery: () => mocks.models,
}));

vi.mock('@queries/agents/capabilities', () => ({
  useAgentCapabilitiesQuery: (
    target: () => { harness: string; model?: string } | undefined
  ) => ({
    isPending: false,
    get data() {
      const request = target();
      mocks.capabilityTargets.push(request);
      return {
        configOptions:
          request?.model === 'composer' ? [mocks.composerEffort] : [],
      };
    },
  }),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.toastSuccess, failure: mocks.toastFailure },
}));

beforeAll(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.isSuccess = true;
  mocks.status.isError = false;
  mocks.status.isPlaceholderData = false;
  mocks.status.data = {
    registered: false,
    defaultModelId: null,
    defaultEffort: null,
    updatedAt: null,
  };
  mocks.capabilityTargets = [];
  mocks.save.mockResolvedValue(undefined);
  mocks.disconnect.mockResolvedValue(undefined);
  mocks.setDefaultModel.mockResolvedValue(undefined);
});

describe('CursorConnectPage', () => {
  it('guides a new connection: where to get the key, paste it, connect', async () => {
    render(() => <CursorConnectPage onClose={vi.fn()} />);

    expect(
      screen.getByRole('heading', { name: 'Connect Cursor' })
    ).toBeTruthy();
    expect(
      screen.getByRole('img', { name: /API & SSH Keys selected/ })
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /Open API & SSH Keys/ })
    ).toHaveProperty('href', 'https://cursor.com/dashboard/api');
    expect(screen.getByText('Available once Cursor is connected')).toBeTruthy();

    const apiKey = screen.getByLabelText('API key');
    await waitFor(() => expect(document.activeElement).toBe(apiKey));
    expect(apiKey).toHaveProperty('type', 'password');

    const connect = screen.getByRole('button', { name: 'Connect Cursor' });
    expect(connect).toHaveProperty('disabled', true);

    fireEvent.input(apiKey, { target: { value: 'not-a-cursor-key' } });
    fireEvent.click(connect);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.toastFailure).toHaveBeenCalledWith(
      'Cursor API keys start with grok_ or crsr_'
    );

    fireEvent.input(apiKey, { target: { value: '  grok_example  ' } });
    fireEvent.click(connect);
    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledWith('grok_example');
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Cursor connected');
    });
  });

  it('does not flash the key field while the connection status loads', () => {
    mocks.status.isPlaceholderData = true;
    render(() => <CursorConnectPage onClose={vi.fn()} />);

    expect(screen.queryByLabelText('API key')).toBeNull();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('manages a connected Cursor: default model, disconnect, done', async () => {
    mocks.status.data = {
      registered: true,
      defaultModelId: null,
      defaultEffort: null,
      updatedAt: '2026-08-27T12:00:00Z',
    };
    const onClose = vi.fn();
    render(() => <CursorConnectPage onClose={onClose} />);

    expect(screen.getByRole('heading', { name: 'Cursor' })).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.queryByLabelText('API key')).toBeNull();

    chooseModelOption(screen.getByLabelText('Default model'), 'Composer');
    await waitFor(() => {
      expect(mocks.setDefaultModel).toHaveBeenCalledWith({
        modelId: 'composer',
      });
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Default model updated');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => {
      expect(mocks.disconnect).toHaveBeenCalledOnce();
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Cursor disconnected');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('offers the effort stops of the default model and saves an effort with it', async () => {
    mocks.status.data = {
      registered: true,
      defaultModelId: 'composer',
      defaultEffort: 'ultra',
      updatedAt: '2026-08-27T12:00:00Z',
    };
    render(() => <CursorConnectPage onClose={vi.fn()} />);

    expect(mocks.capabilityTargets).toContainEqual({
      harness: 'cursor',
      model: 'composer',
    });
    // `ultra` is not one of this model's stops, so its default shows instead.
    const trigger = screen.getByRole('button', { name: 'Effort: Low' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const high = await screen.findByRole('menuitem', { name: 'High' });
    high.focus();
    fireEvent.keyDown(high, { key: 'Enter' });
    await waitFor(() => {
      expect(mocks.setDefaultModel).toHaveBeenCalledWith({
        modelId: 'composer',
        effort: 'high',
      });
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Default effort updated');
    });
  });

  it('shows a saved effort the default model offers', () => {
    mocks.status.data = {
      registered: true,
      defaultModelId: 'composer',
      defaultEffort: 'high',
      updatedAt: '2026-08-27T12:00:00Z',
    };
    render(() => <CursorConnectPage onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Effort: High' })).toBeTruthy();
  });

  it('has no effort control for a model without effort stops', () => {
    mocks.status.data = {
      registered: true,
      defaultModelId: 'default-model',
      defaultEffort: null,
      updatedAt: '2026-08-27T12:00:00Z',
    };
    render(() => <CursorConnectPage onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /^Effort:/ })).toBeNull();
  });
});
