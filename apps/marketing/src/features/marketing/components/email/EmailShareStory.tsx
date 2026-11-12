import ArrowRight from '@icon/system/regular/arrow-right.svg';
import Check from '@icon/system/regular/check.svg';
import Envelope from '@icon/system/regular/envelope.svg';
import Hash from '@icon/system/regular/hash.svg';
import Share from '@icon/system/regular/users-three.svg';
import { createSignal, For, Show } from 'solid-js';
import { meetingEmail, meetingReply } from '../../core/email-demo-story';
import { homepagePeople } from '../../core/homepage-demo-people';
import { createDemoPointer } from '../../primitives/createDemoPointer';
import { createEmailWalkthrough } from '../../primitives/createEmailWalkthrough';
import { DemoCursor } from '../DemoCursor';
import './email-share-story.css';

/** A single, finite email → share → channel story, separate from the inbox sandbox. */
export function EmailShareStory() {
  const [stage, setStage] = createSignal(0);
  const [selected, setSelected] = createSignal(false);
  const [reply, setReply] = createSignal(false);
  const [target, setTarget] = createSignal<string>();
  const [clicking, setClicking] = createSignal(false);
  let root!: HTMLDivElement;
  const point = (selector: string) => {
    setClicking(false);
    setTarget(selector);
  };
  const actions = [
    () => point('[data-share-email]'),
    () => {
      setClicking(true);
      setStage(1);
    },
    () => point('[data-share-channel]'),
    () => {
      setClicking(true);
      setSelected(true);
    },
    () => point('[data-confirm-share]'),
    () => {
      setClicking(true);
      setStage(2);
    },
    () => {
      setTarget(undefined);
      setReply(true);
    },
  ];
  const playback = createEmailWalkthrough({
    root: () => root,
    steps: actions.length,
    delay: (step) => (step === 7 ? 2000 : step === 1 ? 1000 : 750),
    advance: (step) => actions[step - 1](),
    reset: () => {
      setStage(0);
      setSelected(false);
      setReply(false);
      setTarget(undefined);
      setClicking(false);
    },
    reduced: () => {
      setStage(2);
      setSelected(true);
      setReply(true);
    },
  });
  const manual = (next: number) => {
    playback.pause();
    setTarget(undefined);
    setStage(next);
    setSelected(false);
    setReply(false);
  };
  const pointer = createDemoPointer({
    frame: () => root,
    target,
    active: () => playback.playing() && !playback.reducedMotion(),
  });

  return (
    <div
      ref={root}
      class="email-share-story"
      data-stage={stage()}
      onPointerDown={playback.pause}
      onFocusIn={playback.pause}
    >
      <nav class="email-share-steps" aria-label="Email sharing steps">
        <For each={['Email', 'Share', 'Chat']}>
          {(label, index) => (
            <>
              <Show when={index() > 0}>
                <ArrowRight aria-hidden="true" />
              </Show>
              <button
                type="button"
                aria-current={stage() === index() ? 'step' : undefined}
                onClick={() => manual(index())}
              >
                <span>{index() + 1}</span>
                {label}
              </button>
            </>
          )}
        </For>
      </nav>
      <div class="email-share-window">
        <Show
          when={stage() < 2}
          fallback={
            <section
              class="email-share-scene"
              aria-label="Shared email in launch channel"
            >
              <header class="email-share-bar">
                <Hash />
                <strong>launch</strong>
                <span class="email-share-status">
                  <Check /> Shared
                </span>
              </header>
              <div class="email-share-content">
                <div class="email-share-person">
                  <img src={homepagePeople.jacob.photo} alt="" />
                  <strong>Jacob Beckerman</strong>
                  <span>Just now</span>
                </div>
                <p>Here’s the email for Thursday.</p>
                <div class="email-share-thread">
                  <div class="email-share-thread-title">
                    <Envelope />
                    <strong>{meetingEmail.subject}</strong>
                    <span>Live thread</span>
                  </div>
                  <div class="email-share-excerpt">
                    <strong>{meetingEmail.sender}</strong>
                    <p>{meetingEmail.snippet}</p>
                  </div>
                  <Show
                    when={reply()}
                    fallback={
                      <button
                        type="button"
                        class="email-share-new-reply"
                        onClick={() => {
                          playback.pause();
                          setReply(true);
                        }}
                      >
                        Show a new reply <ArrowRight />
                      </button>
                    }
                  >
                    <div class="email-share-reply">
                      <span>New reply · {meetingEmail.sender}</span>
                      <p>{meetingReply}</p>
                    </div>
                  </Show>
                </div>
              </div>
            </section>
          }
        >
          <section
            class="email-share-scene"
            aria-label="Customer email to share"
          >
            <header class="email-share-bar">
              <Envelope />
              <strong>{meetingEmail.subject}</strong>
              <button type="button" data-share-email onClick={() => manual(1)}>
                <Share /> Share
              </button>
            </header>
            <div class="email-share-content">
              <div class="email-share-person">
                <strong>{meetingEmail.sender}</strong>
                <span>to Jacob</span>
              </div>
              <div class="email-share-body">{meetingEmail.body}</div>
            </div>
            <Show when={stage() === 1}>
              <div class="email-share-overlay">
                <div
                  class="email-share-picker"
                  role="group"
                  aria-label="Share email to a channel"
                >
                  <strong>Share email</strong>
                  <span class="email-share-picker-hint">Choose a channel</span>
                  <button
                    type="button"
                    data-share-channel
                    aria-pressed={selected()}
                    onClick={() => setSelected(true)}
                  >
                    <Hash />
                    <span>launch</span>
                    <Show when={selected()}>
                      <Check />
                    </Show>
                  </button>
                  <p>Your team can read this thread and future replies.</p>
                  <button
                    type="button"
                    data-confirm-share
                    disabled={!selected()}
                    onClick={() => manual(2)}
                  >
                    Share to channel <ArrowRight />
                  </button>
                </div>
              </div>
            </Show>
          </section>
        </Show>
      </div>
      <p class="email-share-caption">
        {
          [
            'Start with the customer’s email.',
            'Give the channel access to the live thread.',
            'New replies appear in the shared thread.',
          ][stage()]
        }
      </p>
      <Show when={pointer()}>
        {(position) => (
          <DemoCursor
            clicking={clicking()}
            style={{
              transform: `translate(${position().x}px, ${position().y}px)`,
            }}
          />
        )}
      </Show>
    </div>
  );
}
