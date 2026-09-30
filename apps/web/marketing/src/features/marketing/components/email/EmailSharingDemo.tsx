import Envelope from '@phosphor/envelope.svg';
import Hash from '@phosphor/hash.svg';
import PaperPlane from '@phosphor/paper-plane-tilt.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { homepagePeople } from '../../core/homepage-demo-people';
import { HomepageConversation } from '../HomepageConversation';
import { demoEmails } from './email-fixtures';
import { ChannelComposer } from './frozen/ChannelComposer';
import { EmailShell } from './frozen/EmailShell';
import { EmailThread } from './frozen/EmailThread';
import './email-demos.css';
import './email-sharing-stage.css';

const phaseDuration = [1800, 1100, 1100, 1200, 1600, 650, 3200];
const incomingReply =
  'One more thing: could you include the onboarding guide? I’ll share it with the team before Thursday.';

// The Share form's markup/classes come from TopBar/ShareButton.tsx and
// ForwardToChannel.tsx. The animation changes fixture state only; it never
// invokes share permissions, sends messages, or mounts a live app context.
function ShareForm(props: {
  phase: number;
  advance: () => void;
  cancel: () => void;
}) {
  return (
    <div class="mail-share-scrim">
      <div
        class="mail-share-form glass-input"
        role="group"
        aria-label="Share email preview"
      >
        <header class="px-4 flex h-12 items-center gap-1.5 text-sm font-medium">
          <span class="shrink-0">Share:</span>
          <Envelope class="size-4 shrink-0" />
          <span class="truncate">Next steps for our team</span>
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
                  To:{' '}
                  <span class="text-ink">
                    {props.phase >= 2 ? 'launch' : ''}
                  </span>
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
          <div class="grow shrink min-h-20 px-4 py-1.5 w-full text-sm">
            <Show
              when={props.phase >= 4}
              fallback={
                <span class="text-ink-placeholder">Optional message</span>
              }
            >
              Dana’s ready for Thursday. Here’s the conversation.
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
                class="rounded-lg border-0"
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

function ChannelResult(props: { onOpen: () => void; updated: boolean }) {
  const [messages, setMessages] = createSignal<string[]>([]);
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
            { person: 'julia', text: 'What does Dana need before Thursday?' },
            {
              person: 'jacob',
              text: (
                <>
                  Dana’s ready for Thursday. Here’s the conversation.
                  <button
                    type="button"
                    class="mail-shared-thread glass-input"
                    onClick={props.onOpen}
                    aria-label="Open shared email: Next steps for our team"
                  >
                    <span class="mail-shared-thread-label">
                      <Envelope class="size-4" /> Email thread <span>Live</span>
                    </span>
                    <strong>Next steps for our team</strong>
                    <span>Dana Whitfield · Jacob Beckerman</span>
                    <span class="mail-shared-thread-preview">
                      {props.updated
                        ? incomingReply
                        : 'Thursday at 9 works. Could you share the rollout plan?'}
                    </span>
                    <span class="mail-shared-thread-footer">
                      {props.updated
                        ? '2 messages · New reply from Dana'
                        : '1 message · Open full thread'}{' '}
                      <span aria-hidden="true">↗</span>
                    </span>
                  </button>
                </>
              ),
            },
            ...messages().map((text) => ({ person: 'jacob' as const, text })),
          ]}
        />
      </div>
      <div class="mail-channel-composer">
        <ChannelComposer
          onSend={(message) => setMessages([...messages(), message])}
        />
      </div>
    </div>
  );
}

export function EmailSharingDemo(props: { onClose?: () => void } = {}) {
  const [phase, setPhase] = createSignal(0);
  const [playing, setPlaying] = createSignal(true);
  const [opened, setOpened] = createSignal(false);
  let root!: HTMLDivElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let visible = false;
  let reduced = false;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    clear();
    if (!visible || !playing() || reduced || document.hidden || phase() >= 7)
      return;
    timer = setTimeout(() => {
      setPhase(phase() + 1);
      if (phase() >= 7) setPlaying(false);
      schedule();
    }, phaseDuration[phase()]);
  };
  const manual = (next: number) => {
    clear();
    setPlaying(false);
    setPhase(next);
    setOpened(false);
  };
  onMount(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => {
      reduced = preference.matches;
      if (reduced) {
        clear();
        setPlaying(false);
        setPhase(7);
      } else schedule();
    };
    syncPreference();
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        schedule();
      },
      { threshold: 0.2 }
    );
    observer.observe(root);
    preference.addEventListener('change', syncPreference);
    document.addEventListener('visibilitychange', schedule);
    onCleanup(() => {
      clear();
      observer.disconnect();
      preference.removeEventListener('change', syncPreference);
      document.removeEventListener('visibilitychange', schedule);
    });
  });
  return (
    <div ref={root} class="mail-sharing-demo" data-phase={phase()}>
      <div
        class="mail-sharing-stage"
        data-result={phase() >= 6 && !opened()}
        data-opened={opened()}
      >
        <EmailShell
          class="glass-input"
          label="Email sharing animation"
          channel={phase() >= 6 && !opened()}
        >
          <Show
            when={phase() >= 6 && !opened()}
            fallback={
              <EmailThread
                email={demoEmails[0]}
                hideReply
                onBack={opened() ? () => setOpened(false) : undefined}
                onShare={() => manual(2)}
                sharing={phase() === 1}
              >
                <Show when={opened() && phase() >= 7}>
                  <div class="mail-arrived-reply glass-input">
                    <header>
                      <strong>Dana Whitfield</strong>
                      <span>Just now</span>
                    </header>
                    <p>{incomingReply}</p>
                  </div>
                </Show>
              </EmailThread>
            }
          >
            <ChannelResult
              updated={phase() >= 7}
              onOpen={() => {
                clear();
                setPlaying(false);
                setOpened(true);
              }}
            />
          </Show>
        </EmailShell>
        <Show when={phase() >= 1 && phase() <= 5}>
          <ShareForm
            phase={phase()}
            advance={() => manual(phase() < 3 ? 3 : 6)}
            cancel={() => manual(0)}
          />
        </Show>
      </div>
      <div class="mail-demo-controls">
        <span>
          {phase() >= 7
            ? 'Dana replied. Your whole team is already up to date.'
            : phase() === 6
              ? 'Shared. Open the email right from the channel.'
              : 'Choose #launch, add a note, and share.'}
        </span>
        <Show when={props.onClose}>
          <Button variant="plain" size="sm" onClick={props.onClose}>
            Back to inbox
          </Button>
        </Show>
      </div>
    </div>
  );
}
