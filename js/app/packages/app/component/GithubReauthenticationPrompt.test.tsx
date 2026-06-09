/**
 * @vitest-environment jsdom
 */

import { err as resultErr, ok as resultOk } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkGithubLinkStatus: vi.fn(),
  reauthenticateGithub: vi.fn(),
  toastCustom: vi.fn(),
  toastDismiss: vi.fn(),
  toastFailure: vi.fn(),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    custom: mocks.toastCustom,
    dismiss: mocks.toastDismiss,
    failure: mocks.toastFailure,
  },
}));

vi.mock('@service-auth/client', () => ({
  authServiceClient: {
    checkGithubLinkStatus: mocks.checkGithubLinkStatus,
    reauthenticateGithub: mocks.reauthenticateGithub,
  },
}));

import { GithubReauthenticationPrompt } from './GithubReauthenticationPrompt';

type ToastAction = {
  label: string;
  onClick: () => Promise<void> | void;
};

type ToastConfig = {
  actions: ToastAction[];
  content?: () => unknown;
  title: string;
};

type ToastOptions = {
  duration?: number;
  onDismiss?: () => void;
  persistent?: boolean;
};

function renderPrompt(): () => void {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(() => <GithubReauthenticationPrompt />, container);

  return () => {
    dispose();
    container.remove();
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function getReconnectAction(): ToastAction {
  const config = mocks.toastCustom.mock.calls[0]?.[0] as
    | ToastConfig
    | undefined;
  if (!config) throw new Error('Expected GitHub reauthentication toast');

  const action = config.actions.find((item) => item.label === 'Reconnect');
  if (!action) throw new Error('Expected reconnect toast action');

  return action;
}

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, '', '/tasks');

  mocks.checkGithubLinkStatus.mockReset();
  mocks.reauthenticateGithub.mockReset();
  mocks.toastCustom.mockReset();
  mocks.toastDismiss.mockReset();
  mocks.toastFailure.mockReset();

  mocks.toastCustom.mockReturnValue(101);
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('GithubReauthenticationPrompt', () => {
  it('shows a reconnect toast globally when GitHub reauthentication is required', async () => {
    mocks.checkGithubLinkStatus.mockResolvedValue(
      resultErr([
        {
          code: 'REAUTHENTICATION_REQUIRED',
          message: 'ReauthenticationRequired',
        },
      ])
    );
    const originalUrl = window.location.href;
    const authorizationUrl = `${originalUrl}#github-reauth`;
    mocks.reauthenticateGithub.mockResolvedValue(resultOk(authorizationUrl));

    const cleanup = renderPrompt();
    await flushPromises();
    await getReconnectAction().onClick();

    const options = mocks.toastCustom.mock.calls[0]?.[1] as ToastOptions;

    expect(mocks.checkGithubLinkStatus).toHaveBeenCalledTimes(1);
    expect(mocks.toastCustom).toHaveBeenCalledTimes(1);
    expect(options.persistent).toBe(true);
    expect(options.duration).toBeUndefined();
    expect(options.onDismiss).toEqual(expect.any(Function));
    expect(mocks.toastDismiss).toHaveBeenCalledWith(101);
    expect(mocks.reauthenticateGithub).toHaveBeenCalledWith(originalUrl);
    expect(window.location.href).toBe(authorizationUrl);

    cleanup();
  });

  it('does not show a reconnect toast for valid GitHub links', async () => {
    mocks.checkGithubLinkStatus.mockResolvedValue(
      resultOk({ reauthentication_required: false })
    );

    const cleanup = renderPrompt();
    await flushPromises();

    expect(mocks.checkGithubLinkStatus).toHaveBeenCalledTimes(1);
    expect(mocks.toastCustom).not.toHaveBeenCalled();

    cleanup();
  });

  it('does not show a reconnect toast when no GitHub link exists', async () => {
    mocks.checkGithubLinkStatus.mockResolvedValue(
      resultErr([{ code: 'NOT_FOUND', message: 'No GitHub link found' }])
    );

    const cleanup = renderPrompt();
    await flushPromises();

    expect(mocks.checkGithubLinkStatus).toHaveBeenCalledTimes(1);
    expect(mocks.toastCustom).not.toHaveBeenCalled();

    cleanup();
  });
});
