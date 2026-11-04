import {
  type OnboardingContext,
  OnboardingProvider,
} from '@app/features/onboarding/context/onboarding-context';
import { useTeamContacts } from '@app/features/onboarding/queries/team-contacts';
import {
  createFakeOnboarding,
  defaultFakeWorld,
} from '@app/features/onboarding/tests/fake-onboarding-context';
import { TeamStep } from '@app/features/onboarding/views/team-step';
import { createSignal } from 'solid-js';
import {
  holdTeamContacts,
  releaseTeamContacts,
  teamContactRequests,
} from './onboarding-contact-network';

export function OnboardingContactsFixture() {
  const params = new URLSearchParams(location.search);
  if (params.has('hold')) holdTeamContacts();
  const fake = createFakeOnboarding({
    ...defaultFakeWorld(),
    contacts: [],
    viewer: {
      id: 'macro|viewer@example.com',
      email: 'VIEWER@team.example.com',
      tutorialComplete: false,
      licensed: false,
    },
    record: {
      status: 'active',
      suggestedTeamDomain: params.has('no-domain')
        ? undefined
        : 'team.example.com',
    },
  });
  const context: OnboardingContext = {
    ...fake.context,
    createTeamDirectory: (input) => {
      const directory = fake.context.createTeamDirectory(input);
      const source = useTeamContacts(input.domain, input.ownEmail);
      return { ...directory, contacts: source.contacts };
    },
  };
  const [completed, setCompleted] = createSignal(false);
  return (
    <main class="h-dvh overflow-y-auto p-6 bg-page text-ink">
      <OnboardingProvider value={context}>
        <TeamStep
          finishing={false}
          onContinue={() => setCompleted(true)}
          onSkip={() => setCompleted(true)}
        />
      </OnboardingProvider>
      <button onClick={releaseTeamContacts}>Release contact page</button>
      <button
        onClick={() =>
          fake.update((world) => {
            world.record.suggestedTeamDomain = 'changed.example.com';
          })
        }
      >
        Refresh domain
      </button>
      <output hidden data-testid="onboarding-contact-requests">
        {JSON.stringify(teamContactRequests())}
      </output>
      <output hidden data-testid="onboarding-contact-count">
        {teamContactRequests().length}
      </output>
      <output hidden data-testid="onboarding-calls">
        {JSON.stringify(fake.calls())}
      </output>
      <output hidden data-testid="onboarding-completed">
        {String(completed())}
      </output>
    </main>
  );
}
