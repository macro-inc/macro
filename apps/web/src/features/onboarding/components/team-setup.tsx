import PlusIcon from '@icon/system/regular/plus.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Index, type JSX, Show } from 'solid-js';
import { isPlausibleEmail, PREFILL_CAP } from '../core/team';
import { FormInput } from './controls';

/** Shared presentation for the public preview and authenticated team setup. */
export function TeamSetup(props: {
  title?: string;
  subtitle?: string;
  children: JSX.Element;
}) {
  return (
    <section class="mx-auto flex w-full max-w-lg flex-col items-center py-2 sm:py-4">
      <header class="flex w-full flex-col items-center text-center">
        <h1
          tabindex="-1"
          class="whitespace-nowrap font-[Roboto_Slab_Variable] text-[clamp(1.75rem,8vw,3rem)] font-[315] leading-[1.12] tracking-tight outline-none"
        >
          {props.title ?? 'Built for teams.'}
        </h1>
        <h2 class="mt-6 max-w-[440px] text-sm font-normal leading-6 text-ink-muted text-balance sm:text-[15px]">
          {props.subtitle ??
            'Bring your team into one workspace. Choose Free or upgrade for more AI and storage.'}
        </h2>
      </header>
      <div class="mt-9 w-full">{props.children}</div>
    </section>
  );
}

export function TeamSetupFields(props: {
  id: string;
  name: string;
  emails: string[];
  disabled?: boolean;
  /** One line above the invite list, e.g. the reward for inviting. */
  hint?: string;
  onNameChange: (value: string) => void;
  onEmailChange: (index: number, value: string) => void;
  onRemoveEmail: (index: number) => void;
  onAddEmail: () => void;
  children?: JSX.Element;
}) {
  return (
    <fieldset
      disabled={props.disabled}
      class="flex min-w-0 flex-col gap-6 text-left"
    >
      <label class="flex flex-col gap-2.5 text-sm text-ink-muted">
        Workspace name
        <FormInput
          id={`${props.id}-name`}
          placeholder="Acme Inc."
          value={props.name}
          onInput={props.onNameChange}
        />
      </label>
      <div class="border-t border-edge-muted pt-6">
        <InviteEmailList
          id={props.id}
          emails={props.emails}
          hint={props.hint}
          person="Teammate"
          placeholder="teammate@company.com"
          onEmailChange={props.onEmailChange}
          onRemoveEmail={props.onRemoveEmail}
          onAddEmail={props.onAddEmail}
        />
      </div>
      {props.children}
    </fieldset>
  );
}

/** Invite rows with remove buttons and "Add another", for teammates or friends. */
export function InviteEmailList(props: {
  id: string;
  emails: string[];
  /** One line above the list, e.g. the reward for inviting. */
  hint?: string;
  /** Who each row invites: "Teammate" labels rows "Teammate 1 email". */
  person: string;
  placeholder: string;
  onEmailChange: (index: number, value: string) => void;
  onRemoveEmail: (index: number) => void;
  onAddEmail: () => void;
}) {
  let inviteList!: HTMLDivElement;
  const rowId = () => props.person.toLowerCase();
  return (
    <div class="flex flex-col gap-6">
      <Show when={props.hint}>
        {(hint) => (
          <p class="-mt-2 text-sm leading-6 text-ink-muted">{hint()}</p>
        )}
      </Show>
      <div ref={inviteList} class="flex flex-col gap-3">
        <Index each={props.emails}>
          {(email, index) => (
            <div class="relative [&_.obf-input]:pr-12">
              <FormInput
                id={`${props.id}-${rowId()}-${index}`}
                label={`${props.person} ${index + 1} email`}
                type="email"
                placeholder={props.placeholder}
                value={email()}
                invalid={!!email().trim() && !isPlausibleEmail(email())}
                onInput={(value) => props.onEmailChange(index, value)}
              />
              <Show when={email().trim()}>
                <button
                  type="button"
                  aria-label={`Don't invite ${email().trim()}`}
                  class="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-extra-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
                  onClick={() => props.onRemoveEmail(index)}
                >
                  <XIcon class="size-4" aria-hidden="true" />
                </button>
              </Show>
            </div>
          )}
        </Index>
      </div>
      <button
        type="button"
        class="-mt-3 flex self-center items-center gap-2 rounded-full px-3 py-2 text-sm text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40"
        disabled={props.emails.length >= PREFILL_CAP + 1}
        onClick={() => {
          props.onAddEmail();
          inviteList.lastElementChild
            ?.querySelector('input')
            ?.focus({ preventScroll: true });
          inviteList.lastElementChild?.scrollIntoView({
            block: 'nearest',
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
              .matches
              ? 'instant'
              : 'smooth',
          });
        }}
      >
        <PlusIcon class="size-4" aria-hidden="true" />
        Add another {props.person.toLowerCase()}
      </button>
    </div>
  );
}
