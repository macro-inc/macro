import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailStep } from './EmailStep';

const wiring = vi.hoisted(() => ({
  openGoogle: vi.fn(),
  track: vi.fn(),
  invalidate: vi.fn(),
  retry: vi.fn(),
}));
const work = {
  email_address: 'work@company.com',
  macro_id: 'user-1',
  needs_reauth: false,
};
const personal = {
  email_address: 'personal@gmail.com',
  macro_id: 'user-1',
  needs_reauth: false,
};
const [state, setState] = createStore({
  status: 'success',
  fetching: false,
  links: [] as (typeof work)[],
});
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: wiring.track }),
}));
vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'work@company.com',
  useUserId: () => () => 'user-1',
}));
vi.mock('@core/email-link', () => ({
  useAddInboxFlow: () => wiring.openGoogle,
}));
vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => ({
    get isSuccess() {
      return state.status === 'success';
    },
    get isError() {
      return state.status === 'error';
    },
    get isPending() {
      return state.status === 'pending';
    },
    get isFetching() {
      return state.fetching;
    },
    get data() {
      if (state.status !== 'success') throw new Error('Unsettled data read');
      return { links: state.links };
    },
    refetch: wiring.retry,
  }),
  invalidateEmailLinks: wiring.invalidate,
}));
// Keep the real account UI and CTA; the shared module's unrelated Layer needs no provider.
vi.mock('@ui', () => ({ Layer: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  setState({ status: 'success', fetching: false, links: [] });
  wiring.openGoogle.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('required work and optional personal Google accounts', () => {
  it('shows only work and requires an owned healthy work inbox before continuing', () => {
    const next = vi.fn();
    const view = render(() => <EmailStep onContinue={next} />);
    expect(
      view.queryByRole('button', { name: 'Connect personal email' })
    ).toBeNull();
    expect(view.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Skip for now' })).toBeNull();
    setState('links', [personal, { ...work, macro_id: 'another-owner' }]);
    expect(view.queryByRole('button', { name: 'Continue' })).toBeNull();
    setState('links', [work]);
    expect(
      view.queryByRole('button', { name: 'Connect work email' })
    ).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Continue' }));
    expect(next).toHaveBeenCalledOnce();
    expect(wiring.openGoogle).not.toHaveBeenCalled();
  });

  it('does not accept expired work permissions or read pending query data', () => {
    setState('status', 'pending');
    const view = render(() => <EmailStep onContinue={vi.fn()} />);
    expect(
      (
        view.getByRole('button', {
          name: 'Checking connection…',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    setState({ status: 'success', links: [{ ...work, needs_reauth: true }] });
    expect(
      view.getByRole('button', { name: 'Reconnect work email' })
    ).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('persists work authorization intent and waits for a confirmed connection', async () => {
    let resolveGoogle!: () => void;
    wiring.openGoogle.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveGoogle = resolve;
      })
    );
    const view = render(() => <EmailStep onContinue={vi.fn()} />);
    fireEvent.click(view.getByRole('button', { name: 'Connect work email' }));
    expect(
      JSON.parse(sessionStorage.getItem('onboarding-google-attempt') ?? '{}')
    ).toEqual({ user: 'user-1', slot: 'work', count: 0 });
    expect(
      (
        view.getByRole('button', {
          name: 'Opening Google…',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(view.queryByRole('button', { name: 'Continue' })).toBeNull();
    resolveGoogle();
    await waitFor(() =>
      expect(view.queryByRole('button', { name: 'Opening Google…' })).toBeNull()
    );
    expect(
      view.getByRole('button', { name: 'Connect work email' })
    ).toBeTruthy();
    setState('links', [work]);
    expect(view.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it('makes personal a separate skippable step and only links it after work is healthy', async () => {
    const skip = vi.fn();
    const next = vi.fn();
    const view = render(() => (
      <EmailStep mode="personal" onContinue={next} onSkip={skip} />
    ));
    expect(
      view.getByRole('heading', {
        name: 'Add your personal Google email and calendar.',
      })
    ).toBeTruthy();
    expect(
      view.queryByRole('button', { name: 'Connect work email' })
    ).toBeNull();
    expect(
      (
        view.getByRole('button', {
          name: 'Connect personal email',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    setState('links', [work]);
    fireEvent.click(view.getByRole('button', { name: 'Skip for now' }));
    expect(skip).toHaveBeenCalledOnce();
    expect(wiring.openGoogle).not.toHaveBeenCalled();
    fireEvent.click(
      view.getByRole('button', { name: 'Connect personal email' })
    );
    expect(wiring.openGoogle).toHaveBeenCalledOnce();
    expect(
      JSON.parse(sessionStorage.getItem('onboarding-google-attempt') ?? '{}')
    ).toEqual({ user: 'user-1', slot: 'personal', count: 1 });
    await waitFor(() =>
      expect(view.queryByRole('button', { name: 'Opening Google…' })).toBeNull()
    );
    expect(
      view.queryByRole('button', { name: 'Choose integrations' })
    ).toBeNull();
    setState('links', [work, personal]);
    expect(view.queryByRole('button', { name: 'Skip for now' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Choose integrations' }));
    expect(next).toHaveBeenCalledOnce();
  });

  it('resumes failed work consent with a specific corrective message', () => {
    sessionStorage.setItem(
      'onboarding-google-attempt',
      JSON.stringify({ user: 'user-1', slot: 'work', count: 0 })
    );
    const view = render(() => <EmailStep onContinue={vi.fn()} />);
    expect(view.getByRole('alert').textContent).toContain(
      'Choose work@company.com on Google'
    );
    expect(sessionStorage.getItem('onboarding-google-attempt')).toBeNull();
    expect(view.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('recognizes successful consent only after a settled link refresh', () => {
    sessionStorage.setItem(
      'onboarding-google-attempt',
      JSON.stringify({ user: 'user-1', slot: 'work', count: 0 })
    );
    setState({ fetching: true, links: [work] });
    const view = render(() => <EmailStep onContinue={vi.fn()} />);
    expect(sessionStorage.getItem('onboarding-google-attempt')).not.toBeNull();
    expect(wiring.track).not.toHaveBeenCalledWith(
      'onboarding_v4_email_connected',
      expect.anything()
    );
    setState('fetching', false);
    expect(view.queryByRole('alert')).toBeNull();
    expect(sessionStorage.getItem('onboarding-google-attempt')).toBeNull();
    expect(wiring.track).toHaveBeenCalledWith('onboarding_v4_email_connected', {
      connected_count: 1,
    });
  });

  it('keeps another user’s callback out of this account', () => {
    const attempt = JSON.stringify({
      user: 'other-user',
      slot: 'work',
      count: 0,
    });
    sessionStorage.setItem('onboarding-google-attempt', attempt);
    const view = render(() => <EmailStep onContinue={vi.fn()} />);
    expect(view.queryByRole('alert')).toBeNull();
    expect(sessionStorage.getItem('onboarding-google-attempt')).toBe(attempt);
    expect(wiring.track).not.toHaveBeenCalled();
  });

  it('offers retry for failed account loading and recovers from rejected OAuth launch', async () => {
    setState('status', 'error');
    const view = render(() => <EmailStep onContinue={vi.fn()} />);
    expect(
      (
        view.getByRole('button', {
          name: 'Connect work email',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    fireEvent.click(view.getByRole('button', { name: 'Try again' }));
    expect(wiring.retry).toHaveBeenCalledOnce();
    setState('status', 'success');
    wiring.openGoogle.mockRejectedValueOnce(new Error('Network unavailable'));
    fireEvent.click(view.getByRole('button', { name: 'Connect work email' }));
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toContain(
        'Couldn’t open Google'
      )
    );
    expect(
      (
        view.getByRole('button', {
          name: 'Connect work email',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });
});
