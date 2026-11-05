import '@app/index.css';
import { For } from 'solid-js';
import { render } from 'solid-js/web';
import { CalendarInviteCard } from '../components/calendar-invite-card';
import { invitationFixtures } from '../core/calendar-invitation-fixtures';

const GOOGLE_SEPARATOR =
  '-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~::~:~::-';

const DESCRIPTIONS = {
  google: `${GOOGLE_SEPARATOR}\nJoin with Google Meet: https://meet.google.com/abc-defg-hij\nLearn more about Meet at: https://support.google.com/a/users/answer/9282720?hl=en&visit_id=638000000000000000-1234567890&rd=1\n\nPlease do not edit this section.\n${GOOGLE_SEPARATOR}`,
  forwarded:
    '<div dir="ltr"><br><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: <strong class="gmail_sendername">Sample Sender</strong> <span>&lt;sender@example.com&gt;</span><br>Date: Wed, Nov 4, 2026 at 9:12 AM<br>Subject: Planning notes for the quarterly review and the follow-up session with the wider group<br></div><br><div>Hi all,&nbsp;here&nbsp;is&nbsp;the&nbsp;agenda&nbsp;for&nbsp;the&nbsp;session&nbsp;we&nbsp;talked&nbsp;about&nbsp;on&nbsp;the&nbsp;call&nbsp;last&nbsp;week&nbsp;and&nbsp;the&nbsp;documents&nbsp;to&nbsp;read&nbsp;before.</div><div>https://docs.example.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIjKlMnOp/edit?usp=sharing&amp;ouid=000000000000000000000</div></div></div>',
  unbroken:
    'ThisDescriptionIsOneVeryLongUnbrokenTokenThatMustWrapInsideTheInvitationCardInsteadOfPushingTheCardWiderThanItsPane',
} as const;

const fixtures = Object.entries(DESCRIPTIONS).map(([key, description]) => ({
  key,
  invitation: { ...invitationFixtures.updated, description },
}));

function Fixture() {
  return (
    <main class="h-screen overflow-y-auto bg-page p-4 text-ink">
      <For each={fixtures}>
        {(fixture) => (
          <div
            data-testid={`pane-${fixture.key}`}
            class="w-full overflow-hidden"
            style={{ 'max-width': '480px' }}
          >
            <CalendarInviteCard
              invitation={fixture.invitation}
              timeZone="America/Los_Angeles"
            />
          </div>
        )}
      </For>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(() => <Fixture />, root);
