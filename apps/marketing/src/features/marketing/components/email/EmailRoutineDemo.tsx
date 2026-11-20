import MacroLogo from '@icon/macro-logo.svg';
import Hash from '@icon/system/regular/hash.svg';
import { createEffect, createSignal, on, Show } from 'solid-js';
import { type DemoEmail, demoEmails } from '../../core/demo-email';
import { homepagePeople } from '../../core/homepage-demo-people';
import { createEmailWalkthrough } from '../../primitives/createEmailWalkthrough';
import { DocMention } from '../documents/DocMention';
import {
  HomepageConversation,
  type HomepageMessage,
} from '../HomepageConversation';
import { ChannelComposer } from './frozen/ChannelComposer';
import { EmailRows } from './frozen/EmailRows';
import { EmailShell } from './frozen/EmailShell';
import { EmailViewBar } from './frozen/EmailViewBar';
import './email-feature-demos.css';
import './email-demos.css';
import './email-sharing-stage.css';
import './email-routine-stage.css';

const renewal: DemoEmail = {
  id: 'renewal',
  tags: ['customers'],
  sender: 'Austin Barron',
  subject: 'Renewing for the full team',
  snippet: 'We’re ready to renew. Can you send the contract by Friday?',
  time: '10:02 AM',
  account: 'work',
  unread: true,
};
// The customer's earlier email would read as the same thread.
const inbox = demoEmails
  .filter((email) => !email.noise && email.id !== 'dana')
  .slice(0, 6);
const need = 'They’re ready to renew and need the contract by Friday.';

// Solid's For keys by object identity. Keep existing messages stable across phases.
const earlier: HomepageMessage = {
  person: 'julia',
  text: 'Flag customer renewals here.',
};
const alert: HomepageMessage = {
  person: 'macro',
  text: (
    <>
      New from Austin Barron:{' '}
      <DocMention item={{ kind: 'email', label: renewal.subject }} />. {need}
    </>
  ),
};

/**
 * A routine reacts to an important customer email: the email arrives in the
 * inbox, Macro posts it to the team's channel, and a push notification follows.
 */
export function EmailRoutineDemo() {
  let root!: HTMLDivElement;
  // 1: the email arrives. 2: the channel message. 3: the push notification.
  const [phase, setPhase] = createSignal(0);
  const [sent, setSent] = createSignal<HomepageMessage[]>([]);
  let log: HTMLDivElement | undefined;
  // The channel keeps its newest message in view, as the app does.
  createEffect(
    on(
      () => [phase(), sent().length],
      () =>
        queueMicrotask(() => {
          if (log) log.scrollTop = log.scrollHeight;
        })
    )
  );
  const playback = createEmailWalkthrough({
    root: () => root,
    steps: 3,
    visibilityThreshold: 0.45,
    delay: (step) => [1200, 1500, 1100][step - 1],
    loop: { hold: 7000 },
    advance: setPhase,
    reset: () => setPhase(0),
    reduced: () => setPhase(3),
  });
  return (
    <div
      ref={root}
      class="mail-routine-demo email-feature-demo"
      data-phase={phase()}
      onPointerDown={playback.pause}
      onFocusIn={playback.pause}
    >
      <div class="mail-sharing-stage mail-routine-stage">
        <EmailShell
          showRail={false}
          label="A routine posts an important customer email to a channel"
        >
          <div class="mail-sharing-splits">
            <section
              class="mail-sharing-email mail-routine-inbox"
              aria-label="Inbox"
            >
              <EmailViewBar tab="signal" />
              <div class="mail-routine-list">
                <EmailRows
                  emails={phase() >= 1 ? [renewal, ...inbox] : inbox}
                  selectedId={phase() >= 1 ? renewal.id : undefined}
                  onOpen={() => {}}
                />
              </div>
            </section>
            <section class="mail-sharing-chat" aria-label="Customers channel">
              <div class="mail-channel">
                <header class="flex h-12 items-center gap-2 px-4 text-sm">
                  <Hash class="size-4" />
                  <span>customers</span>
                  <div class="ml-auto flex -space-x-1">
                    <img
                      class="size-5 rounded-full"
                      src={homepagePeople.jacob.photo}
                      alt="Jacob"
                    />
                    <img
                      class="size-5 rounded-full"
                      src={homepagePeople.julia.photo}
                      alt="Julia"
                    />
                  </div>
                </header>
                <div ref={log} class="mail-channel-messages">
                  <HomepageConversation
                    messages={[
                      earlier,
                      ...(phase() >= 2 ? [alert] : []),
                      ...sent(),
                    ]}
                  />
                </div>
                <div class="mail-channel-composer">
                  <ChannelComposer
                    label="Message #customers"
                    placeholder="Message #customers"
                    onSend={(text) =>
                      setSent((previous) => [
                        ...previous,
                        { person: 'jacob', text },
                      ])
                    }
                  />
                </div>
              </div>
            </section>
          </div>
        </EmailShell>
        <Show when={phase() >= 3}>
          <div class="mail-routine-push" role="status">
            <span class="mail-routine-push-icon" aria-hidden="true">
              <MacroLogo />
            </span>
            <div>
              <p>
                <strong>Important customer email</strong>
                <span>now</span>
              </p>
              <p>Austin Barron: {need}</p>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
