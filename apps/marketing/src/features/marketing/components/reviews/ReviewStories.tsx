import ArrowLeft from '@phosphor/arrow-left.svg';
import CaretDown from '@phosphor/caret-down.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { DemoAgentMessage } from '../../core/deploy-agent-demo';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { AgentMessage } from '../DemoAgentMessage';
import DemoDeployDiff from '../DemoDeployDiff';
import { DemoMarkdown } from '../DemoMarkdown';
import { ViewShell } from '../DemoWorkspaceChrome';
import { SearchBar } from '../email/frozen/SearchBar';
import { ProductDemo } from '../product/ProductPage';
import { MessageRow } from '../workspace/frozen/MessageRow';
import { TaskNotebook } from '../workspace/frozen/TaskNotebook';
import { PersonIcon } from '../workspace/frozen/TaskProperties';
import '../workspace/dummy-workspace.css';

const title = 'Retry transient deploy failures';
const description =
  '## Summary\n\nRetry temporary registry failures with a bounded delay. Permanent failures still stop immediately.\n\n## Review focus\n\nCheck the attempt limit and the permanent-error path in `deploy/retry.ts`. The linked task contains the original deployment report.';

/** PR metadata and read-only GitHub discussion, ported from block-pr. */
function PullRequest(props: {
  onBack?: () => void;
  discussion?: boolean;
  name?: string;
  number?: number;
}) {
  const [expanded, setExpanded] = createSignal(true);
  const [hideBots, setHideBots] = createSignal(false);
  return (
    <>
      <ViewShell.TopBar>
        <Show when={props.onBack}>
          <Button
            variant="plain"
            size="icon-sm"
            label="Back to reviews"
            onClick={props.onBack}
          >
            <ArrowLeft />
          </Button>
        </Show>
        <GitPullRequest class="size-4 text-success" />
        <span class="truncate text-sm font-medium">{props.name ?? title}</span>
      </ViewShell.TopBar>
      <div class="dummy-scroll product-pr-body">
        <h1>{props.name ?? title}</h1>
        <div class="product-pr-meta">
          <span class="text-success">
            <GitPullRequest class="size-3" />
            Open
          </span>
          <span>
            <PersonIcon person={props.number === 483 ? 'julia' : 'teo'} />
            {props.number === 483 ? 'Julia' : 'Teo'}
          </span>
          <span>launch-team/website#{props.number ?? 482}</span>
          <span>
            <b class="text-success">+{props.number === 483 ? 4 : 8}</b>
            <b class="text-failure">−{props.number === 483 ? 2 : 1}</b>
          </span>
        </div>
        <DemoMarkdown
          markdown={
            props.number === 483
              ? '## Summary\n\nUpdate the announcement with Thursday’s launch time and a link to the team workspace.\n\n## Review focus\n\nConfirm the wording with Julia before publishing.'
              : description
          }
        />
        <Show when={props.discussion}>
          <div class="product-pr-discussion-heading">
            <button
              type="button"
              aria-expanded={expanded()}
              onClick={() => setExpanded(!expanded())}
            >
              <CaretDown class="size-3" />
              Discussion
            </button>
            <label>
              <input
                type="checkbox"
                checked={hideBots()}
                onChange={(e) => setHideBots(e.currentTarget.checked)}
              />
              Hide bots (1)
            </label>
          </div>
          <Show when={expanded()}>
            <div class="product-pr-discussion">
              <MessageRow
                message={{
                  id: 'review-1',
                  person: 'julia',
                  time: '10:14 AM',
                  body: 'Can we confirm that authentication failures still stop on the first attempt?',
                }}
              >
                <span class="product-pr-file">deploy/retry.ts · L6</span>
              </MessageRow>
              <MessageRow
                message={{
                  id: 'review-reply',
                  person: 'teo',
                  time: '10:18 AM',
                  replyTo: 'review-1',
                  body: 'Yes. Only temporary registry failures take the retry path; the permanent-error branch still throws.',
                }}
              />
              <Show when={!hideBots()}>
                <MessageRow
                  message={{
                    id: 'bot',
                    person: 'cursor',
                    time: '10:20 AM',
                    body: 'Preview available for this branch.',
                  }}
                />
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </>
  );
}

