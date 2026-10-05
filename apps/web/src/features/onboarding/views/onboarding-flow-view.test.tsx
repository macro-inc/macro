import { cleanup, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutReturn } from '../core/checkout';
import type { OnboardingStep } from '../core/steps';
import {
  readSavedStep,
  saveSignupDraft,
  saveStep,
} from '../primitives/flow-storage';
import {
  FAKE_VIEWER_ID,
  type FakeOnboardingWorld,
} from '../tests/fake-onboarding-context';
import { renderInviteOfferStub } from '../tests/invite-offer-stub';
import {
  renderWithFakeOnboarding,
  stubOnboardingBrowser,
} from '../tests/render';
import { OnboardingFlowView } from './onboarding-flow-view';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  stubOnboardingBrowser();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(
  options: {
    world?: Partial<FakeOnboardingWorld>;
    resume?: OnboardingStep;
    next?: string;
    checkoutReturn?: CheckoutReturn;
  } = {}
) {
  if (options.resume) saveStep(FAKE_VIEWER_ID, options.resume);
  const navigate = vi.fn();
  const redirect = vi.fn();
  const signedOut = vi.fn();
  const { fake } = renderWithFakeOnboarding(
    () => (
      <OnboardingFlowView
        next={options.next}
        checkoutReturn={options.checkoutReturn}
        onNavigate={navigate}
        onRedirect={redirect}
        onSignedOut={signedOut}
        renderInviteOffer={renderInviteOfferStub}
      />
    ),
    options.world
  );
  return { fake, navigate, redirect, signedOut };
}

const heading = (name: string | RegExp) =>
  screen.findByRole('heading', { name, level: 1 });
const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole('button', { name }));

