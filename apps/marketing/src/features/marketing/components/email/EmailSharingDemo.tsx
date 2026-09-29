import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import Envelope from '@phosphor/envelope.svg';
import Hash from '@phosphor/hash.svg';
import PaperPlane from '@phosphor/paper-plane-tilt.svg';
import Pause from '@phosphor/pause.svg';
import Play from '@phosphor/play.svg';
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

const phaseDuration = [1800, 1100, 1100, 1200, 1600, 650, 5500];

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
        class="mail-share-form"
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
        <div class="flex items-center bg-surface pr-2">
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

function ChannelResult(props: { onOpen: () => void }) {
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
                  <span class="flex flex-row mt-2 gap-2 flex-wrap max-w-full">
                    <button
                      type="button"
                      class="text-ink text-sm border border-edge-muted rounded-xs hover:bg-hover flex flex-row h-6 px-2 justify-center items-center max-w-full"
                      onClick={props.onOpen}
                      aria-label="Open shared email: Next steps for our team"
                    >
                      <span class="flex justify-start items-center w-3.5 h-3.5 mr-2">
                        <Envelope />
                      </span>
                      <span class="flex-1 text-left leading-5 min-w-0 truncate">
                        Next steps for our team
                      </span>
                    </button>
                  </span>
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
  const [reducedMotion, setReducedMotion] = createSignal(false);
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
    if (!visible || !playing() || reduced || document.hidden) return;
    timer = setTimeout(() => {
      setPhase((phase() + 1) % phaseDuration.length);
      schedule();
    }, phaseDuration[phase()]);
  };
  const manual = (next: number) => {
    clear();
    setPlaying(false);
    setPhase(next);
    setOpened(false);
  };
  const replay = () => {
    setOpened(false);
    setPhase(reduced ? 6 : 0);
    setPlaying(!reduced);
    schedule();
  };
  onMount(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => {
      reduced = preference.matches;
      setReducedMotion(reduced);
      if (reduced) {
        clear();
        setPlaying(false);
        setPhase(6);
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
      <EmailShell
        label="Email sharing animation"
        channel={phase() === 6 && !opened()}
      >
        <Show
          when={phase() === 6 && !opened()}
          fallback={
            <EmailThread
              email={demoEmails[0]}
              onBack={opened() ? () => setOpened(false) : undefined}
              onShare={() => manual(2)}
              sharing={phase() === 1}
            />
          }
        >
          <ChannelResult
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
      <div class="mail-demo-controls">
        <Show when={!reducedMotion()}>
          <Button
            variant="plain"
            size="sm"
            aria-label={
              playing() ? 'Pause sharing animation' : 'Play sharing animation'
            }
            onClick={() => {
              setPlaying(!playing());
              schedule();
            }}
          >
            <Show when={playing()} fallback={<Play />}>
              <Pause />
            </Show>
            {playing() ? 'Pause' : 'Play'}
          </Button>
        </Show>
        <Button variant="plain" size="sm" onClick={replay}>
          <ArrowCounterClockwise />
          Replay
        </Button>
        <span>
          {phase() === 6
            ? 'The email is shared in #launch.'
            : 'Share an email with a channel.'}
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
