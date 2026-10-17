import { cleanup, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FakeAuthWorld } from '../tests/fake-auth-context';
import { renderWithFakeAuth } from '../tests/render';
import { MobileWebSignupView } from './mobile-web-signup-view';

afterEach(cleanup);

function setup(world: Partial<FakeAuthWorld> = {}) {
  const login = vi.fn();
  const { fake } = renderWithFakeAuth(
    () => <MobileWebSignupView onLogin={login} onBackHome={() => {}} />,
    world
  );
  return { fake, login };
}

const submit = (email: string) => {
  fireEvent.input(screen.getByLabelText('Email address'), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));
};

describe('mobile-web sign-up', () => {
  it('emails a desktop link and records the lead on the normalized email', async () => {
    window.history.replaceState(
      {},
      '',
      '/?utm_source=ig&utm_medium=paid&utm_campaign=spring&utm_content=story&fbclid=click&gclid=ads'
    );
    const { fake } = setup();
    submit(' Visitor@Acme.com ');
    await screen.findByText('Macro is better on desktop.');
    const calls = fake.calls();
    expect(calls).toEqual(
      expect.arrayContaining([
        'identify:visitor@acme.com',
        'mobileWelcome:visitor@acme.com',
        'lead:visitor@acme.com',
      ])
    );
    expect(calls.indexOf('identify:visitor@acme.com')).toBeLessThan(
      calls.indexOf('mobileWelcome:visitor@acme.com')
    );
    expect(fake.identifiedUsers()[0]).toMatchObject({
      id: 'visitor@acme.com',
      email: 'visitor@acme.com',
      setOnce: {
        mobile_capture_device: expect.any(String),
        utm_source: 'ig',
        utm_medium: 'paid',
        utm_campaign: 'spring',
        utm_content: 'story',
        fbclid: 'click',
      },
    });
    expect(fake.identifiedUsers()[0]?.setOnce?.mobile_capture_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T/
    );
    expect(fake.identifiedUsers()[0]?.setOnce?.gclid).toBeUndefined();
  });

  it('stays on the capture step for an empty or rejected address', async () => {
    const { fake } = setup({ mobileWelcome: 'invalid-email' });
    submit('   ');
    expect(fake.calls()).not.toContain('mobileWelcome:');
    submit('typo@acme.con');
    await waitFor(() =>
      expect(fake.notifications()).toEqual(['Invalid email address.'])
    );
    expect(screen.getByRole('button', { name: 'Sign Up' })).toBeTruthy();
  });

  it('sends existing users to sign in', () => {
    const { fake, login } = setup();
    fireEvent.click(screen.getByRole('link', { name: 'Login' }));
    expect(login).toHaveBeenCalledOnce();
    expect(fake.events()).toContainEqual({
      event: 'login_from_onboarding',
      data: undefined,
    });
  });
});
