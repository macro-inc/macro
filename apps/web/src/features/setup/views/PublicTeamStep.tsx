import { createSignal, Index, Show } from 'solid-js';
import {
  ContinueButton,
  FormInput,
  isPlausibleEmail,
  SkipButton,
} from '../flow/shared';

const DRAFT_KEY = 'macro-public-team-draft';

/** Public setup stages a local draft; authenticated TeamStep owns creation. */
export function PublicTeamStep(props: { onContinue: () => void }) {
  const saved = (() => {
    try {
      const value = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
      if (
        typeof value?.name === 'string' &&
        typeof value?.invite === 'boolean' &&
        Array.isArray(value?.emails) &&
        value.emails.every((email: unknown) => typeof email === 'string')
      )
        return value as { name: string; invite: boolean; emails: string[] };
    } catch {
      /* Storage can be unavailable. */
    }
    return { name: '', invite: true, emails: ['', ''] };
  })();
  const [name, setName] = createSignal(saved.name);
  const [invite, setInvite] = createSignal(saved.invite);
  const [emails, setEmails] = createSignal<string[]>(saved.emails);
  const save = () => {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ name: name(), invite: invite(), emails: emails() })
      );
    } catch {
      /* Keep the form usable without storage. */
    }
  };
  const invalid = () =>
    invite() &&
    emails().some((email) => email.trim() && !isPlausibleEmail(email));
  return (
    <div class="mx-auto flex max-w-md flex-col gap-6">
      <header class="mb-3 text-center">
        <h1 class="font-[Roboto_Slab_Variable] text-4xl font-[315] tracking-tight">
          Better, together.
        </h1>
        <p class="mt-4 text-sm leading-6 text-ink-muted">
          Create a shared space for your team.
        </p>
      </header>
      <label class="flex flex-col gap-2 text-xs text-ink-muted">
        Team name
        <FormInput
          id="public-team-name"
          placeholder="Acme Inc."
          value={name()}
          onInput={(value) => {
            setName(value);
            save();
          }}
        />
      </label>
      <label class="flex items-center gap-3 rounded-2xl border border-edge p-4 text-sm">
        <input
          type="checkbox"
          class="size-4 accent-current"
          checked={invite()}
          onChange={(event) => {
            setInvite(event.currentTarget.checked);
            save();
          }}
        />
        Invite my team
      </label>
      <Show when={invite()}>
        <div class="flex flex-col gap-3">
          <Index each={emails()}>
            {(email, index) => (
              <FormInput
                id={`public-teammate-${index}`}
                label={`Teammate ${index + 1} email`}
                type="email"
                placeholder="teammate@company.com"
                value={email()}
                invalid={!!email().trim() && !isPlausibleEmail(email())}
                onInput={(value) => {
                  setEmails((previous) =>
                    previous.map((entry, i) => (i === index ? value : entry))
                  );
                  save();
                }}
              />
            )}
          </Index>
          <Show when={emails().length < 4}>
            <button
              type="button"
              class="self-start text-sm text-ink-muted"
              onClick={() => {
                setEmails((previous) => [...previous, '']);
                save();
              }}
            >
              + Add teammate
            </button>
          </Show>
        </div>
      </Show>
      <p class="text-xs leading-5 text-ink-extra-muted">
        Save your team details here. No invitations are sent from this preview.
      </p>
      <SkipButton onClick={props.onContinue} />
      <ContinueButton
        label="Continue"
        disabled={!name().trim() || invalid()}
        onClick={props.onContinue}
      />
    </div>
  );
}
