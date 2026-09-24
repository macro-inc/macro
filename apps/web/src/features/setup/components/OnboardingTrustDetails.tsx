import ArrowUpIcon from '@phosphor/arrow-up.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { For, type JSX, Show } from 'solid-js';

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

/** Optional reading, grounded in Macro's privacy policy, DPA, and security material. */
export function OnboardingTrustDetails(props: {
  topic: 'security' | 'google';
}) {
  const google = () => props.topic === 'google';
  const questions = () =>
    google()
      ? [
          {
            title: 'Why does Google ask for these permissions?',
            answer: (
              <>
                Macro is a full email client. Gmail access lets you read, send,
                organize, and move messages to trash. Contacts help suggest
                recipients; mail settings support your signature and filters.
                When you connect Calendar, its permissions let Macro show your
                calendars and create or update events. Google shows the exact
                permissions before you approve.
              </>
            ),
          },
          {
            title: 'Does Macro get my Google password?',
            answer: (
              <>
                No. You sign in and approve access on Google. Google gives Macro
                authorization for the permissions you approve; your Google
                password stays with Google.
              </>
            ),
          },
          {
            title: 'Is my email used to train AI?',
            answer: (
              <>
                Data received through Google Workspace APIs is not used to
                develop or train generalized AI models. Macro also maintains
                zero data retention agreements with OpenAI and Anthropic for
                model processing. These protect the information sent to those
                providers when you use an agent.
              </>
            ),
          },
          {
            title: 'What if I change my mind?',
            answer: (
              <>
                You can disconnect in Macro’s Settings or revoke access from
                your Google account. Revoking access and deleting data already
                stored in Macro are separate actions. You can request account
                and data deletion as described in our{' '}
                <EvidenceLink href="https://macro.com/privacy/">
                  Privacy Policy
                </EvidenceLink>
                .
              </>
            ),
          },
        ]
      : [
          {
            title: 'What does zero data retention mean?',
            answer: (
              <>
                When you use an agent, information needed for your request is
                processed by its model provider. Our agreements with OpenAI and
                Anthropic provide zero data retention and no training on that
                data. This concerns model processing: Macro still stores the
                workspace content needed to provide the service.
              </>
            ),
          },
          {
            title: 'Who can access production data?',
            answer: (
              <>
                Production access is restricted to authorized engineering staff,
                and development runs in a separate environment. Personnel who
                process customer data are bound by confidentiality obligations.
                These controls support the work of operating and securing Macro
                while limiting access to customer information.
              </>
            ),
          },
          {
            title: 'Can my team review the security evidence?',
            answer: (
              <>
                Yes. Our security program includes SOC 2, ISO 27001, and Google
                CASA Tier 2, with external audits and penetration testing. Visit
                our{' '}
                <EvidenceLink href="https://security.macro.com">
                  Trust Center
                </EvidenceLink>{' '}
                for security information. Our{' '}
                <EvidenceLink href="https://macro.com/dpa">
                  Data Processing Agreement
                </EvidenceLink>{' '}
                describes confidentiality, safeguards, subprocessors, and data
                return or deletion.
              </>
            ),
          },
          {
            title: 'Can I look beyond the promises?',
            answer: (
              <>
                Macro is open source: you can inspect our{' '}
                <EvidenceLink href="https://github.com/macro-inc/macro">
                  code on GitHub
                </EvidenceLink>
                . We are backed by Andreessen Horowitz and have raised more than
                $30 million. You can review the code, policies, and security
                materials before deciding what to connect.
              </>
            ),
          },
        ];

  return (
    <section class="mx-auto w-full max-w-[608px] px-6 pb-20 pt-20 font-[Inter_Variable] text-sm leading-7 text-ink-muted sm:pb-28 sm:pt-24 sm:text-[15px]">
      <div class="mb-10 h-px w-12 bg-edge" aria-hidden="true" />
      <p class="mb-4 text-xs text-ink-extra-muted">
        {google() ? 'Your connection, explained' : 'Security & privacy'}
      </p>
      <h2
        tabindex="-1"
        class="mb-7 text-2xl font-medium leading-8 tracking-tight text-ink outline-none sm:text-[28px] sm:leading-9"
      >
        {google()
          ? 'Your account. Your permission.'
          : 'How we protect your work.'}
      </h2>
      <div class="space-y-5">
        <Show
          when={google()}
          fallback={
            <>
              <p>
                Your workspace holds conversations, documents, and plans that
                matter. Connecting those to Macro is a decision about trust. We
                treat that access as a responsibility: your information is used
                to provide your workspace and the features you choose. We do not
                sell your data.
              </p>
              <p>
                Your data is encrypted in transit and at rest. Production access
                is restricted, and development is kept separate. Independent
                audits and penetration testing help us assess these protections
                over time, rather than treating security as a one-time check.
              </p>
              <p>
                We want you to be able to examine those commitments. Our code is
                open source, our security program is independently assessed, and
                our policies explain how information is processed. The details
                below are here for you to read before you connect anything.
              </p>
            </>
          }
        >
          <p>
            Google’s permission screen can feel like a big request. Macro asks
            for access because it works as your email client and calendar: you
            can read and organize messages, reply to people, and manage the
            calendars you connect in one workspace.
          </p>
          <p>
            Permission to connect your inbox is not permission for an agent to
            send an email without review. Macro’s email agents show you the
            message and ask for your approval before sending. You can read the
            draft and decide whether it should go out.
          </p>
          <p>
            You approve the connection on Google, and your password stays there.
            Your work Google account becomes your Macro sign-in; adding a
            personal account is optional. You can review the permissions before
            connecting and revoke access later.
          </p>
        </Show>
      </div>
      <h3 class="mb-3 mt-12 text-base font-medium text-ink">
        A few questions you might have
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
