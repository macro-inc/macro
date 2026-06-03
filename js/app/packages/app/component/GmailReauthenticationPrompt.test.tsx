/**
 * @vitest-environment jsdom
 */

import { err as resultErr, ok as resultOk } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkGmailLinkStatus: vi.fn(),
  logout: vi.fn(),
  startSsoLogin: vi.fn(),
  toastCustom: vi.fn(),
  toastDismiss: vi.fn(),
  toastFailure: vi.fn(),
}));

vi.mock('@core/auth/email', () => ({
  GOOGLE_GMAIL_IDP: 'google_gmail',
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
    checkGmailLinkStatus: mocks.checkGmailLinkStatus,
    logout: mocks.logout,
  },
}));

vi.mock('./auth/useSsoLogin', () => ({
  useSsoLogin: () => mocks.startSsoLogin,
}));

import { GmailReauthenticationPrompt } from './GmailReauthenticationPrompt';

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
  const dispose = render(() => <GmailReauthenticationPrompt />, container);

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
  if (!config) throw new Error('Expected Gmail reauthentication toast');

  const action = config.actions.find((item) => item.label === 'Reconnect');
  if (!action) throw new Error('Expected reconnect toast action');

  return action;
}

beforeEach(() => {
  window.history.replaceState(null, '', '/tasks');

  mocks.checkGmailLinkStatus.mockReset();
  mocks.logout.mockReset();
  mocks.startSsoLogin.mockReset();
  mocks.toastCustom.mockReset();
  mocks.toastDismiss.mockReset();
  mocks.toastFailure.mockReset();

  mocks.toastCustom.mockReturnValue(101);
  mocks.logout.mockResolvedValue(resultOk({}));
  mocks.startSsoLogin.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GmailReauthenticationPrompt', () => {
  it('logs out and starts Google SSO when Gmail reauthentication is required', async () => {
    mocks.checkGmailLinkStatus.mockResolvedValue(
      resultErr([
        {
          code: 'REAUTHENTICATION_REQUIRED',
          message: 'ReauthenticationRequired',
        },
      ])
    );

    const cleanup = renderPrompt();
    await flushPromises();
    await getReconnectAction().onClick();

    const options = mocks.toastCustom.mock.calls[0]?.[1] as ToastOptions;

    expect(mocks.checkGmailLinkStatus).toHaveBeenCalledTimes(1);
    expect(mocks.toastCustom).toHaveBeenCalledTimes(1);
    expect(options.persistent).toBe(true);
    expect(options.duration).toBeUndefined();
    expect(options.onDismiss).toEqual(expect.any(Function));
    expect(mocks.toastDismiss).toHaveBeenCalledWith(101);
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(mocks.startSsoLogin).toHaveBeenCalledWith('google_gmail');
    expect(mocks.logout.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.startSsoLogin.mock.invocationCallOrder[0]
    );

    cleanup();
  });

  it('does not start SSO when logout fails', async () => {
    mocks.checkGmailLinkStatus.mockResolvedValue(
      resultOk({ reauthentication_required: true })
    );
    mocks.logout.mockResolvedValue(
      resultErr([{ code: 'SERVER_ERROR', message: 'Logout failed' }])
    );

    const cleanup = renderPrompt();
    await flushPromises();
    await getReconnectAction().onClick();

    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(mocks.startSsoLogin).not.toHaveBeenCalled();
    expect(mocks.toastFailure).toHaveBeenCalledWith(
      'Failed to log out before Gmail reconnect'
    );

    cleanup();
  });

  it('does not show a reconnect toast for valid Gmail links', async () => {
    mocks.checkGmailLinkStatus.mockResolvedValue(
      resultOk({ reauthentication_required: false })
    );

    const cleanup = renderPrompt();
    await flushPromises();

    expect(mocks.checkGmailLinkStatus).toHaveBeenCalledTimes(1);
    expect(mocks.toastCustom).not.toHaveBeenCalled();

    cleanup();
  });

  it('does not show a reconnect toast when no Gmail link exists', async () => {
    mocks.checkGmailLinkStatus.mockResolvedValue(
      resultErr([{ code: 'NOT_FOUND', message: 'No Gmail link found' }])
    );

    const cleanup = renderPrompt();
    await flushPromises();

    expect(mocks.checkGmailLinkStatus).toHaveBeenCalledTimes(1);
    expect(mocks.toastCustom).not.toHaveBeenCalled();

    cleanup();
  });
});
