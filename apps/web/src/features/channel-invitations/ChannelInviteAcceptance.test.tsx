/**
 * @vitest-environment jsdom
 */

import { ThrownResultError } from '@core/util/result';
import { fireEvent } from '@testing-library/dom';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticated: true,
  code: '9b2b1535-ab93-4071-871f-c18ad1f98164' as string | undefined,
  error: null as Error | null,
  isError: false,
  isPending: false,
  navigate: vi.fn(),
  mutate: vi.fn(),
  pathname: '/channel-invite',
  search: '?code=9b2b1535-ab93-4071-871f-c18ad1f98164',
  succeedOnMutate: false,
}));

vi.mock('@queries/auth', () => ({
  useUserInfo: () => () => ({ authenticated: mocks.authenticated }),
}));

vi.mock('@queries/channel/join-links', () => ({
  useJoinChannelByCodeMutation: (callbacks?: { onSuccess?: () => void }) => ({
    get error() {
      return mocks.error;
    },
    get isError() {
      return mocks.isError;
    },
    get isPending() {
      return mocks.isPending;
    },
    mutate(args: { joinCode: string }) {
      mocks.mutate(args);
      if (mocks.succeedOnMutate) callbacks?.onSuccess?.();
    },
  }),
}));

vi.mock('@solidjs/router', () => ({
  useLocation: () => ({
    get pathname() {
      return mocks.pathname;
    },
    get search() {
      return mocks.search;
    },
  }),
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [
    {
      get code() {
        return mocks.code;
      },
    },
  ],
}));

vi.mock('@core/component/LoadingBlock', () => ({
  LoadingBlock: () => <div>Joining channel…</div>,
}));

import { ChannelInviteAcceptance } from './ChannelInviteAcceptance';

let dispose: (() => void) | undefined;

function renderAcceptance(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const disposeRender = render(() => <ChannelInviteAcceptance />, container);
  dispose = () => {
    disposeRender();
    container.remove();
  };
  return container;
}

function buttonWithText(
  container: HTMLElement,
  text: string
): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((element) =>
    element.textContent?.includes(text)
  );
  if (!button) throw new Error(`Expected button containing "${text}"`);
  return button;
}

beforeEach(() => {
  mocks.authenticated = true;
  mocks.code = '9b2b1535-ab93-4071-871f-c18ad1f98164';
  mocks.error = null;
  mocks.isError = false;
  mocks.isPending = false;
  mocks.pathname = '/channel-invite';
  mocks.search = `?code=${mocks.code}`;
  mocks.succeedOnMutate = false;
  mocks.mutate.mockReset();
  mocks.navigate.mockReset();
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
});

describe('ChannelInviteAcceptance', () => {
  it('shows an invalid-link state when the code is missing', () => {
    mocks.code = undefined;
    mocks.search = '';

    const container = renderAcceptance();

    expect(container.textContent).toContain('Invalid Invite Link');
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('preserves the full invitation route when sending signed-out users to login', () => {
    mocks.authenticated = false;
    mocks.search = '?code=code%2Fwith%2Bcharacters';

    const container = renderAcceptance();
    fireEvent.click(buttonWithText(container, 'Sign In to Continue'));

    expect(mocks.navigate).toHaveBeenCalledWith(
      `/login?redirect=${encodeURIComponent(
        '/channel-invite?code=code%2Fwith%2Bcharacters'
      )}`
    );
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('waits for confirmation before joining and returns home after success', () => {
    mocks.succeedOnMutate = true;

    const container = renderAcceptance();

    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.click(buttonWithText(container, 'Join Channel'));

    expect(mocks.mutate).toHaveBeenCalledWith({ joinCode: mocks.code });
    expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('shows the pending state while the join request is running', () => {
    mocks.isPending = true;

    const container = renderAcceptance();

    expect(container.textContent).toContain('Joining channel…');
    expect(container.textContent).not.toContain(
      'Confirm that you want to join'
    );
  });

  it('shows invalid-link feedback for an unknown code', () => {
    mocks.isError = true;
    mocks.error = new ThrownResultError([
      { code: 'NOT_FOUND', message: 'channel not found' },
    ]);

    const container = renderAcceptance();

    expect(container.textContent).toContain('Invalid Invite Link');
  });

  it('shows a retryable message for a server error', () => {
    mocks.isError = true;
    mocks.error = new ThrownResultError([
      { code: 'SERVER_ERROR', message: 'unavailable' },
    ]);

    const container = renderAcceptance();
    expect(container.textContent).toContain('Unable to Join Channel');

    fireEvent.click(buttonWithText(container, 'Try Again'));
    expect(mocks.mutate).toHaveBeenCalledWith({ joinCode: mocks.code });
  });
});
