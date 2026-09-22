import { EntityIcon } from '@core/component/EntityIcon';
import { ProgressMeter } from '@core/component/LexicalMarkdown/component/status/Progress';
import CheckCircle from '@phosphor/check-circle.svg';
import CircleHalf from '@phosphor/circle-half.svg';
import { Button, Checkbox, UserMessageBubble } from '@ui';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import {
  HomepageConversation,
  type HomepageMessage,
  HomepagePersonAvatar,
} from './HomepageConversation';
import { HomepageMention } from './HomepageMention';
import {
  HomepageTaskComposer,
  type HomepageTaskComposerHandle,
} from './HomepageTaskComposer';
import './homepage-task-conversation.css';

const PROMPT =
  'Fix the team invite handoff. Keep the invited team through sign-up.';
const CHECKLIST = [
  'Keep the team through sign-up',
  'Cover new and existing accounts',
  'Have Teo verify both invite paths',
];
const LaunchPlan = () => (
  <HomepageMention
    kind="md"
    label="Q3 launch plan"
    description="Thursday, 9 AM. Julia owns the announcement; Teo is checking invites."
    href="#documents"
  />
);
const InviteTask = () => (
  <HomepageMention
    kind="task"
    label="Fix invite flow"
    description="Assigned to Teo. Cursor is preparing the fix; Claude is checking the edge cases."
    href="#invite-task"
  />
);

