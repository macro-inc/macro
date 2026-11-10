import ArrowUpIcon from '@icon/system/regular/arrow-up.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { For, type JSX, Match, Show, Switch } from 'solid-js';

function EvidenceLink(props: { href: string; children: JSX.Element }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      class="rounded-sm text-ink-muted underline decoration-ink-extra-muted underline-offset-4 hover:text-ink focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-ink"
    >
      {props.children}
    </a>
  );
}

type TrustQuestion = { title: string; answer: JSX.Element };

const GOOGLE_QUESTIONS: TrustQuestion[] = [
  {
    title: 'Why does Google ask for these permissions?',
    answer: (
      <>
        Gmail access lets Macro read, send, organize, and move messages to
        trash. Contacts help suggest recipients; mail settings support your
        signature and filters. When you connect Calendar, its permissions let
        Macro show your calendars and create or update events. Google shows the
        exact permissions before you approve.
      </>
    ),
  },
  {
    title: 'Does Macro get my Google password?',
    answer: (
      <>
        No. You sign in and approve access on Google. Google gives Macro
        authorization for the permissions you approve; your Google password
        stays with Google.
      </>
    ),
  },
  {
    title: 'Is my email used to train AI?',
    answer: (
      <>
        Data received through Google Workspace APIs is not used to develop or
        train generalized AI models. Macro also maintains zero data retention
        agreements with OpenAI and Anthropic for model processing.
      </>
    ),
  },
  {
    title: 'How do I revoke access?',
    answer: (
      <>
        You can disconnect in Macro’s Settings or revoke access from your Google
        account. Revoking access and deleting data already stored in Macro are
        separate actions. You can request account and data deletion as described
        in our{' '}
        <EvidenceLink href="https://macro.com/privacy/">
          Privacy Policy
        </EvidenceLink>
        .
      </>
    ),
  },
];

/** Microsoft sign-in is identity-only; Outlook access is its own consent. */
const MICROSOFT_QUESTIONS: TrustQuestion[] = [
  {
    title: 'What does Microsoft sign-in share with Macro?',
    answer: (
      <>
        Only your identity: your name, email address, and Microsoft account ID.
        Microsoft may describe this as signing you in, viewing your basic
        profile, and keeping that access. Sign-in alone doesn’t give Macro your
        mail or calendar.
      </>
    ),
  },
  {
    title: 'Why does Outlook ask for more permissions?',
    answer: (
      <>
        After you sign in, Macro asks Microsoft separately for Outlook access.
        Mail access lets Macro read, send, and organize messages; contacts help
        suggest recipients; mailbox settings support your inbox rules and time
        zone; calendar access lets Macro show your calendars and create or
        update events. Microsoft shows the exact permissions before you approve,
        and you can skip this step and connect later in Settings.
      </>
    ),
  },
  {
    title: 'What if my organization needs an admin to approve Macro?',
    answer: (
      <>
        Some work and school accounts let only an administrator approve apps. If
        that stops Microsoft sign-in, continue with your email instead. If it
        stops the Outlook connection, skip it for now; your Macro account still
        works, and you can connect once an admin approves.
      </>
    ),
  },
];

const SECURITY_QUESTIONS: TrustQuestion[] = [
  {
    title: 'What does zero data retention mean?',
    answer: (
      <>
        When you use an agent, information needed for your request is processed
        by its model provider. Our agreements with OpenAI and Anthropic provide
        zero data retention and no training on that data. This concerns model
        processing: Macro still stores the workspace content needed to provide
        the service.
      </>
    ),
  },
  {
    title: 'Who can access production data?',
    answer: (
      <>
        Production access is restricted to authorized engineering staff, and
        development runs in a separate environment. Personnel who process
        customer data are bound by confidentiality obligations.
      </>
    ),
  },
  {
    title: 'Can my team review the security evidence?',
    answer: (
      <>
        Yes. Our security program includes SOC 2, ISO 27001, and Google CASA
        Tier 2, with external audits and penetration testing. Visit our{' '}
        <EvidenceLink href="https://security.macro.com">
          Trust Center
        </EvidenceLink>{' '}
        for security information. Our{' '}
        <EvidenceLink href="https://macro.com/dpa">
          Data Processing Agreement
        </EvidenceLink>{' '}
        describes confidentiality, safeguards, subprocessors, and data return or
        deletion.
      </>
    ),
  },
  {
    title: 'Is Macro open source?',
    answer: (
      <>
        Macro is open source: you can inspect our{' '}
        <EvidenceLink href="https://github.com/macro-inc/macro">
          code on GitHub
        </EvidenceLink>
        .
      </>
    ),
  },
];

