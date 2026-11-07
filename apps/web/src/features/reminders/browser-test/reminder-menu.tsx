import '@app/index.css';
import { EmailReminderMenu } from '@app/features/reminders/views/email-reminder-menu';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

/** The real reminder menu, reading typed times through the built wasm package. */
function Fixture() {
  const [saved, setSaved] = createSignal('');
  return (
    <>
      <EmailReminderMenu
        open={true}
        onOpenChange={() => {}}
        subject="A conversation"
        pending={false}
        onSave={(at, condition) => setSaved(`${at.toISOString()} ${condition}`)}
      />
      <output data-testid="saved">{saved()}</output>
    </>
  );
}

// The app sets this at startup; the phone layout's `touch:` styles read it.
document.documentElement.dataset.touchDevice = String(isTouchDevice());

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