/** A local task created inside the same human-and-agent conversation. */
export default function HomepageTaskConversation() {
  const [created, setCreated] = createSignal(false);
  const [composing, setComposing] = createSignal(true);
  const [checked, setChecked] = createSignal([false, false, false]);
  const [manual, setManual] = createSignal(false);
  const [reduced, setReduced] = createSignal(false);
  const [verified, setVerified] = createSignal(false);
  const [request, setRequest] = createSignal(PROMPT);
  const [replies, setReplies] = createSignal<HomepageMessage[]>([]);
  const [arrived, setArrived] = createSignal(false);
  let root!: HTMLDivElement;
  let composer: HomepageTaskComposerHandle | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let composerVisible = false;
  let observer: IntersectionObserver | undefined;
  const completed = () => checked().filter(Boolean).length;
  const stats = {
    total: CHECKLIST.length,
    get completed() {
      return completed();
    },
  };

  const stop = () => clearTimeout(timer);
  const takeControl = () => {
    stop();
    setManual(true);
  };
  const createTask = (message: string) => {
    setRequest(message);
    setCreated(true);
    composer?.reset('');
    setComposing(false);
  };
  const send = (message: string, asTask: boolean) => {
    takeControl();
    if (asTask) {
      createTask(message);
      setChecked([false, false, false]);
      setVerified(false);
      queueMicrotask(() =>
        root
          .querySelector<HTMLButtonElement>('.homepage-task-edit-request')
          ?.focus({ preventScroll: true })
      );
    } else
      setReplies((previous) => [...previous, { person: 'teo', text: message }]);
  };
  const play = () => {
    stop();
    if (
      composerVisible &&
      !document.hidden &&
      !manual() &&
      !created() &&
      !reduced()
    )
      timer = setTimeout(() => createTask(PROMPT), 2400);
  };
  const verify = () => {
    takeControl();
    if (!created()) createTask(PROMPT);
    setChecked([true, true, true]);
    setVerified(true);
  };

  onMount(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const beats = root.querySelectorAll<HTMLElement>('[data-task-beat]');
    const syncMotion = () => {
      setReduced(media.matches);
      if (media.matches) {
        beats.forEach((beat) => {
          beat.dataset.reveal = 'visible';
        });
        if (!manual()) {
          createTask(PROMPT);
          setChecked([true, true, false]);
        }
      }
      play();
    };
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          if (element.dataset.taskBeat === 'composer') {
            composerVisible = entry.isIntersecting;
            play();
          }
          if (!entry.isIntersecting) continue;
          element.dataset.reveal = 'visible';
          if (element.dataset.taskBeat === 'review' && !manual()) {
            if (!created()) createTask(PROMPT);
            setChecked([true, true, false]);
          }
        }
      },
      { threshold: 0.15 }
    );
    for (const beat of beats) {
      beat.dataset.reveal = 'waiting';
      observer.observe(beat);
    }
    syncMotion();
    document.addEventListener('visibilitychange', play);
    media.addEventListener('change', syncMotion);
    const showFocused = (event: FocusEvent) => {
      if (event.target instanceof Element) {
        const beat = event.target.closest<HTMLElement>('[data-task-beat]');
        if (beat) beat.dataset.reveal = 'visible';
      }
    };
    root.addEventListener('focusin', showFocused);
    onCleanup(() => {
      stop();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', play);
      media.removeEventListener('change', syncMotion);
      root.removeEventListener('focusin', showFocused);
    });
  });

  return (
    <div
      ref={root}
      class="workspace-demo homepage-task-thread"
      data-theme="dark"
    >
      <HomepageConversation
        messages={[
          {
            person: 'julia',
            text: (
              <>
                I tried the invite in <LaunchPlan />. New teammates land in an
                empty workspace.
              </>
            ),
          },
          {
            person: 'teo',
            text: (
              <>
                <span class="homepage-person-mention">@Cursor</span> can you
                trace the redirect?{' '}
                <span class="homepage-person-mention">@Claude</span> check the
                edge cases. I’ll review the fix.
              </>
            ),
          },
        ]}
      />
      <div class="homepage-task-compose-beat" data-task-beat="composer">
        <span class="homepage-task-compose-avatar">
          <HomepagePersonAvatar person="teo" />
        </span>
        <div class="homepage-task-compose-body" data-composing={composing()}>
          <div class="homepage-task-compose-byline">
            <span>
              Teo{' '}
              <span class="text-ink-placeholder">
                · {composing() ? 'Creating a task' : 'Sent as task'}
              </span>
            </span>
            <Show when={!created() && !manual() && !reduced()}>
              <Button
                size="sm"
                variant="ghost"
                class="text-xs text-ink-muted"
                onClick={takeControl}
                aria-label="Pause task creation"
              >
                Pause
              </Button>
            </Show>
          </div>
          <div hidden={!composing()}>
            <HomepageTaskComposer
              initialDraft={PROMPT}
              onSend={send}
              onInteract={takeControl}
              created={created()}
              onReady={(handle) => {
                composer = handle;
                if (created()) handle.reset('');
              }}
            />
          </div>
          <Show when={!composing()}>
            <div class="homepage-task-sent">
              <span class="homepage-task-sent-avatar">
                <HomepagePersonAvatar person="teo" />
              </span>
              <UserMessageBubble class="glass">
                <p class="m-0">{request()}</p>
              </UserMessageBubble>
            </div>
            <Button
              size="sm"
              variant="ghost"
              class="homepage-task-edit-request text-xs text-ink-muted"
              onClick={() => {
                takeControl();
                composer?.reset(request());
                setComposing(true);
                queueMicrotask(() =>
                  root
                    .querySelector<HTMLElement>('[data-markdown-editable]')
                    ?.focus({ preventScroll: true })
                );
              }}
            >
              Edit task request
            </Button>
          </Show>
        </div>
      </div>
      <div class="homepage-task-result" data-task-beat="task" id="invite-task">
        <article
          class="homepage-task-card"
          aria-label="Fix the team invite handoff"
          style={{ '--color-accent': 'var(--color-task)' }}
        >
          <div class="homepage-task-card-title">
            <h3 class="m-0 flex items-center gap-2 text-base font-medium">
              <EntityIcon targetType="task" size="sm" /> Fix the team invite
              handoff
            </h3>
            <ProgressMeter stats={stats} class="w-22 shrink-0 text-xs" />
          </div>
          <div class="homepage-task-properties">
            <span>
              <Show
                when={completed() === 3}
                fallback={<CircleHalf class="size-3.5 text-warning" />}
              >
                <CheckCircle class="size-3.5 text-task" />
              </Show>
              {completed() === 3
                ? 'Completed'
                : created()
                  ? 'In progress'
                  : 'Draft'}
            </span>
            <span>
              <HomepagePersonAvatar person="teo" /> Teo
            </span>
            <span>Due Thursday</span>
          </div>
          <p class="my-5 text-sm leading-6 text-ink-muted">{request()}</p>
          <div class="flex flex-col gap-3.5">
            <For each={CHECKLIST}>
              {(item, index) => (
                <Checkbox
                  checked={checked()[index()]}
                  onChange={(value) => {
                    takeControl();
                    if (!created()) createTask(PROMPT);
                    setChecked((previous) =>
                      previous.map((old, i) => (i === index() ? value : old))
                    );
                    setVerified(checked().every(Boolean));
                  }}
                >
                  <Checkbox.Control />
                  <Checkbox.Label
                    class="text-sm"
                    classList={{
                      'line-through text-ink-muted': checked()[index()],
                    }}
                  >
                    {item}
                  </Checkbox.Label>
                </Checkbox>
              )}
            </For>
          </div>
          <div class="homepage-task-context">
            <LaunchPlan />
            <span>·</span>
            <span>{created() ? 'Created in #launch' : 'Draft in #launch'}</span>
          </div>
        </article>
      </div>
      <div class="homepage-task-exchange" data-task-beat="investigate">
        <HomepageConversation
          messages={[
            {
              person: 'cursor',
              text: (
                <>
                  Found it. The invite has the team ID, but the sign-up redirect
                  drops it. I’m carrying it through in <InviteTask />.
                </>
              ),
            },
            {
              person: 'claude',
              text: (
                <>
                  Test a brand-new account too. Existing accounts skip the step
                  that loses the team. The plan says every invited teammate
                  should arrive in the same workspace.
                </>
              ),
            },
          ]}
        />
      </div>
      <div class="homepage-task-exchange" data-task-beat="review">
        <HomepageConversation
          messages={[
            {
              person: 'cursor',
              text: (
                <>
                  Both paths are covered now. The fix and regression tests are
                  ready, <span class="homepage-person-mention">@Teo</span>.
                </>
              ),
            },
          ]}
        />
        <details class="homepage-task-diff" onToggle={() => setArrived(true)}>
          <summary>
            <span>fix(invites): preserve the team through sign-up</span>
            <span class="text-task">
              +12 <span class="text-ink-muted">−3</span>
            </span>
          </summary>
          <div class="homepage-task-diff-body">
            <p class="m-0 mb-3 text-xs text-ink-muted">
              Cursor · Proposed changes
            </p>
            <p class="homepage-task-diff-line removed">
              − Redirect to the default workspace
            </p>
            <p class="homepage-task-diff-line added">
              + Preserve the team from the invitation
            </p>
            <p class="homepage-task-diff-line added">
              + Test sign-up and existing-account acceptance
            </p>
          </div>
        </details>
        <div class="homepage-task-review">
          <HomepagePersonAvatar person="teo" />
          <span class="text-sm text-ink-muted">
            {verified()
              ? 'Teo verified both paths.'
              : arrived()
                ? 'Ready for Teo to verify.'
                : 'Teo’s review is next.'}
          </span>
          <Button
            size="sm"
            variant="outline"
            class="rounded-full text-xs"
            onClick={verify}
            disabled={verified()}
          >
            {verified() ? 'Verified' : 'Mark verified'}
          </Button>
        </div>
      </div>
      <Show when={verified()}>
        <div class="homepage-task-resolution">
          <HomepageConversation
            messages={[
              {
                person: 'teo',
                text: (
                  <>
                    New account, existing account — both land in the right team.{' '}
                    <InviteTask /> is done.
                  </>
                ),
                reaction: { emoji: '🙌', label: 'Raised hands' },
              },
              {
                person: 'julia',
                text: (
                  <>
                    Great. I’ll send Dana <LaunchPlan />. We’re still on for
                    Thursday.
                  </>
                ),
              },
            ]}
          />
        </div>
      </Show>
      <Show when={replies().length}>
        <HomepageConversation messages={replies()} />
      </Show>
    </div>
  );
}
