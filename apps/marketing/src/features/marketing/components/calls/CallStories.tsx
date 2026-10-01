import ArrowLeft from '@phosphor/arrow-left.svg';
import PhoneCall from '@phosphor/phone-call.svg';
import Share from '@phosphor/share.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { HomepagePersonId } from '../../core/homepage-demo-people';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { ViewShell } from '../DemoWorkspaceChrome';
import { HomepageConversation } from '../HomepageConversation';
import { ProductDemo } from '../product/ProductPage';
import { ProductShareDialog } from '../product/ProductShareDialog';
import { ProductWorkspace } from '../product/ProductWorkspace';
import { PersonIcon } from '../workspace/frozen/TaskProperties';
import '../workspace/dummy-workspace.css';

const transcript: {
  person: HomepagePersonId;
  name: string;
  time: string;
  text: string;
}[] = [
  {
    person: 'jacob',
    name: 'Jacob Beckerman',
    time: '0:12',
    text: 'Let’s confirm the last checks for Thursday’s launch.',
  },
  {
    person: 'teo',
    name: 'Teo Nys',
    time: '0:48',
    text: 'I’ll verify the invite flow before we publish. The handoff needs one final check.',
  },
  {
    person: 'julia',
    name: 'Julia Westphal',
    time: '1:24',
    text: 'I’ll finish the announcement after Teo confirms the invite flow.',
  },
];

/** Presentation from CallRecordingBody and CallTranscript; fictional local data. */
export function ProductCallRecord(props: {
  transcriptOnly?: boolean;
  selected?: string;
  onSelect?: (time: string) => void;
  onBack?: () => void;
  onShare?: () => void;
}) {
  const [localTime, setLocalTime] = createSignal('');
  const [sharing, setSharing] = createSignal(false);
  const selected = () => props.selected ?? localTime();
  return (
    <>
      <ViewShell.TopBar>
        <Show when={props.onBack}>
          <Button
            variant="plain"
            size="icon-sm"
            label="Back to channel calls"
            onClick={props.onBack}
          >
            <ArrowLeft />
          </Button>
        </Show>
        <PhoneCall class="size-4 text-ink-muted" />
        <span class="text-sm font-medium">Launch check-in</span>
        <Button
          variant="plain"
          size="sm"
          class="ml-auto"
          onClick={() => {
            props.onShare?.();
            setSharing(true);
          }}
        >
          <Share class="size-4" />
          Share
        </Button>
      </ViewShell.TopBar>
      <div class="dummy-scroll product-call-body">
        <header>
          <h1>Launch check-in</h1>
          <p>
            Sep 24, 2026 · 9:30 AM <span>·</span> 12m 18s
          </p>
        </header>
        <Show when={!props.transcriptOnly}>
          <section>
            <h3>
              Participants <span>3</span>
            </h3>
            <div class="product-call-participants">
              <For each={['jacob', 'teo', 'julia'] as const}>
                {(person) => (
                  <span>
                    <PersonIcon person={person} />
                    {person}@launch.example
                  </span>
                )}
              </For>
            </div>
          </section>
          <section>
            <h3>Summary</h3>
            <p>
              The team confirmed Thursday’s launch. Teo will verify the invite
              flow; Julia will finish the announcement after that check. Jacob
              will review the final checklist before publishing.
            </p>
          </section>
        </Show>
        <section>
          <h3>Transcript</h3>
          <div class="product-call-transcript">
            <For each={transcript}>
              {(segment) => (
                <button
                  type="button"
                  class="product-call-segment"
                  aria-label={`Go to ${segment.time}: ${segment.name}`}
                  aria-pressed={selected() === segment.time}
                  onClick={() => {
                    setLocalTime(segment.time);
                    props.onSelect?.(segment.time);
                  }}
                >
                  <PersonIcon person={segment.person} />
                  <span>
                    <span class="product-call-speaker">
                      {segment.name}
                      <span>{segment.time}</span>
                    </span>
                    <span class="product-call-words">{segment.text}</span>
                  </span>
                </button>
              )}
            </For>
          </div>
        </section>
      </div>
      <ProductShareDialog
        open={sharing()}
        title="Launch check-in"
        kind="call"
        onClose={() => setSharing(false)}
      />
    </>
  );
}

export function CallArchiveDemo(props: { animate?: boolean } = {}) {
  let root!: HTMLDivElement;
  const [opened, setOpened] = createSignal(false);
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 3,
    reset: () => {},
    reduced: () => {
      if (props.animate) setOpened(true);
    },
    advance: (s) => {
      if (props.animate && s === 2) setOpened(true);
    },
  });
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="Open a call from the channel’s Calls tab"
      onInteract={playback.pause}
    >
      <Show
        when={opened()}
        fallback={
          <>
            <ViewShell.TopBar>
              <span class="text-sm font-medium"># launch</span>
              <span class="ml-4 text-xs text-ink-muted">Messages</span>
              <span class="ml-3 text-xs text-ink-muted">Attachments</span>
              <span class="ml-3 text-xs">Calls</span>
            </ViewShell.TopBar>
            <div class="dummy-scroll product-call-list">
              <p>Channel calls</p>
              <button type="button" onClick={() => setOpened(true)}>
                <PhoneCall class="size-4 text-ink-muted" />
                <span>
                  Launch check-in
                  <span class="text-xs text-ink-muted">launch · 12m 18s</span>
                </span>
                <span class="product-call-list-people">
                  <PersonIcon person="jacob" />
                  <PersonIcon person="teo" />
                  <PersonIcon person="julia" />
                </span>
                <span>Sep 24</span>
              </button>
            </div>
          </>
        }
      >
        <ProductCallRecord onBack={() => setOpened(false)} />
      </Show>
    </ProductDemo>
  );
}

export function CallTranscriptDemo() {
  let root!: HTMLDivElement;
  const [selected, setSelected] = createSignal('');
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 3,
    reset: () => {},
    reduced: () => setSelected('0:48'),
    advance: (s) => {
      if (s === 2) setSelected('0:48');
    },
  });
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="Return to the invite decision in the transcript"
      onInteract={playback.pause}
    >
      <ProductCallRecord
        transcriptOnly
        selected={selected()}
        onSelect={setSelected}
      />
    </ProductDemo>
  );
}

export function CallFollowupDemo() {
  let root!: HTMLDivElement;
  const w = createDummyWorkspace('tasks');
  w.open('tasks', 'invite');
  w.updateTask('invite', { owner: 'teo', status: 'Not Started' });
  const finish = () =>
    w.updateTask('invite', {
      description:
        'From the launch check-in at 0:48: verify the invite flow before Thursday’s launch. Confirm the handoff before Julia finishes the announcement.',
      owner: 'teo',
      priority: 'High',
      status: 'Not Started',
    });
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 3,
    reset: () => {},
    reduced: finish,
    advance: (s) => {
      if (s === 2) finish();
    },
  });
  return (
    <div ref={root} onPointerDown={playback.pause} onKeyDown={playback.pause}>
      <div class="product-demo-request">
        <HomepageConversation
          messages={[
            {
              person: 'jacob',
              text: '@Claude, use the launch check-in to update Teo’s invite task with the agreement and the next step.',
            },
          ]}
        />
      </div>
      <ProductDemo
        label="Use the call agreement in a task"
        onInteract={playback.pause}
      >
        <ProductWorkspace workspace={w} />
      </ProductDemo>
    </div>
  );
}

export function CallSharingDemo() {
  return (
    <ProductDemo label="Give a teammate access to the call context">
      <ProductCallRecord />
    </ProductDemo>
  );
}
