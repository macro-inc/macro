import type {
  RoutineSuggestion,
  Surface,
} from '@service-scheduled-action/generated/schemas';
import { cleanup, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutReturn } from '../core/checkout';
import type { EmailAccount } from '../core/email-accounts';
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

const localMode = vi.hoisted(() => ({ enabled: false }));
vi.mock(import('@core/constant/featureFlags'), async (importOriginal) => ({
  ...(await importOriginal()),
  get LOCAL_ONLY() {
    return localMode.enabled;
  },
}));
function catalogSuggestion(
  id: string,
  key: string,
  options: {
    onByDefault?: boolean;
    from?: 'for_you' | 'macro';
    reason?: string;
    surface?: Surface;
  } = {}
): RoutineSuggestion {
  const from = options.from ?? 'for_you';
  return {
    id,
    kind: 'catalog',
    key,
    knobs: {},
    from,
    surfaces: [options.surface ?? 'email'],
    reason: from === 'for_you' ? (options.reason ?? null) : null,
    keepProbability: from === 'for_you' ? 0.9 : null,
    onByDefault: options.onByDefault ?? false,
  };
}

function inbox(address: string): EmailAccount {
  return { address, isPrimary: true, ownerId: FAKE_VIEWER_ID };
}

function draftedSuggestion(id: string, name: string): RoutineSuggestion {
  return {
    id,
    kind: 'routine',
    routine: {
      name,
      description: 'Every Friday, list the week’s deliveries.',
      kind: 'Agent',
      trigger: { type: 'events', filters: [{ events: ['task.created'] }] },
      task: { steps: [] },
      enabled: false,
    },
    from: 'for_you',
    surfaces: ['crm'],
    reason: 'Suppliers write every week.',
    keepProbability: 0.95,
    // Even marked, a drafted routine is never switched on for the person.
    onByDefault: true,
  };
}

