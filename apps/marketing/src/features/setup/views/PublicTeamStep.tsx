import { createSignal, Show } from 'solid-js';
import { TeamSetup, TeamSetupFields } from '../components/TeamSetup';
import { ContinueButton, isPlausibleEmail } from '../flow/shared';
import {
  PREFILL_CAP,
  removeInviteSlot,
  validInviteEmails,
} from '../flow/teamInvites';

const DRAFT_KEY = 'macro-public-team-draft';

/** Public setup stages a local draft; authenticated TeamStep owns creation. */
export function PublicTeamStep(props: { onContinue: () => void }) {
  const saved = (() => {
    try {
      const value = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
      if (
        typeof value?.name === 'string' &&
        Array.isArray(value?.emails) &&
        value.emails.every((email: unknown) => typeof email === 'string')
      )
        return {
          name: value.name as string,
          emails: value.invite === false ? [''] : (value.emails as string[]),
        };
    } catch {
      /* Storage can be unavailable. */
    }
    return {
      name: 'Northwind',
      emails: ['alex@example.com', 'jordan@example.com', ''],
    };
  })();
  const [name, setName] = createSignal(saved.name);
  const [emails, setEmails] = createSignal<string[]>(saved.emails);
  const save = () => {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ name: name(), emails: emails() })
      );
    } catch {
      /* Keep the form usable without storage. */
    }
  };
  const invalid = () =>
    emails().some((email) => email.trim() && !isPlausibleEmail(email));
  const tooManyInvites = () =>
    validInviteEmails(emails(), undefined).length > PREFILL_CAP;
  return (
    <TeamSetup>
      <div class="flex flex-col gap-4">
        <TeamSetupFields
          id="public-team"
          name={name()}
          emails={emails()}
          onNameChange={(value) => {
            setName(value);
            save();
          }}
          onEmailChange={(index, value) => {
            setEmails((previous) =>
              previous.map((entry, i) => (i === index ? value : entry))
            );
            save();
          }}
          onRemoveEmail={(index) => {
            setEmails((previous) => removeInviteSlot(previous, index));
            save();
          }}
          onAddEmail={() => {
            setEmails((previous) => [...previous, '']);
            save();
          }}
        >
          <Show when={invalid()}>
            <p role="alert" class="text-sm leading-6 text-failure">
              Enter a valid email address for each teammate, or remove that row.
            </p>
          </Show>
          <Show when={tooManyInvites()}>
            <p role="alert" class="text-sm leading-6 text-failure">
              Choose up to {PREFILL_CAP} teammates to invite during setup.
            </p>
          </Show>
        </TeamSetupFields>
        <ContinueButton
          label="Finish preview"
          disabled={!name().trim() || invalid() || tooManyInvites()}
          onClick={props.onContinue}
        />
      </div>
    </TeamSetup>
  );
}