describe('onboarding flow', () => {
  it('walks every step and finishes as a Guest', async () => {
    const { fake, navigate } = setup({ next: '/channel/launch' });

    await heading('Create your workspace');
    fireEvent.click(screen.getByRole('radio', { name: 'Sky' }));
    click('Get started');
    expect(fake.calls()).toContain('applyAccent:#7abde5');

    await heading('Which features do you want to try first?');
    click('Continue');
    await heading('A workspace built to earn your trust.');
    click('Continue');

    await heading(/Connect your work/);
    click('Connect work email');
    await screen.findByText('ada@acme.com');
    click('Continue');

    await heading(/Add your personal/);
    click('Skip for now');

    await heading('Connect your tools.');
    click('Connect Linear');
    await screen.findByRole('button', { name: 'Connected to Linear' });
    click('Continue');

    await heading('Built for teams.');
    expect(screen.getByDisplayValue('Acme')).toBeTruthy();
    expect(screen.getByDisplayValue('grace@acme.com')).toBeTruthy();
    click('Create team & invite 2');
    await waitFor(() =>
      expect(fake.calls()).toContain(
        'createTeam:Acme:grace@acme.com,alan@acme.com'
      )
    );

    await heading('Free Claude & GPT for 30 days.');
    // The scroll cue and the comparison share a label; the comparison's CTA finishes.
    const guest = screen.getAllByRole('button', { name: 'Continue as Guest' });
    fireEvent.click(guest[guest.length - 1]);

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/channel/launch')
    );
    // Completing flips the viewer to complete; the flow must not leave twice.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigate).toHaveBeenCalledOnce();
    expect(fake.world.viewer?.tutorialComplete).toBe(true);
    expect(fake.events()).toContainEqual({
      event: 'onboarding_v4_completed',
      data: {
        plan: 'free',
        plan_skipped: false,
        emails_connected: 1,
        connectors_connected: ['linear'],
      },
    });
    expect(
      fake
        .events()
        .filter((e) => e.event === 'onboarding_v4_step')
        .map((e) => e.data)
    ).toContainEqual({ step: 'personal', index: 4, state: 'skipped' });
  });

  it('skips the personal account when the work account was skipped', async () => {
    setup({ resume: 'work' });
    await heading(/Connect your work/);
    click('Skip for now');
    await heading('Connect your tools.');
  });

  it('resumes the saved step, and Back returns to the previous one', async () => {
    setup({ resume: 'team' });
    await heading('Built for teams.');
    click('Back to previous step');
    await heading('Connect your tools.');
    expect(readSavedStep(FAKE_VIEWER_ID)).toBe('tools');
  });

  it('resumes at the work step after Google sign-up and applies the chosen accent', async () => {
    saveSignupDraft({ step: 'work', accent: '#f77d67', authenticating: true });
    const { fake } = setup();
    await heading(/Connect your work/);
    expect(fake.world.accent).toBe('#f77d67');
  });

  it('returns from checkout to the plan step and finishes once the license lands', async () => {
    const { navigate } = setup({
      resume: 'welcome',
      checkoutReturn: { t: 'success', tier: 'premium' },
      world: { webhookPollsRemaining: 1 },
    });
    await heading('Free Claude & GPT for 30 days.');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/home'), {
      timeout: 3_000,
    });
  });

  it('starts hosted checkout from the trial offer', async () => {
    const { redirect } = setup({ resume: 'plan' });
    await heading('Free Claude & GPT for 30 days.');
    click('Start 30 day trial');
    await waitFor(() =>
      expect(redirect).toHaveBeenCalledWith(
        'https://checkout.stripe.test/premium'
      )
    );
  });

  it('joins a pending team invite instead of creating a team', async () => {
    const { fake } = setup({
      resume: 'team',
      world: { invites: [{ id: 'inv-1', invitedBy: 'Grace' }] },
    });
    await screen.findByText('Grace invited you to their team');
    click('Join');
    await screen.findByText("You're on Grace's team");
    expect(fake.events()).toContainEqual({
      event: 'onboarding_v4_team',
      data: { action: 'joined_invite' },
    });
  });

  it('confirms an existing team membership', async () => {
    const { fake } = setup({
      resume: 'team',
      world: { teams: [{ name: 'Acme' }] },
    });
    await screen.findByText("You're on Acme");
    expect(fake.events()).toContainEqual({
      event: 'onboarding_v4_team',
      data: { action: 'already_on_team' },
    });
  });

  it('sends a signed-out visitor to sign in', async () => {
    const { signedOut } = setup({ world: { viewer: null } });
    await waitFor(() => expect(signedOut).toHaveBeenCalled());
  });

  it('leaves immediately when onboarding is already complete', async () => {
    const { navigate } = setup({
      next: '/md/doc',
      world: {
        viewer: {
          id: FAKE_VIEWER_ID,
          email: 'ada@acme.com',
          tutorialComplete: true,
          licensed: false,
        },
      },
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/md/doc'));
  });

  it('repairs the tutorial flag when the server already completed onboarding', async () => {
    const { fake, navigate } = setup({
      world: {
        record: { status: 'completed', suggestedTeamDomain: undefined },
      },
    });
    await waitFor(() => expect(fake.calls()).toContain('repairTutorial'));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });

  it('offers staff a Bypass out of any step', async () => {
    // Progress is saved per user, so staff start fresh on the first slide.
    const { fake, navigate } = setup({
      world: {
        viewer: {
          id: 'macro|wolf@macro.com',
          email: 'wolf@macro.com',
          tutorialComplete: false,
          licensed: false,
        },
      },
    });
    await heading('Create your workspace');
    click('Bypass');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/home'));
    expect(fake.calls()).toContain('completeOnboarding:skipped');
  });

  it('hides Bypass from everyone else', async () => {
    setup({ resume: 'team' });
    await heading('Built for teams.');
    expect(screen.queryByRole('button', { name: 'Bypass' })).toBeNull();
  });

  it('paints the resumed step on the first render, without a placeholder in between', () => {
    setup({ resume: 'team' });
    // Synchronous: no effect or timer has run yet.
    expect(screen.queryByRole('status', { name: 'Loading setup' })).toBeNull();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Built for teams.' })
    ).toBeTruthy();
  });
});