beforeEach(() => {
  localMode.enabled = false;
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

    await heading('Built for teams.');
    expect(screen.getByDisplayValue('Acme')).toBeTruthy();
    expect(screen.getByDisplayValue('grace@acme.com')).toBeTruthy();
    click('Create team & invite 2');
    await screen.findByText("You're on Acme");
    expect(fake.calls()).toContain(
      'createTeam:Acme:grace@acme.com,alan@acme.com'
    );
    click('Continue');

    await heading('Free Claude & GPT for 30 days.');
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Continue with Free' }).at(-1)!
    );

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

  it('requires a team for a work domain and lets the creator close it to the domain', async () => {
    const { fake } = setup({ resume: 'team' });
    await heading('Built for teams.');
    await screen.findByDisplayValue('Acme');

    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();
    const domainJoin = screen.getByRole('switch', {
      name: /^Allow @acme.com emails to join/,
    });
    expect((domainJoin as HTMLInputElement).checked).toBe(true);

    fireEvent.click(domainJoin);
    click('Create team & invite 2');
    await waitFor(() =>
      expect(fake.calls()).toContain(
        'createTeam:Acme:grace@acme.com,alan@acme.com:closed'
      )
    );
  });

  it('explains each domain switch without toggling it', async () => {
    setup({ resume: 'team' });
    await heading('Built for teams.');
    await screen.findByDisplayValue('Acme');

    const domainJoin = screen.getByRole('switch', {
      name: /^Allow @acme.com emails to join/,
    }) as HTMLInputElement;
    const joinInfo = screen.getByRole('button', { name: 'About domain join' });
    expect(joinInfo.getAttribute('aria-description')).toMatch(
      /joins this team automatically/
    );
    expect(
      screen
        .getByRole('button', { name: 'About the team email' })
        .getAttribute('aria-description')
    ).toMatch(/contacts who aren't on Macro yet/);

    fireEvent.click(joinInfo);
    expect(domainJoin.checked).toBe(true);
    // The info button stays out of the switch's accessible name.
    expect(
      screen.queryByRole('switch', { name: /About domain join/ })
    ).toBeNull();
  });

  it('notifies the domain only while domain join is on', async () => {
    const { fake } = setup({ resume: 'team' });
    await heading('Built for teams.');
    await screen.findByDisplayValue('Acme');

    const domainJoin = screen.getByRole('switch', {
      name: /^Allow @acme.com emails to join/,
    }) as HTMLInputElement;
    const notify = screen.getByRole('switch', {
      name: /^Notify your team via email/,
    }) as HTMLInputElement;
    expect(notify.checked).toBe(true);
    expect(notify.disabled).toBe(false);

    // Without domain join the notice can't go out, so it reads as off.
    fireEvent.click(domainJoin);
    await waitFor(() => expect(notify.disabled).toBe(true));
    expect(notify.checked).toBe(false);

    // Turning domain join back on restores the earlier choice.
    fireEvent.click(domainJoin);
    await waitFor(() => expect(notify.disabled).toBe(false));
    expect(notify.checked).toBe(true);

    fireEvent.click(notify);
    click('Create team & invite 2');
    await waitFor(() =>
      expect(fake.calls()).toContainEqual(
        expect.stringMatching(/^createTeam:Acme:[^:]+:quiet$/)
      )
    );
    expect(fake.events()).toContainEqual(
      expect.objectContaining({
        event: 'onboarding_v4_team',
        data: expect.objectContaining({
          action: 'created',
          allow_domain_join: true,
          notify_domain: false,
        }),
      })
    );
  });

  it('shows the created team with its invite link before continuing', async () => {
    const { fake } = setup({ resume: 'team' });
    await heading('Built for teams.');
    click('Create team & invite 2');
    await screen.findByText("You're on Acme");
    expect(fake.world.teams).toEqual([{ name: 'Acme' }]);

    click('Copy invite link');
    await waitFor(() =>
      expect(fake.events()).toContainEqual({
        event: 'onboarding_v4_team',
        data: { action: 'invite_link_copied' },
      })
    );
    expect(fake.calls()).toContain('copyTeamInviteLink');
    expect(fake.events()).toContainEqual(
      expect.objectContaining({
        event: 'onboarding_v4_team',
        data: expect.objectContaining({ action: 'created', invites_sent: 2 }),
      })
    );

    click('Continue');
    await heading('Free Claude & GPT for 30 days.');
  });

  it('keeps the on-team panel when copying the invite link fails', async () => {
    const { fake } = setup({
      resume: 'team',
      world: {
        teams: [{ name: 'Acme' }],
        failures: { teamInviteLink: 'Not an admin' },
      },
    });
    await screen.findByText("You're on Acme");
    click('Copy invite link');
    await waitFor(() => expect(fake.calls()).toContain('copyTeamInviteLink'));
    expect(fake.events().map((e) => e.data)).not.toContainEqual({
      action: 'invite_link_copied',
    });
    expect(
      screen
        .getByRole('button', { name: 'Copy invite link' })
        .hasAttribute('disabled')
    ).toBe(false);
  });

  it('offers personal addresses referrals instead of a team', async () => {
    const { fake } = setup({
      resume: 'team',
      world: { record: { status: 'active', suggestedTeamDomain: undefined } },
    });
    await heading('Invite friends.');
    expect(
      screen.getByText('Get $10 of AI credit for each person who signs up.')
    ).toBeTruthy();
    expect(screen.queryByText('Workspace name')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    const send = screen.getByRole('button', { name: 'Send invites' });
    expect(send.hasAttribute('disabled')).toBe(true);

    click('Copy referral link');
    await waitFor(() =>
      expect(fake.events()).toContainEqual({
        event: 'onboarding_v4_team',
        data: { action: 'referral_link_copied' },
      })
    );
    expect(fake.calls()).toContain('copyReferralLink');

    fireEvent.input(screen.getByLabelText('Friend 1 email'), {
      target: { value: 'grace@example.com' },
    });
    fireEvent.input(screen.getByLabelText('Friend 2 email'), {
      target: { value: 'alan@example.com' },
    });
    click('Send 2 invites');

    await heading('Free Claude & GPT for 30 days.');
    expect(fake.calls()).toContain(
      'sendReferralInvites:grace@example.com,alan@example.com'
    );
    expect(fake.calls().some((c) => c.startsWith('createTeam'))).toBe(false);
    expect(fake.events()).toContainEqual({
      event: 'onboarding_v4_team',
      data: { action: 'referrals_sent', invites_sent: 2 },
    });
  });

  it('keeps the referral addresses when no invite could be sent', async () => {
    const { fake } = setup({
      resume: 'team',
      world: {
        record: { status: 'active', suggestedTeamDomain: undefined },
        failures: { referralInvites: 'Send failed' },
      },
    });
    await heading('Invite friends.');
    fireEvent.input(screen.getByLabelText('Friend 1 email'), {
      target: { value: 'grace@example.com' },
    });
    click('Send 1 invite');
    await waitFor(() =>
      expect(fake.calls()).toContain('sendReferralInvites:grace@example.com')
    );
    await screen.findByRole('button', { name: 'Send 1 invite' });
    expect(screen.getByDisplayValue('grace@example.com')).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Invite friends.' })
    ).toBeTruthy();
  });

  it('keeps the team form when the onboarding record fails to load', async () => {
    setup({
      resume: 'team',
      world: {
        record: { status: 'active', suggestedTeamDomain: undefined },
        failures: { record: 'Read failed' },
      },
    });
    await heading('Built for teams.');
    expect(screen.queryByText('Invite friends.')).toBeNull();
    expect(screen.getByText('Workspace name')).toBeTruthy();
  });

  it('lets personal addresses skip referrals', async () => {
    const { fake } = setup({
      resume: 'team',
      world: { record: { status: 'active', suggestedTeamDomain: undefined } },
    });
    await heading('Invite friends.');
    click('Skip for now');
    await heading('Free Claude & GPT for 30 days.');
    expect(fake.calls().some((c) => c.startsWith('sendReferralInvites'))).toBe(
      false
    );
    expect(
      fake
        .events()
        .filter((e) => e.event === 'onboarding_v4_step')
        .map((e) => e.data)
    ).toContainEqual(
      expect.objectContaining({ step: 'team', state: 'skipped' })
    );
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
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/home'), {
      timeout: 3_000,
    });
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

  it('passes over the team step for someone who already joined a team', async () => {
    const { fake } = setup({
      resume: 'tools',
      world: { teams: [{ name: 'Acme' }] },
    });
    await heading('Connect your tools.');
    click('Continue');
    await heading('Free Claude & GPT for 30 days.');
    expect(screen.queryByText("You're on Acme")).toBeNull();
    expect(fake.events()).toContainEqual({
      event: 'onboarding_v4_team',
      data: { action: 'already_on_team' },
    });
    click('Back to previous step');
    await heading('Connect your tools.');
  });

  it('finishes from the tools step for a licensed member of a team', async () => {
    const { navigate } = setup({
      resume: 'tools',
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
    await heading('Connect your tools.');
    click('Continue');
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/home')
    );
    expect(screen.queryByText("You're on Acme")).toBeNull();
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
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/home')
    );
    expect(redirect).not.toHaveBeenCalled();
  });

  it('finishes a licensed member directly on the team step while saving', async () => {
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

    const opening = await screen.findByRole('button', {
      name: 'Opening your workspace…',
    });
    expect(opening.hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByRole('heading', { name: 'Built for teams.' })
    ).toBeTruthy();
    expect(screen.queryByText('Your workspace is ready.')).toBeNull();
    expect(readSavedStep(FAKE_VIEWER_ID)).toBe('team');
    expect(save).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();

    completion.resolve({ t: 'completed' });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/home')
    );
  });

  it('lets a licensed member retry a failed save from the team step', async () => {
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
    await waitFor(() => expect(fake.notifications()).toHaveLength(1));
    expect(
      screen.getByRole('heading', { name: 'Built for teams.' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')
    ).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    fake.update((world) => {
      delete world.failures.completion;
    });
    click('Continue');
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/home')
    );
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

  it.each([
    { account: 'staff', email: 'wolf@macro.com', local: false },
    { account: 'local non-staff', email: 'tester@example.com', local: true },
  ])(
    'lets $account accounts complete setup with Bypass',
    async ({ email, local }) => {
      localMode.enabled = local;
      const { fake, navigate } = setup({
        world: {
          viewer: {
            id: `macro|${email}`,
            email,
            tutorialComplete: false,
            licensed: false,
          },
        },
      });
      await heading('Create your workspace');
      click('Bypass');
      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/home'));
      expect(fake.calls()).toContain('completeOnboarding:skipped');
      expect(fake.world.viewer?.tutorialComplete).toBe(true);
    }
  );

  it('hides Bypass from non-staff accounts outside local development', async () => {
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

  it('ends with routines: AI’s picks marked on by default, drafted ones off, and only the chosen turned on', async () => {
    const { fake, navigate } = setup({
      resume: 'routines',
      world: {
        routineSuggestionsEnabled: true,
        routineSuggestions: {
          status: 'ready',
          suggestions: [
            // Marked on by default, but drafted: never switched on.
            draftedSuggestion('digest', 'Supplier digest'),
            catalogSuggestion('sort', 'inbox', {
              onByDefault: true,
              reason: 'You get a lot of newsletters.',
            }),
            catalogSuggestion('triage', 'triage', { onByDefault: true }),
            // A third marked on by default is past the cap of two.
            catalogSuggestion('brief', 'brief', { onByDefault: true }),
            catalogSuggestion('updates', 'updates', { from: 'macro' }),
          ],
        },
      },
    });
    await heading('Put your busywork on autopilot.');
    expect(
      screen.getByText('For you · You get a lot of newsletters.')
    ).toBeTruthy();
    expect(screen.getByText('Template from Macro')).toBeTruthy();
    const toggle = (name: string) =>
      screen.getByRole('switch', { name: `Turn on ${name}` });
    expect(toggle('Sort my inbox')).toHaveProperty('checked', true);
    expect(toggle('Triage new tasks')).toHaveProperty('checked', true);
    expect(toggle('Morning brief')).toHaveProperty('checked', false);
    expect(toggle('Supplier digest')).toHaveProperty('checked', false);
    expect(toggle('Share updates')).toHaveProperty('checked', false);
    fireEvent.click(toggle('Triage new tasks'));
    fireEvent.click(toggle('Supplier digest'));
    click('Turn on 2 routines');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/home'));
    expect(fake.world.routinesCreated).toEqual(['digest', 'sort']);
    expect(fake.calls()).toContain('completeOnboarding');
    expect(fake.events()).toContainEqual({
      event: 'onboarding_v4_routines',
      data: {
        suggested: 5,
        recommended: 2,
        enabled: 2,
        recommended_kept: 1,
        for_you_enabled: 2,
      },
    });
  });

  it('streams AI’s suggestions in, fills only surfaces still empty after the wait, and tops up once AI is done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // The server always fills each surface with Macro's templates.
      const emailTemplate = catalogSuggestion('updates', 'updates', {
        from: 'macro',
        surface: 'email',
      });
      const tasksTemplate = catalogSuggestion('triage', 'triage', {
        from: 'macro',
        surface: 'tasks',
      });
      const sort = catalogSuggestion('sort', 'inbox', {
        reason: 'Busy inbox.',
        surface: 'email',
      });
      const stuck = catalogSuggestion('stuck', 'stuck', {
        reason: 'Tasks pile up.',
        surface: 'tasks',
      });
      const answer =
        (status: 'generating' | 'ready', ...suggestions: RoutineSuggestion[]) =>
        (draft: FakeOnboardingWorld) => {
          draft.routineSuggestions = { status, suggestions };
        };
      const { fake } = setup({
        resume: 'routines',
        world: {
          routineSuggestionsEnabled: true,
          routineSuggestions: {
            status: 'generating',
            suggestions: [emailTemplate, tasksTemplate],
          },
        },
      });
      await heading('Put your busywork on autopilot.');
      // Templates wait while AI is suggesting.
      expect(screen.queryByText('Share updates')).toBeNull();
      expect(screen.queryByText('Triage new tasks')).toBeNull();
      expect(
        screen.getByText(/Studying your workspace to suggest routines/)
      ).toBeTruthy();

      fake.update(answer('generating', sort, emailTemplate, tasksTemplate));
      await screen.findByText('Sort my inbox');
      expect(screen.getByText('Finding more routines for you…')).toBeTruthy();
      expect(screen.queryByText('Share updates')).toBeNull();

      // The wait runs out: only Tasks, still empty, fills with templates.
      await vi.advanceTimersByTimeAsync(30_000);
      await screen.findByText('Triage new tasks');
      expect(screen.queryByText('Share updates')).toBeNull();
      expect(screen.getByText('Finding more routines for you…')).toBeTruthy();
      expect(fake.events()).toContainEqual({
        event: 'onboarding_v4_routines_shown',
        data: expect.objectContaining({
          shown: 2,
          for_you: 1,
          fallback: false,
          waited_out: true,
          status: 'generating',
        }),
      });

      // AI keeps landing; the filled templates stay.
      fake.update(
        answer('generating', sort, emailTemplate, stuck, tasksTemplate)
      );
      await screen.findByText('Chase stuck tasks');
      expect(screen.getByText('Triage new tasks')).toBeTruthy();
      expect(screen.queryByText('Share updates')).toBeNull();

      // AI is done: every surface tops up with its templates.
      fake.update(answer('ready', sort, emailTemplate, stuck, tasksTemplate));
      await screen.findByText('Share updates');
      expect(screen.queryByText('Finding more routines for you…')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('tops up with templates as soon as AI finishes, before the wait is over', async () => {
    const { fake } = setup({
      resume: 'routines',
      world: {
        routineSuggestionsEnabled: true,
        routineSuggestions: {
          status: 'generating',
          suggestions: [
            catalogSuggestion('updates', 'updates', { from: 'macro' }),
          ],
        },
      },
    });
    await heading('Put your busywork on autopilot.');
    expect(screen.queryByText('Share updates')).toBeNull();
    fake.update((draft) => {
      draft.routineSuggestions = {
        status: 'ready',
        suggestions: [
          catalogSuggestion('sort', 'inbox', { reason: 'Busy inbox.' }),
          catalogSuggestion('updates', 'updates', { from: 'macro' }),
        ],
      };
    });
    await screen.findByText('Share updates');
    expect(screen.getByText('Sort my inbox')).toBeTruthy();
    expect(fake.events()).toContainEqual({
      event: 'onboarding_v4_routines_shown',
      data: expect.objectContaining({
        shown: 2,
        for_you: 1,
        waited_out: false,
        status: 'ready',
      }),
    });
  });

  it('falls back to Macro’s templates when AI gave none in time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { fake } = setup({
        resume: 'routines',
        world: {
          routineSuggestionsEnabled: true,
          routineSuggestions: {
            status: 'generating',
            suggestions: [
              catalogSuggestion('updates', 'updates', { from: 'macro' }),
              catalogSuggestion('triage', 'triage', {
                from: 'macro',
                surface: 'tasks',
              }),
            ],
          },
        },
      });
      await heading('Put your busywork on autopilot.');
      expect(screen.queryByText('Share updates')).toBeNull();
      await vi.advanceTimersByTimeAsync(30_000);
      await screen.findByText('Share updates');
      expect(screen.getByText('Triage new tasks')).toBeTruthy();
      expect(fake.events()).toContainEqual({
        event: 'onboarding_v4_routines_shown',
        data: expect.objectContaining({
          for_you: 0,
          fallback: true,
          first_suggestion_ms: null,
        }),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows templates at once without an inbox', async () => {
    setup({
      resume: 'routines',
      world: {
        routineSuggestionsEnabled: true,
        routineSuggestions: {
          status: 'none',
          suggestions: [
            catalogSuggestion('updates', 'updates', { from: 'macro' }),
          ],
        },
      },
    });
    await heading('Put your busywork on autopilot.');
    expect(screen.getByText('Share updates')).toBeTruthy();
    expect(screen.getByText('Template from Macro')).toBeTruthy();
  });

  it('keeps a routine that failed to turn on and retries only it', async () => {
    const { fake, navigate } = setup({
      resume: 'routines',
      world: {
        routineSuggestionsEnabled: true,
        routineCreateFailures: ['triage'],
        routineSuggestions: {
          status: 'ready',
          suggestions: [
            catalogSuggestion('sort', 'inbox', { onByDefault: true }),
            catalogSuggestion('triage', 'triage', { onByDefault: true }),
          ],
        },
      },
    });
    await heading('Put your busywork on autopilot.');
    click('Turn on 2 routines');
    await screen.findByText(
      'Couldn’t turn this on. Try again, or leave it off.'
    );
    expect(navigate).not.toHaveBeenCalled();
    fake.update((draft) => {
      draft.routineCreateFailures = [];
    });
    await screen.findByRole('button', { name: 'Turn on 2 routines' });
    click('Turn on 2 routines');
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(
      fake.calls().filter((call) => call.startsWith('createRoutine:'))
    ).toEqual([
      'createRoutine:sort:Sort my inbox',
      'createRoutine:triage:Triage new tasks',
      'createRoutine:triage:Triage new tasks',
    ]);
  });

  it('creates a routine under the name the person gave it', async () => {
    const { fake, navigate } = setup({
      resume: 'routines',
      world: {
        routineSuggestionsEnabled: true,
        routineSuggestions: {
          status: 'ready',
          suggestions: [
            catalogSuggestion('sort', 'inbox', { onByDefault: true }),
          ],
        },
      },
    });
    await heading('Put your busywork on autopilot.');
    fireEvent.click(screen.getByRole('button', { name: /Sort my inbox/ }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.input(name, { target: { value: 'Label my mail' } });
    click('Turn on 1 routine');
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(fake.calls()).toContain('createRoutine:sort:Label my mail');
  });

  it('ends with the routines step once a plan is chosen, where suggestions are on', async () => {
    const { fake, navigate } = setup({
      resume: 'plan',
      world: { routineSuggestionsEnabled: true },
    });
    await heading('Free Claude & GPT for 30 days.');
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Continue with Free' }).at(-1)!
    );
    await heading('Put your busywork on autopilot.');
    expect(fake.calls()).not.toContain('completeOnboarding');
    // The plan is settled: no going back to it.
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    click('Continue to workspace');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/home'));
    expect(fake.events()).toContainEqual(
      expect.objectContaining({
        event: 'onboarding_v4_completed',
        data: expect.objectContaining({ plan: 'free' }),
      })
    );
  });

  it('starts AI suggesting routines once, as soon as an inbox is connected', async () => {
    const { fake } = setup({
      resume: 'tools',
      world: { routineSuggestionsEnabled: true },
    });
    await heading('Connect your tools.');
    expect(fake.calls()).not.toContain('generateRoutineSuggestions');
    fake.update((draft) => {
      draft.emailAccounts = [inbox('work@example.com')];
    });
    await waitFor(() =>
      expect(fake.calls()).toContain('generateRoutineSuggestions')
    );
    fake.update((draft) => {
      draft.emailAccounts = [
        inbox('work@example.com'),
        inbox('home@example.com'),
      ];
    });
    await Promise.resolve();
    expect(
      fake.calls().filter((call) => call === 'generateRoutineSuggestions')
    ).toHaveLength(1);
  });

  it('never starts suggesting where suggestions are off', async () => {
    const { fake } = setup({
      resume: 'tools',
      world: {
        emailAccounts: [inbox('work@example.com')],
      },
    });
    await heading('Connect your tools.');
    expect(fake.calls()).not.toContain('generateRoutineSuggestions');
  });
});

describe('after a Microsoft sign-up', () => {
  const connects = (calls: readonly string[]) =>
    calls.filter((call) => call.startsWith('connectInbox'));

  it('continues once into Outlook consent when the user may connect Outlook', async () => {
    saveSignupDraft({
      step: 'work',
      authenticating: true,
      provider: 'microsoft',
    });
    const { fake } = setup({ world: { outlookAvailable: true } });
    await heading(/Continue with your work/);
    await waitFor(() =>
      expect(connects(fake.calls())).toEqual(['connectInbox:microsoft'])
    );
    expect(screen.getByText('Continuing with Microsoft')).toBeTruthy();
  });

  it('stays on the work step with Skip when Outlook is not available', async () => {
    saveSignupDraft({
      step: 'work',
      authenticating: true,
      provider: 'microsoft',
    });
    const { fake } = setup({ world: { outlookAvailable: false } });
    await heading(/Connect your work/);
    expect(connects(fake.calls())).toEqual([]);
    expect(
      screen.queryByRole('button', { name: 'Continue with Microsoft' })
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeTruthy();
    expect(screen.queryByText('Continuing with Microsoft')).toBeNull();
  });

  it('leaves a Google sign-up to choose, with both providers offered', async () => {
    saveSignupDraft({ step: 'work', authenticating: true, provider: 'google' });
    const { fake } = setup({ world: { outlookAvailable: true } });
    await heading(/Continue with your work/);
    expect(connects(fake.calls())).toEqual([]);
    click('Continue with Microsoft');
    expect(connects(fake.calls())).toEqual(['connectInbox:microsoft']);
  });
});
