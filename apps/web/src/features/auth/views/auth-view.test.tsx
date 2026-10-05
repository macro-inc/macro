import { cleanup, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthIntent } from '../context/auth-context';
import type { FakeAuthWorld } from '../tests/fake-auth-context';
import { renderWithFakeAuth } from '../tests/render';
import { AuthView, type SignupJourneySlots } from './auth-view';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(
  options: {
    intent?: AuthIntent;
    world?: Partial<FakeAuthWorld>;
    initialEmail?: string;
    autoStart?: boolean;
    token?: string;
    signupJourney?: (slots: SignupJourneySlots) => ReturnType<typeof Journey>;
  } = {}
) {
  const verified = vi.fn();
  const signIn = vi.fn();
  const { fake } = renderWithFakeAuth(
    () => (
      <AuthView
        intent={options.intent ?? 'login'}
        showApple={false}
        compact={false}
        initialEmail={options.initialEmail}
        autoStart={options.autoStart}
        token={options.token}
        onVerified={verified}
        onSignIn={signIn}
        signupJourney={options.signupJourney}
        signedIn={(user) => (
          <p data-testid="signed-in">
            {user.email} {user.tutorialComplete ? 'returning' : 'new'}
          </p>
        )}
      />
    ),
    options.world
  );
  return { fake, verified, signIn };
}

const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole('button', { name }));
// Stepper swaps steps on the next frame, so each step is awaited.
const typeEmail = async (value: string) =>
  fireEvent.input(await screen.findByPlaceholderText('you@company.com'), {
    target: { value },
  });
const typeCode = async (value: string) =>
  fireEvent.input(await screen.findByLabelText(/code/i), {
    target: { value },
  });

describe('email sign-in', () => {
  it('sends a code, verifies it, and hands off to the signed-in view', async () => {
    const { fake, verified } = setup();
    click('Continue with email');
    await typeEmail('returning@acme.com');
    click('Continue');
    await screen.findByText('returning@acme.com');
    await typeCode('424242');
    await screen.findByTestId('signed-in');
    expect(screen.getByTestId('signed-in').textContent).toBe(
      'returning@acme.com returning'
    );
    expect(fake.calls()).toEqual(
      expect.arrayContaining([
        'pageView:login',
        'sendCode:returning@acme.com',
        'verify:returning@acme.com:424242',
        'completeLogin',
        'identify:macro|returning@acme.com',
      ])
    );
    expect(fake.events()).toContainEqual({
      event: 'login',
      data: { method: 'email' },
    });
    expect(verified).toHaveBeenCalledOnce();
  });

  it('keeps the verify step open on a wrong code', async () => {
    setup();
    click('Continue with email');
    await typeEmail('returning@acme.com');
    click('Continue');
    await screen.findByText('returning@acme.com');
    await typeCode('000000');
    await screen.findByText('Invalid code.');
    await typeCode('424242');
    await screen.findByTestId('signed-in');
  });

  it('asks for a password only for password accounts', async () => {
    setup({ world: { passwordAccounts: { 'demo@acme.com': 'hunter2' } } });
    click('Continue with email');
    await typeEmail('demo@acme.com');
    click('Continue');
    const password = await screen.findByPlaceholderText('Password');
    fireEvent.input(password, { target: { value: 'wrong' } });
    click('Continue');
    await screen.findByText(/Check your email and password/);
    fireEvent.input(password, { target: { value: 'hunter2' } });
    click('Continue');
    await screen.findByTestId('signed-in');
  });

  it('lets the user resend after the countdown', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fake } = setup();
    click('Continue with email');
    await typeEmail('returning@acme.com');
    click('Continue');
    await screen.findByText('returning@acme.com');
    expect(
      screen.getByRole('button', { name: /Resend \(45\)/ })
    ).toHaveProperty('disabled', true);
    await vi.advanceTimersByTimeAsync(45_000);
    click('Resend');
    await waitFor(() =>
      expect(
        fake.calls().filter((c) => c === 'sendCode:returning@acme.com')
      ).toHaveLength(2)
    );
  });

  it('goes back from verify to the email step, and from there to the picker', async () => {
    setup();
    click('Continue with email');
    await typeEmail('returning@acme.com');
    click('Continue');
    await screen.findByText('returning@acme.com');
    click('Change email');
    await screen.findByPlaceholderText('you@company.com');
    click('Back to sign in');
    await screen.findByRole('button', { name: 'Continue with Google' });
  });

  it('signs straight in from a dev persona link when the backend returns the code', async () => {
    setup({
      initialEmail: 'returning@acme.com',
      autoStart: true,
      world: { autoCode: true },
    });
    await screen.findByTestId('signed-in');
  });

  it('shows the server’s reason when sending fails', async () => {
    setup({ world: { failures: { sendCode: 'Email is not allowed.' } } });
    click('Continue with email');
    await typeEmail('blocked@acme.com');
    click('Continue');
    await screen.findByText('Email is not allowed.');
  });
});

describe('single sign-on', () => {
  it('starts Google with the page’s intent', async () => {
    const { fake } = setup({ intent: 'login' });
    click('Continue with Google');
    await screen.findByTestId('signed-in');
    expect(fake.calls()).toContain('sso:google:login');
  });

  it('records the email choice as a sign-up click on /signup', () => {
    const { fake } = setup({ intent: 'signup' });
    click('Continue with email');
    expect(fake.events()).toContainEqual({
      event: 'sign_up_click',
      data: { method: 'email' },
    });
  });

  it('redeems the session code an SSO return put on the URL', async () => {
    setup({
      token: 'tok-1',
      world: { sessionTokens: { 'tok-1': 'sso@acme.com' } },
    });
    await screen.findByText('sso@acme.com new');
  });

  it('reports a session code that cannot be redeemed', async () => {
    const { fake } = setup({ token: 'expired' });
    await waitFor(() =>
      expect(fake.notifications()).toEqual([
        'Sign-in failed. Please try again.',
      ])
    );
    expect(
      screen.getByRole('button', { name: 'Continue with Google' })
    ).toBeTruthy();
  });
});

function Journey(props: SignupJourneySlots) {
  return (
    <section>
      <button type="button" onClick={() => void props.onGoogle()}>
        Connect work email
      </button>
      <button type="button" onClick={props.onSignIn}>
        Sign in instead
      </button>
      <p data-testid="showing-email">{String(props.showingEmail)}</p>
      {props.emailForm}
    </section>
  );
}

describe('desktop sign-up', () => {
  it('hands onboarding’s slides a Google sign-up and no email form until chosen', async () => {
    const { fake } = setup({
      intent: 'signup',
      signupJourney: (slots) => <Journey {...slots} />,
    });
    expect(screen.getByTestId('showing-email').textContent).toBe('false');
    expect(screen.queryByPlaceholderText('you@company.com')).toBeNull();
    click('Connect work email');
    await screen.findByText('new@acme.com new');
    expect(fake.calls()).toContain('sso:google:signup');
  });

  it('shows the email form inside the slides for an emailed sign-up link', () => {
    setup({
      intent: 'signup',
      initialEmail: 'invitee@acme.com',
      signupJourney: (slots) => <Journey {...slots} />,
    });
    expect(screen.getByTestId('showing-email').textContent).toBe('true');
    expect(screen.getByDisplayValue('invitee@acme.com')).toBeTruthy();
  });

  it('lets the slides send a returning visitor to sign in', () => {
    const { signIn } = setup({
      intent: 'signup',
      signupJourney: (slots) => <Journey {...slots} />,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in instead' }));
    expect(signIn).toHaveBeenCalledOnce();
  });
});
