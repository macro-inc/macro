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
    /** Raw `?step` value, including unknown names. */
    step?: string;
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
        step={options.step}
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
const ROUTINES_HEADING = 'Put your busywork on autopilot.';
/** Leaves the routines step with the AI's picks: three in the fixture. */
const turnOnPickedRoutines = async () => {
  await heading(ROUTINES_HEADING);
  click('Turn on 3 routines');
};

describe('onboarding flow', () => {
  it('walks every step and finishes with Free', async () => {
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
    // Suggestions start generating once inbox and tools are connected.
    expect(fake.calls()).toContain('warmRoutineSuggestions');

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
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Continue with Free' }).at(-1)!
    );

    // The AI's likely keepers start on; the user swaps one for another.
    await heading(ROUTINES_HEADING);
    expect(navigate).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: 'Email automations', level: 2 })
    ).toBeTruthy();
    const toggle = (name: string) =>
      screen.getByRole('switch', { name: `Turn on ${name}` });
    expect(toggle('Follow-ups after every call')).toHaveProperty(
      'checked',
      true
    );
    expect(toggle('Alert me about Acme')).toHaveProperty('checked', false);
    fireEvent.click(toggle('Morning inbox digest'));
    fireEvent.click(toggle('Keep the pipeline honest'));
    click('Turn on 3 routines');

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/channel/launch')
    );
    expect(fake.world.routines.toSorted()).toEqual([
      'Follow-ups after every call',
      'Keep the pipeline honest',
      'Tag invoices and receipts',
    ]);
    expect(fake.events()).toContainEqual({
      event: 'onboarding_v4_routines',
      data: { suggested: 6, recommended: 3, enabled: 3, recommended_kept: 2 },
    });
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

  it('opens a step link on that step and records it as the entry', async () => {
    const { fake } = setup({
      step: 'plan',
      world: {
        emailAccounts: [
          {
            address: 'ada@acme.com',
            isPrimary: true,
            ownerId: FAKE_VIEWER_ID,
          },
        ],
      },
    });
    await heading('Free Claude & GPT for 30 days.');
    expect(
      screen.getByRole('button', { name: 'Start 30 day trial' })
    ).toBeTruthy();
    expect(fake.events()).toContainEqual({
      event: 'onboarding_v4_started',
      data: { signup_method: 'google', entry_step: 'plan' },
    });
  });

  it('shows a connected work inbox when the link opens that step', async () => {
    setup({
      step: 'work',
      world: {
        emailAccounts: [
          {
            address: 'ada@acme.com',
            isPrimary: true,
            ownerId: FAKE_VIEWER_ID,
          },
        ],
      },
    });
    await heading(/Connect your work/);
    expect(screen.getByText('Work email connected')).toBeTruthy();
    expect(screen.getByText('ada@acme.com')).toBeTruthy();
  });

  it('ignores an unknown step link and starts at welcome', async () => {
    setup({ step: 'not-a-step' });
    await heading('Create your workspace');
    expect(readSavedStep(FAKE_VIEWER_ID)).toBe('welcome');
  });

  it('prefers saved progress over the step link', async () => {
    setup({ resume: 'team', step: 'plan' });
    await heading('Built for teams.');
  });

  it('lets a checkout return beat saved progress and the step link', async () => {
    const { navigate } = setup({
      resume: 'work',
      step: 'team',
      checkoutReturn: { t: 'success', tier: 'premium' },
      world: { webhookPollsRemaining: 1 },
    });
    await heading('Your workspace is ready.');
    await screen.findByRole(
      'heading',
      { name: ROUTINES_HEADING, level: 1 },
      { timeout: 3_000 }
    );
    expect(navigate).not.toHaveBeenCalled();
    await turnOnPickedRoutines();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/home'));
  });

  it('keeps a deep-linked step after the link is gone and the session is new', async () => {
    setup({ step: 'tools' });
    await heading('Connect your tools.');
    expect(readSavedStep(FAKE_VIEWER_ID)).toBe('tools');
    cleanup();
    sessionStorage.clear();
    setup();
    await heading('Connect your tools.');
    expect(localStorage.getItem('onboarding-flow-step')).toContain(
      '"step":"tools"'
    );
    expect(sessionStorage.getItem('onboarding-flow-step')).toBeNull();
  });

  it('resumes a step that was saved in sessionStorage before the move', async () => {
    sessionStorage.setItem(
      'onboarding-flow-step',
      JSON.stringify({ user: FAKE_VIEWER_ID, step: 'personal' })
    );
    setup();
    await heading(/Add your personal/);
    expect(localStorage.getItem('onboarding-flow-step')).toContain('personal');
    expect(sessionStorage.getItem('onboarding-flow-step')).toBeNull();
  });

  it('resumes the saved step, and Back returns to the previous one', async () => {
    setup({ resume: 'team' });
    await heading('Built for teams.');
    click('Back to previous step');
    await heading('Connect your tools.');
    expect(readSavedStep(FAKE_VIEWER_ID)).toBe('tools');
  });

  it('resumes Google sign-up at work ahead of saved progress and a step link', async () => {
    saveSignupDraft({ step: 'work', accent: '#f77d67', authenticating: true });
    setup({ resume: 'team', step: 'plan' });
    await heading(/Connect your work/);
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
    await heading('Your workspace is ready.');
    await screen.findByRole(
      'heading',
      { name: ROUTINES_HEADING, level: 1 },
      { timeout: 3_000 }
    );
    expect(navigate).not.toHaveBeenCalled();
    await turnOnPickedRoutines();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/home'));
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

  it('preserves team inputs and focus when onboarding suggestions refresh', async () => {
    const { fake } = setup({ resume: 'team' });
    await heading('Built for teams.');
    const name = screen.getByDisplayValue('Acme');
    const email = screen.getByLabelText('Teammate 1 email');
    fireEvent.input(name, { target: { value: 'My workspace' } });
    fireEvent.input(email, { target: { value: 'chosen@example.com' } });
    email.focus();

    fake.update((world) => {
      world.record.suggestedTeamDomain = 'updated.example.com';
      world.contacts.push('new@updated.example.com');
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('My workspace')).toBe(name);
      expect(screen.getByDisplayValue('chosen@example.com')).toBe(email);
      expect(document.activeElement).toBe(email);
    });
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

  it('finishes for a licensed team member without showing trial or Free offers', async () => {
    const { navigate, redirect } = setup({
      resume: 'plan',
      world: {
        teams: [{ name: 'Acme' }],
        viewer: {
          id: FAKE_VIEWER_ID,
          email: 'ada@acme.com',
          tutorialComplete: false,
          licensed: true,
        },
      },
    });
    await heading('Your workspace is ready.');
    expect(
      screen.queryByRole('button', { name: 'Start 30 day trial' })
    ).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Continue with Free' })
    ).toBeNull();
    await turnOnPickedRoutines();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/home')
    );
    expect(redirect).not.toHaveBeenCalled();
  });

  it('takes a licensed member from the team step to routines and finishes while saving', async () => {
    const { fake, navigate } = setup({
      resume: 'team',
      world: {
        teams: [{ name: 'Acme' }],
        viewer: {
          id: FAKE_VIEWER_ID,
          email: 'ada@acme.com',
          tutorialComplete: false,
          licensed: true,
        },
      },
    });
    const completion = Promise.withResolvers<{ t: 'completed' }>();
    const save = vi
      .spyOn(fake.context, 'completeOnboarding')
      .mockReturnValue(completion.promise);
    await heading('Built for teams.');
    click('Continue');
    await turnOnPickedRoutines();

    const opening = await screen.findByRole('button', {
      name: 'Opening your workspace…',
    });
    expect(opening.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('Your workspace is ready.')).toBeNull();
    expect(readSavedStep(FAKE_VIEWER_ID)).toBe('routines');
    expect(save).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();

    completion.resolve({ t: 'completed' });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/home')
    );
  });

  it('retries a failed save without turning routines on twice', async () => {
    const { fake, navigate } = setup({
      resume: 'team',
      world: {
        teams: [{ name: 'Acme' }],
        viewer: {
          id: FAKE_VIEWER_ID,
          email: 'ada@acme.com',
          tutorialComplete: false,
          licensed: true,
        },
        failures: { completion: 'Save failed' },
      },
    });
    await heading('Built for teams.');
    click('Continue');
    await turnOnPickedRoutines();
    await waitFor(() => expect(fake.notifications()).toHaveLength(1));
    expect(
      screen.getByRole('heading', { name: ROUTINES_HEADING })
    ).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Turn on 3 routines' })
        .hasAttribute('disabled')
    ).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    fake.update((world) => {
      delete world.failures.completion;
    });
    click('Turn on 3 routines');
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/home')
    );
    expect(fake.world.routines).toHaveLength(3);
  });

  it('keeps the step when a routine fails and retries only that one', async () => {
    const { fake, navigate } = setup({
      resume: 'routines',
      world: { failures: { createRoutine: 'Server busy' } },
    });
    await turnOnPickedRoutines();
    await screen.findByText(/Some routines couldn't be turned on/);
    expect(navigate).not.toHaveBeenCalled();
    expect(fake.world.routines).toEqual([]);
    fake.update((world) => {
      delete world.failures.createRoutine;
    });
    click('Turn on 3 routines');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/home'));
    expect(fake.world.routines).toHaveLength(3);
  });

  it('skips routines, or continues while they are still being picked', async () => {
    const first = setup({ resume: 'routines' });
    await heading(ROUTINES_HEADING);
    click('Skip for now');
    await waitFor(() => expect(first.navigate).toHaveBeenCalledWith('/home'));
    expect(first.fake.world.routines).toEqual([]);
    expect(first.fake.events()).toContainEqual({
      event: 'onboarding_v4_routines',
      data: { suggested: 6, recommended: 3, enabled: 0, recommended_kept: 0 },
    });
    cleanup();

    const second = setup({
      resume: 'routines',
      world: { routineSuggestions: null },
    });
    await heading(ROUTINES_HEADING);
    expect(screen.getByText(/Studying your workspace/)).toBeTruthy();
    click('Continue to workspace');
    await waitFor(() => expect(second.navigate).toHaveBeenCalledWith('/home'));
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