/** Optional reading, grounded in Macro's privacy policy, DPA, and security material. */
export function OnboardingTrustDetails(props: {
  topic: 'security' | 'google';
  /**
   * The step also offers Microsoft: adds what Microsoft sign-in asks for and
   * the Outlook consent that follows it.
   */
  microsoft?: boolean;
  /** Fine print shown under the policy links, such as sign-up terms. */
  legal?: JSX.Element;
}) {
  const google = () => props.topic === 'google';
  const microsoft = () => google() && props.microsoft === true;
  const questions = () => {
    if (!google()) return SECURITY_QUESTIONS;
    return microsoft()
      ? [...GOOGLE_QUESTIONS, ...MICROSOFT_QUESTIONS]
      : GOOGLE_QUESTIONS;
  };

  return (
    <section class="mx-auto w-full max-w-[608px] px-6 pb-20 pt-20 font-[Inter_Variable] text-sm leading-7 text-ink-muted sm:pb-28 sm:pt-24 sm:text-[15px]">
      <div class="mb-10 h-px w-12 bg-edge" aria-hidden="true" />
      <p class="mb-4 text-xs text-ink-extra-muted">
        <Switch fallback="Security & privacy">
          <Match when={microsoft()}>
            Google or Microsoft account connection
          </Match>
          <Match when={google()}>Google account connection</Match>
        </Switch>
      </p>
      <h2
        tabindex="-1"
        class="mb-7 text-2xl font-medium leading-8 tracking-tight text-ink outline-none sm:text-[28px] sm:leading-9"
      >
        {google() ? 'Email and calendar permissions' : 'Data protection'}
      </h2>
      <div class="space-y-5">
        <Show
          when={google()}
          fallback={
            <>
              <p>
                Macro stores your workspace content to provide the service. We
                do not sell your data.
              </p>
              <p>
                Your data is encrypted in transit and at rest. Production access
                is restricted to authorized engineering staff. Development runs
                in a separate environment.
              </p>
              <p>
                Macro is open source. Our security program includes independent
                audits and penetration testing. The FAQs below link to our code,
                security information, and data policies.
              </p>
            </>
          }
        >
          <p>
            Macro requests Google account access to read, send, and organize
            email and manage connected calendars. Google lists the permissions
            before you approve the connection.
          </p>
          <p>
            Macro’s email agents show you the draft and ask for your approval
            before sending.
          </p>
          <p>
            You sign in through Google. Macro does not receive your Google
            password. Your Macro sign-in stays the same; adding a personal
            account is optional. You can disconnect in Macro’s Settings or
            revoke access from your Google account.
          </p>
        </Show>
      </div>
      <Show when={microsoft()}>
        <h3 class="mb-3 mt-12 text-base font-medium text-ink">
          Continuing with Microsoft
        </h3>
        <div class="space-y-5">
          <p>
            Signing in with Microsoft asks only for your identity: your name,
            email address, and Microsoft account ID. It doesn’t give Macro your
            mail or calendar.
          </p>
          <p>
            Outlook mail and calendar access is a separate Microsoft consent
            that follows sign-in. Microsoft lists those permissions before you
            approve, and you can skip it and connect later.
          </p>
          <p>
            Macro does not receive your Microsoft password. You can disconnect
            Outlook in Macro’s Settings or remove Macro’s access from your
            Microsoft account.
          </p>
        </div>
      </Show>
      <h3 class="mb-3 mt-12 text-base font-medium text-ink">
        Frequently asked questions
      </h3>
      <div class="border-t border-edge-muted">
        <For each={questions()}>
          {(question) => (
            <details class="group border-b border-edge-muted">
              <summary class="flex list-none items-start justify-between gap-5 rounded-sm py-5 text-sm font-medium leading-6 text-ink-muted hover:text-ink focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-ink [&::-webkit-details-marker]:hidden">
                {question.title}
                <CaretDownIcon
                  class="mt-1 size-4 shrink-0 text-ink-extra-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </summary>
              <p class="pb-6 pr-6 font-normal">{question.answer}</p>
            </details>
          )}
        </For>
      </div>
      <p class="mt-8 text-xs leading-6 text-ink-extra-muted">
        More detail in our{' '}
        <EvidenceLink href="https://macro.com/privacy/">
          Privacy Policy
        </EvidenceLink>{' '}
        and{' '}
        <EvidenceLink href="https://security.macro.com">
          Trust Center
        </EvidenceLink>
        .
      </p>
      <Show when={props.legal}>
        <p class="mt-3 text-xs leading-6 text-ink-extra-muted">{props.legal}</p>
      </Show>
      <button
        type="button"
        class="mt-10 inline-flex items-center gap-2 rounded-sm py-2 text-sm text-ink-muted hover:text-ink focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-ink"
        onClick={(event) => {
          const scroller = event.currentTarget.closest(
            '[data-onboarding-scroll]'
          );
          scroller
            ?.querySelector<HTMLElement>('h1')
            ?.focus({ preventScroll: true });
          scroller?.scrollTo({
            top: 0,
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
              .matches
              ? 'instant'
              : 'smooth',
          });
        }}
      >
        Back to setup <ArrowUpIcon class="size-4" aria-hidden="true" />
      </button>
    </section>
  );
}
