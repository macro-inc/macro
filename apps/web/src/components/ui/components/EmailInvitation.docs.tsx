import { CalendarInviteCard } from '@app/features/email-message/components/calendar-invite-card';
import type { InvitationResolution } from '@app/features/email-message/core/calendar-invitation';
import {
  invitationFixture,
  invitationFixtures,
} from '@app/features/email-message/core/calendar-invitation-fixtures';
import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal, For } from 'solid-js';
import { Button } from './Button';

// #region demo:interactive
function InteractiveInvitation() {
  const [response, setResponse] = createSignal<
    'accepted' | 'tentative' | 'declined'
  >('accepted');
  const [pending, setPending] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const resolution = (): InvitationResolution => ({
    kind: 'resolved',
    eventId: 'fixture-event',
    occurrenceKey: '2026-09-24T17:00:00Z',
    recurring: false,
    response: response(),
    respondingEmail: 'you@example.com',
    canRespond: true,
    canJoin: true,
    isCancelled: false,
    isNewer: false,
    isStale: false,
    current: invitationFixture,
  });
  return (
    <div class="w-full max-w-2xl">
      <p class="text-xs text-ink-muted">
        Local presentation fixture. These controls do not send a calendar
        response.
      </p>
      <div class="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => setPending((v) => !v)}>
          Toggle pending
        </Button>
        <Button variant="ghost" onClick={() => setFailed((v) => !v)}>
          Toggle failure
        </Button>
      </div>
      <CalendarInviteCard
        invitation={invitationFixture}
        timeZone="America/Los_Angeles"
        actions={{
          get resolution() {
            return resolution();
          },
          get pending() {
            return pending();
          },
          get error() {
            return failed()
              ? 'Could not save your response. Please try again.'
              : undefined;
          },
          respond: setResponse,
        }}
      />
    </div>
  );
}
// #endregion

// #region demo:states
function InvitationStates() {
  return (
    <div class="w-full max-w-2xl">
      <For each={Object.values(invitationFixtures)}>
        {(invitation) => (
          <CalendarInviteCard
            invitation={invitation}
            timeZone="America/Los_Angeles"
          />
        )}
      </For>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'EmailInvitation',
  category: 'Data Display',
  status: 'beta',
  description:
    'Native email invitation cards with saved event details, notifications, and accessible RSVP states.',
  guidelines: {
    do: [
      'Render saved invitation details immediately and supply current calendar state through the host actions.',
      'Keep the original email accessible and show which connected address will respond.',
    ],
    dont: [
      'Enable RSVP or Join until an authorized calendar resolution permits the action.',
      'Parse ICS or fetch provider data from the card.',
    ],
  },
  demos: [
    {
      id: 'interactive',
      title: 'Selected, pending, and failed responses',
      render: InteractiveInvitation,
      fill: true,
    },
    {
      id: 'states',
      title: 'Scheduling states and typed dates',
      render: InvitationStates,
      fill: true,
    },
  ],
});
