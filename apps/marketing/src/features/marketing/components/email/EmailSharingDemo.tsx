import Envelope from '@phosphor/envelope.svg';
import Hash from '@phosphor/hash.svg';
import PaperPlane from '@phosphor/paper-plane-tilt.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { meetingEmail, meetingReply } from '../../core/email-demo-story';
import { homepagePeople } from '../../core/homepage-demo-people';
import { createDemoPointer } from '../../primitives/createDemoPointer';
import { createEmailWalkthrough } from '../../primitives/createEmailWalkthrough';
import { demoTypingActions } from '../../primitives/demoTypingActions';
import { DemoCursor } from '../DemoCursor';
import { DocMention } from '../documents/DocMention';
import {
  HomepageConversation,
  type HomepageMessage,
} from '../HomepageConversation';
import { ChannelComposer } from './frozen/ChannelComposer';
import { EmailShell } from './frozen/EmailShell';
import { EmailThread } from './frozen/EmailThread';
import './email-feature-demos.css';
import './email-demos.css';
import './email-sharing-stage.css';

const shareMessage = 'Here’s the email for Thursday.';

// The Share form's markup/classes come from TopBar/ShareButton.tsx and
// ForwardToChannel.tsx. The animation changes fixture state only; it never
// invokes share permissions, sends messages, or mounts a live app context.
function ShareForm(props: {
  phase: number;
  query: string;
  message: string;
  advance: () => void;
  cancel: () => void;
}) {
  return (
    <div class="mail-share-scrim">
      <div
        class="mail-share-form"
        role="group"
        aria-label="Share email preview"
      >
        <header class="px-4 flex h-12 items-center gap-1.5 text-sm font-medium">
          <span class="shrink-0">Share:</span>
          <Envelope class="size-4 shrink-0" />
          <span class="truncate">Thursday demo</span>
          <Button
            variant="plain"
            size="icon-sm"
            class="ml-auto"
            aria-label="Close share preview"
            onClick={props.cancel}
          >
            <X />
          </Button>
        </header>
        <div class="flex items-center pr-2">
          <div class="min-w-0 flex-1 min-h-11 mail-recipient-input">
            <Show
              when={props.phase >= 3}
              fallback={
                <span class="text-ink-placeholder">
                  To: <span class="text-ink">{props.query}</span>
                  <span class="mail-typing-caret" />
                </span>
              }
            >
              <span class="mail-recipient-chip">
                <Hash class="size-4" />
                launch
              </span>
            </Show>
          </div>
        </div>
        <Show when={props.phase === 2}>
          <button
            type="button"
            class="mail-recipient-option"
            onClick={props.advance}
          >
            <Hash class="size-4" />
            <span>launch</span>
            <span class="ml-auto text-xs text-ink-muted">Channel</span>
          </button>
        </Show>
        <div class="grow shrink min-h-0 flex flex-col w-full border-t border-edge-muted">
          <div
            class="grow shrink min-h-20 px-4 py-1.5 w-full text-sm"
            data-share-message-input
          >
            <Show
              when={props.phase >= 4}
              fallback={
                <span class="text-ink-placeholder">Optional message</span>
              }
            >
              <span data-share-message>{props.message}</span>
            </Show>
          </div>
          <div class="shrink-0 flex w-full items-center px-4 py-4 gap-3 flex-wrap">
            <div class="flex flex-auto items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                class="text-ink-extra-muted"
                onClick={props.cancel}
              >
                Cancel
              </Button>
              <Button
                variant={props.phase >= 3 ? 'accent' : 'ghost'}
                depth={3}
                class="mail-share-submit rounded-lg border-0"
                disabled={props.phase < 3}
                onClick={props.advance}
                data-active={props.phase === 5}
              >
                <PaperPlane class="size-4" />
                Share<kbd class="text-[10px] opacity-60">⌘ ↵</kbd>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChannelResult(props: {
  shared: boolean;
  updated: boolean;
  onOpen: () => void;
}) {
  // Solid's For keys by object identity. Keep existing messages stable across phases.
  const question: HomepageMessage = {
    person: 'julia',
    text: 'What does Valentina need before Thursday?',
  };
  const sharedEmail: HomepageMessage = {
    person: 'jacob',
    text: (
      <>
        Here’s the email for Thursday:{' '}
        <button
          type="button"
          class="mail-shared-thread"
          onClick={() => props.onOpen()}
          aria-label="Open shared email: Thursday demo"
        >
          <DocMention item={{ kind: 'email', label: 'Thursday demo' }} />
        </button>
      </>
    ),
  };
  const followUp: HomepageMessage = {
    person: 'julia',
    text: 'I’ll send the setup guide before the call.',
  };
  const [messages, setMessages] = createSignal<HomepageMessage[]>([]);
  return (
    <div class="mail-channel">
      <header class="flex h-12 items-center gap-2 px-4 text-sm">
        <Hash class="size-4" />
        <span>launch</span>
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
      <div class="mail-channel-messages">
        <HomepageConversation
          messages={[
            question,
            ...(props.shared ? [sharedEmail] : []),
            ...(props.updated ? [followUp] : []),
            ...messages(),
          ]}
        />
      </div>
      <div class="mail-channel-composer">
        <ChannelComposer
          onSend={(text) =>
            setMessages((previous) => [...previous, { person: 'jacob', text }])
          }
        />
      </div>
    </div>
  );
}

export function EmailSharingDemo(props: { onClose?: () => void } = {}) {
  const [phase, setPhase] = createSignal(0);
  const [opened, setOpened] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [message, setMessage] = createSignal('');
  let root!: HTMLDivElement;
  const [target, setTarget] = createSignal<string>();
  const [clicking, setClicking] = createSignal(false);
  const approach = (selector: string) => {
    setClicking(false);
    setTarget(selector);
  };
  const click = (run: () => void) => {
    setClicking(true);
    run();
  };

  const finish = () => {
    setPhase(7);
    queueMicrotask(() => {
      const body = root.querySelector<HTMLElement>(
        '.mail-sharing-email > .mail-thread > .mail-thread-body'
      );
      body?.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
    });
  };
  const actions = [
    { delay: 1200, run: () => approach('[data-demo-share-trigger]') },
    { delay: 650, run: () => click(() => setPhase(1)) },
    { delay: 350, run: () => approach('.mail-recipient-input') },
    { delay: 650, run: () => click(() => {}) },
    ...demoTypingActions(
      'launch',
      (text) => {
        setClicking(false);
        setPhase(2);
        setQuery(text);
      },
      800
    ),
    { delay: 550, run: () => approach('.mail-recipient-option') },
    { delay: 650, run: () => click(() => setPhase(3)) },
    { delay: 350, run: () => approach('[data-share-message-input]') },
    { delay: 650, run: () => click(() => {}) },
    ...demoTypingActions(
      shareMessage,
      (text) => {
        setClicking(false);
        setPhase(4);
        setMessage(text);
      },
      700
    ),
    {
      delay: 700,
      run: () => {
        approach('.mail-share-submit');
        setPhase(5);
      },
    },
    { delay: 650, run: () => click(() => setPhase(6)) },
    { delay: 350, run: () => setClicking(false) },
    { delay: 2600, run: finish },
    { delay: 2000, run: () => setPhase(8) },
  ];
  const playback = createEmailWalkthrough({
    root: () => root,
    steps: actions.length,
    visibilityThreshold: 0.45,
    delay: (step) => actions[step - 1].delay,
    loop: { hold: 8000 },
    reset: () => {
      setTarget(undefined);
      setClicking(false);
      setPhase(0);
      setOpened(false);
      setQuery('');
      setMessage('');
      root
        .querySelectorAll<HTMLElement>('.mail-thread-body, [role="log"]')
        .forEach((el) => {
          el.scrollTop = 0;
        });
    },
    reduced: () => setPhase(8),
    advance: (step) => actions[step - 1].run(),
  });
  const manual = (next: number) => {
    playback.pause();
    setPhase(next);
    setOpened(false);
    setQuery('launch');
    setMessage(shareMessage);
  };
  const pointer = createDemoPointer({
    frame: () => root,
    target,
    active: () => playback.playing() && !playback.reducedMotion(),
  });
  return (
    <div
      ref={root}
      class="mail-sharing-demo email-feature-demo"
      data-phase={phase()}
      onPointerDown={playback.pause}
      onFocusIn={playback.pause}
    >
      <div
        class="mail-sharing-stage"
        data-result={phase() >= 6 && !opened()}
        data-opened={opened()}
      >
        <EmailShell showRail={false} label="Share a live email with your team">
          <div class="mail-sharing-splits">
            <section class="mail-sharing-email" aria-label="Customer email">
              <EmailThread
                email={meetingEmail}
                hideReply
                onBack={opened() ? () => setOpened(false) : undefined}
                onShare={() => manual(2)}
                sharing={phase() === 0 && playback.playing()}
              >
                <Show when={phase() >= 7}>
                  <EmailThread
                    email={{
                      ...meetingEmail,
                      id: 'follow-up',
                      time: 'Just now',
                      body: meetingReply,
                    }}
                    hideHeader
                    hideSubject
                    hideReply
                  />
                </Show>
              </EmailThread>
              <Show when={phase() >= 1 && phase() <= 5}>
                <ShareForm
                  phase={phase()}
                  query={query()}
                  message={message()}
                  advance={() => manual(phase() < 3 ? 3 : 6)}
                  cancel={() => manual(0)}
                />
              </Show>
            </section>
            <section class="mail-sharing-chat" aria-label="Team conversation">
              <ChannelResult
                shared={phase() >= 6}
                updated={phase() >= 8}
                onOpen={() => {
                  playback.pause();
                  setOpened(true);
                }}
              />
            </section>
          </div>
        </EmailShell>
      </div>
      <Show when={props.onClose}>
        <div class="mail-demo-controls">
          <Button variant="plain" size="sm" onClick={props.onClose}>
            Back to inbox
          </Button>
        </div>
      </Show>
      <Show when={pointer()}>
        {(point) => (
          <DemoCursor
            class="email-demo-pointer"
            clicking={clicking()}
            style={{ transform: `translate(${point().x}px, ${point().y}px)` }}
          />
        )}
      </Show>
    </div>
  );
}
