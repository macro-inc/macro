import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import { Index, type JSX, Show } from 'solid-js';
import { FormInput, isPlausibleEmail } from '../flow/shared';
import { PREFILL_CAP } from '../flow/teamInvites';

/** Shared presentation for the public preview and authenticated team setup. */
export function TeamSetup(props: { children: JSX.Element }) {
  return (
    <section class="mx-auto flex w-full max-w-lg flex-col items-center py-2 sm:py-4">
      <header class="flex w-full flex-col items-center text-center">
        <h1
          tabindex="-1"
          class="whitespace-nowrap font-[Roboto_Slab_Variable] text-[clamp(1.75rem,8vw,3rem)] font-[315] leading-[1.12] tracking-tight outline-none"
        >
          Built for teams.
        </h1>
        <h2 class="mt-6 max-w-[440px] text-sm font-normal leading-6 text-ink-muted text-balance sm:text-[15px]">
          Invite your team now to make the most of the free plan. Update if you
          need more AI/storage.
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
  suggested?: boolean;
  onNameChange: (value: string) => void;
  onEmailChange: (index: number, value: string) => void;
  onRemoveEmail: (index: number) => void;
  onAddEmail: () => void;
  children?: JSX.Element;
}) {
  let inviteList!: HTMLDivElement;
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
      <div class="flex flex-col gap-6 border-t border-edge-muted pt-6">
        <Show when={props.suggested}>
          <p class="-mt-2 text-sm leading-6 text-ink-muted">
            We found a few people at your company. Review the addresses and
            remove anyone you don’t want to invite.
          </p>
        </Show>
        <div ref={inviteList} class="flex flex-col gap-3">
          <Index each={props.emails}>
            {(email, index) => (
              <div class="relative [&_.obf-input]:pr-12">
                <FormInput
                  id={`${props.id}-teammate-${index}`}
                  label={`Teammate ${index + 1} email`}
                  type="email"
                  placeholder="teammate@company.com"
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
          Add another teammate
        </button>
      </div>
      {props.children}
    </fieldset>
  );
}