export function ReviewQueueDemo(props: { animate?: boolean }) {
  let root!: HTMLDivElement;
  const [opened, setOpened] = createSignal<number>();
  const [query, setQuery] = createSignal('');
  const [filter, setFilter] = createSignal('involving');
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 3,
    reset: () => {},
    reduced: () => {
      if (props.animate) setOpened(482);
    },
    advance: (s) => {
      if (props.animate && s === 2) setOpened(482);
    },
  });
  const rows = [
    { name: title, author: 'teo' as const, number: 482, involving: true },
    {
      name: 'Update the launch announcement',
      author: 'julia' as const,
      number: 483,
      involving: false,
    },
  ];
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="Find and open a pull request in Reviews"
      onInteract={playback.pause}
    >
      <Show
        when={opened()}
        fallback={
          <>
            <ViewShell.TopBar>
              <span class="text-sm font-medium">Reviews</span>
            </ViewShell.TopBar>
            <nav class="product-task-filters" aria-label="Review views">
              <button
                type="button"
                aria-pressed={filter() === 'involving'}
                onClick={() => setFilter('involving')}
              >
                Involving me
              </button>
              <button
                type="button"
                aria-pressed={filter() === 'all'}
                onClick={() => setFilter('all')}
              >
                All reviews
              </button>
            </nav>
            <div class="product-review-queue">
              <SearchBar
                label="Search sample reviews"
                placeholder="Search reviews"
                value={query()}
                onValueChange={setQuery}
              />
              <For
                each={rows.filter(
                  (r) =>
                    (filter() === 'all' || r.involving) &&
                    r.name.toLowerCase().includes(query().toLowerCase())
                )}
              >
                {(r) => (
                  <button
                    class="product-review-row"
                    type="button"
                    onClick={() => setOpened(r.number)}
                    aria-label={`Open review: ${r.name}`}
                  >
                    <GitPullRequest class="size-4 text-success" />
                    <span>
                      {r.name}
                      <small>launch-team/website · #{r.number}</small>
                    </span>
                    <span>
                      <PersonIcon person={r.author} />
                      {r.author === 'teo' ? 'Teo' : 'Julia'}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </>
        }
      >
        <PullRequest
          name={rows.find((r) => r.number === opened())?.name}
          number={opened()}
          onBack={() => setOpened(undefined)}
        />
      </Show>
    </ProductDemo>
  );
}

export function ReviewDiffDemo() {
  return (
    <ProductDemo label="Inspect an agent’s proposed code change">
      <ViewShell.TopBar>
        <span class="text-sm font-medium">Changes · deploy/retry.ts</span>
        <span class="ml-auto text-xs">
          <span class="text-success">+8</span>{' '}
          <span class="text-failure">−1</span>
        </span>
      </ViewShell.TopBar>
      <div class="dummy-scroll product-pr-body">
        <DemoDeployDiff />
      </div>
    </ProductDemo>
  );
}

export function ReviewDiscussionDemo() {
  return (
    <ProductDemo label="Read the GitHub review discussion and filter bot messages">
      <PullRequest discussion />
    </ProductDemo>
  );
}

export function ReviewAgentDemo() {
  let root!: HTMLDivElement;
  const [finished, setFinished] = createSignal(false);
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 3,
    reset: () => {},
    reduced: () => setFinished(true),
    advance: (s) => {
      if (s === 2) setFinished(true);
    },
  });
  const message = (text: string, user = false): DemoAgentMessage => ({
    agentSessionId: 'review-example',
    turn: 0,
    requestId: null,
    pending: false,
    author: user ? { kind: 'user', userId: 'jacob' } : { kind: 'agent' },
    stop: { kind: 'end_turn' },
    parts: [{ kind: 'text', text }],
  });
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="Ask an agent to inspect the retry change"
      onInteract={playback.pause}
    >
      <ViewShell.TopBar>
        <span class="text-sm font-medium">Review deploy retry</span>
      </ViewShell.TopBar>
      <div class="dummy-scroll product-agent-log">
        <AgentMessage
          message={message(
            'Review this retry change. What stops a permanent failure from being retried?',
            true
          )}
          inFlight={false}
        />
        <Show when={finished()}>
          <AgentMessage
            message={message(
              'The catch branch throws when the error is not transient. Only temporary failures continue through the bounded retry loop. Inspect that branch before approving the change.'
            )}
            inFlight={false}
          />
          <div class="mt-6">
            <DemoDeployDiff />
          </div>
        </Show>
      </div>
    </ProductDemo>
  );
}

export function ReviewLinkedTaskDemo() {
  const w = createDummyWorkspace('tasks');
  w.open('tasks', 'deploy');
  w.updateTask('deploy', {
    status: 'In Review',
    owner: 'teo',
    description:
      'Temporary registry failures interrupt deployment. Review the bounded retry change in PR #482 before completing this task.',
  });
  const [opened, setOpened] = createSignal(false);
  return (
    <ProductDemo label="Open a linked pull request from its task">
      <Show
        when={opened()}
        fallback={
          <TaskNotebook
            workspace={w}
            task={w.data.tasks.find((t) => t.id === 'deploy')!}
            relatedContent={
              <button
                type="button"
                class="dummy-entity-link"
                onClick={() => setOpened(true)}
              >
                <GitPullRequest class="size-4 text-success" />
                Retry transient deploy failures · #482
              </button>
            }
          />
        }
      >
        <PullRequest onBack={() => setOpened(false)} />
      </Show>
    </ProductDemo>
  );
}
