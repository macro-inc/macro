import ArrowLeft from '@phosphor/arrow-left.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import { Button } from '@ui';
import { createEffect, createSignal, Show } from 'solid-js';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import {
  AgentAnswer,
  AgentPrompt,
  AgentToolGroup,
  AgentTurn,
} from '../agents/AgentTranscript';
import { createDemoPointer } from '../agents/createDemoPointer';
import { DemoAgentChip } from '../DemoAgentChip';
import { DemoCursor } from '../DemoCursor';
import { DemoMention } from '../DemoMention';
import { ViewShell } from '../DemoWorkspaceChrome';
import { DocumentShareSheet } from '../documents/DocumentShareSheet';
import { ProductDemo } from '../product/ProductPage';
import { TaskMention } from '../workspace/frozen/TaskMention';
import { TaskNotebook } from '../workspace/frozen/TaskNotebook';
import { WorkspaceChannel } from '../workspace/WorkspaceChannel';
import { createGithubWorkspace, GITHUB_TASK } from './githubProject';
import { PrMention } from './ReviewPrMention';
import { PullRequestView } from './ReviewPullRequest';
import { signInPr } from './review-fixtures';
import '../workspace/dummy-workspace.css';
import './review-stories.css';

export function GithubPrHero() {
  const [changes, setChanges] = createSignal(true);
  return (
    <ProductDemo
      label="Pull request and code changes"
      height={640}
      mobileHeight={580}
    >
      <PullRequestView
        pr={signInPr}
        changes={changes()}
        onChanges={setChanges}
      />
    </ProductDemo>
  );
}

/** The same channel and PR, with independent local state for each scene. */
export function GithubConversationDemo(props: { agent?: boolean }) {
  const w = createGithubWorkspace(props.agent);
  const task = () => w.data.tasks.find((item) => item.id === GITHUB_TASK)!;
  let root!: HTMLDivElement;
  let trigger: HTMLElement | undefined;
  const [share, setShare] = createSignal(false);
  const [detail, setDetail] = createSignal<'pr' | 'task' | 'session'>();
  const [changes, setChanges] = createSignal(false);
  const [phase, setPhase] = createSignal(0);
  const [automatic, setAutomatic] = createSignal(true);
  createEffect(() => {
    detail();
    changes();
    queueMicrotask(() => {
      const log = root?.querySelector<HTMLElement>(
        '.github-conversation [role="log"]'
      );
      if (log) log.scrollTop = log.scrollHeight;
    });
  });
  const reply = () => {
    w.updateTask(GITHUB_TASK, {
      status: 'In Review',
      steps: task().steps.map((step) => ({ ...step, done: true })),
    });
    if (
      !w.data.channels[0].messages.some((item) => item.id === 'agent-result')
    ) {
      w.setData('channels', 0, 'messages', (all) => [
        ...all,
        {
          id: 'agent-result',
          person: 'cursor' as const,
          time: '10:14 AM',
          body: '',
          replyTo: 'request',
        },
      ]);
      queueMicrotask(() => {
        const log = root.querySelector<HTMLElement>('[role="log"]');
        if (log) log.scrollTop = log.scrollHeight;
      });
    }
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: props.agent ? 2 : 5,
    reset: () => {},
    reduced: () => {
      if (props.agent) reply();
      else {
        setDetail('pr');
        setChanges(true);
      }
      setAutomatic(false);
    },
    delay: (step) =>
      props.agent
        ? ([0, 3500, 1200][step] ?? 1000)
        : ([0, 2600, 1000, 1600, 900, 1000][step] ?? 1000),
    advance: (step) => {
      setPhase(step);
      if (props.agent) {
        if (step === 1) reply();
        if (step === 2) setAutomatic(false);
      } else {
        if (step === 2) setDetail('pr');
        if (step === 4) setChanges(true);
        if (step === 5) setAutomatic(false);
      }
    },
  });
  const pause = () => {
    setAutomatic(false);
    playback.pause();
  };
  const open = (next: 'pr' | 'task' | 'session') => {
    pause();
    trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    setDetail(next);
    setChanges(false);
    queueMicrotask(() =>
      root.querySelector<HTMLButtonElement>('[data-detail-back]')?.focus()
    );
  };
  const back = () => {
    setDetail(undefined);
    setChanges(false);
    queueMicrotask(() => trigger?.isConnected && trigger.focus());
  };
  const pointer = createDemoPointer({
    frame: () => root,
    target: () =>
      automatic() && !props.agent && phase() > 0 && phase() < 5
        ? phase() < 3
          ? '[data-pr-mention]'
          : '[data-changes-toggle]'
        : undefined,
  });
  return (
    <div ref={root} class="review-flow-frame" onWheel={pause}>
      <ProductDemo
        label={
          props.agent
            ? 'A coding agent fixes the mobile sign-in task'
            : 'Open a pull request from the website channel'
        }
        height={650}
        mobileHeight={640}
        onInteract={pause}
      >
        <div
          class="github-surface"
          data-detail={detail() ?? ''}
          data-changes={changes()}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && detail()) {
              event.stopPropagation();
              back();
            }
          }}
        >
          <div class="github-conversation">
            <WorkspaceChannel
              workspace={{
                ...w,
                openItem: (view, id) => {
                  if (view === 'tasks') open('task');
                  else if (view === 'agents') open('session');
                  else w.openItem(view, id);
                },
              }}
              renderMessageBody={(message) =>
                message.id === 'pr' ? (
                  <p class="review-message-body">
                    fix is up:{' '}
                    <PrMention
                      pr={signInPr}
                      status="open"
                      onOpen={() => open('pr')}
                    />
                  </p>
                ) : message.id === 'request' ? (
                  <p class="review-message-body">
                    <DemoMention
                      item={{ id: 'cursor', kind: 'person', label: 'Cursor' }}
                    />{' '}
                    can you fix this?
                  </p>
                ) : message.id === 'task' ? (
                  <p class="review-message-body">
                    put the steps here:{' '}
                    <TaskMention
                      inline
                      task={task()}
                      onOpen={() => open('task')}
                    />
                  </p>
                ) : undefined
              }
              renderMessageDetails={(message) =>
                message.id === 'agent-result' ? (
                  <DemoAgentChip
                    agentSessionId="mobile-sign-in"
                    requester="Julia"
                    request="@Cursor can you fix this?"
                    markdown="Fix mobile sign-in · 6 tests passed"
                    headerActions={null}
                    onOpen={() => open('session')}
                    pullRequest={
                      <button
                        type="button"
                        class="github-chip-pr"
                        onClick={() => open('pr')}
                      >
                        <GitPullRequest class="size-4 shrink-0 text-success" />
                        <span class="demo-cursor-pr-title">
                          #491 · Fix mobile sign-in
                        </span>
                        <span class="demo-cursor-pr-stats">
                          <span>+14</span>
                          <span>−3</span>
                        </span>
                      </button>
                    }
                  />
                ) : undefined
              }
            />
          </div>
          <Show when={detail()}>
            <div class="github-detail">
              <div class="github-detail-back">
                <Button
                  data-detail-back
                  variant="plain"
                  size="sm"
                  onClick={back}
                >
                  <ArrowLeft />
                  Back to channel
                </Button>
              </div>
              <Show when={detail() === 'pr'}>
                <PullRequestView
                  pr={signInPr}
                  changes={changes()}
                  onChanges={setChanges}
                />
              </Show>
              <Show when={detail() === 'task'}>
                <TaskNotebook
                  workspace={{
                    ...w,
                    openItem: (view, id) => {
                      if (view === 'messages') back();
                      else w.openItem(view, id);
                    },
                  }}
                  onShare={() => setShare(true)}
                  task={task()}
                  hideCollectionNavigation
                  pills={
                    <PrMention
                      pr={signInPr}
                      status="open"
                      onOpen={() => open('pr')}
                    />
                  }
                  sourceContent={
                    <button type="button" onClick={back}>
                      From #website
                    </button>
                  }
                />
              </Show>
              <Show when={detail() === 'session'}>
                <ViewShell.TopBar>
                  <span class="text-sm font-medium">
                    Cursor · Fix mobile sign-in
                  </span>
                  <Button
                    variant="plain"
                    size="sm"
                    onClick={() => {
                      setDetail('pr');
                      setChanges(true);
                    }}
                  >
                    Changes
                  </Button>
                </ViewShell.TopBar>
                <div class="dummy-scroll agent-transcript github-session">
                  <AgentTurn>
                    <AgentPrompt text="Fix mobile sign-in. Repro steps are in WEB-42." />
                  </AgentTurn>
                  <AgentTurn>
                    <AgentToolGroup
                      calls={[
                        { kind: 'read-channel', channel: 'website', count: 7 },
                        { kind: 'read-document', title: 'Fix mobile sign-in' },
                        {
                          kind: 'action',
                          label: 'Read SignIn.tsx and SignIn.test.tsx',
                        },
                        {
                          kind: 'action',
                          label: 'Use the form submit handler for both buttons',
                        },
                        {
                          kind: 'action',
                          label: 'Run sign-in tests: 6 passed',
                        },
                        { kind: 'action', label: 'Open pull request #491' },
                      ]}
                    />
                    <AgentAnswer
                      text="The mobile button had no submit action. Both buttons now submit the form. Mobile, desktop, Enter key, and error checks pass."
                      mentions={{}}
                    />
                    <PrMention
                      pr={signInPr}
                      status="open"
                      onOpen={() => setDetail('pr')}
                    />
                  </AgentTurn>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </ProductDemo>
      <DocumentShareSheet
        open={share()}
        title={task().title}
        autoFocus
        onClose={() => setShare(false)}
      />
      <Show when={pointer()}>
        {(point) => (
          <DemoCursor
            label="Julia"
            class="review-flow-pointer"
            clicking={phase() === 2 || phase() === 4}
            style={{ transform: `translate(${point().x}px, ${point().y}px)` }}
          />
        )}
      </Show>
    </div>
  );
}

export function GithubTaskDemo() {
  const w = createGithubWorkspace();
  const task = () => w.data.tasks.find((item) => item.id === GITHUB_TASK)!;
  w.updateTask(GITHUB_TASK, { status: 'In Progress' });
  let root!: HTMLDivElement;
  const [linked, setLinked] = createSignal(false);
  const [merged, setMerged] = createSignal(false);
  const [prOpen, setPrOpen] = createSignal(false);
  const [confirm, setConfirm] = createSignal(false);
  const [phase, setPhase] = createSignal(0);
  const [automatic, setAutomatic] = createSignal(true);
  const [share, setShare] = createSignal(false);
  const [source, setSource] = createSignal(false);
  const link = () => {
    setLinked(true);
    w.updateTask(GITHUB_TASK, { status: 'In Review' });
  };
  const merge = () => {
    setMerged(true);
    setConfirm(false);
    w.updateTask(GITHUB_TASK, { status: 'Completed' });
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 8,
    reset: () => {},
    reduced: () => {
      link();
      merge();
      setAutomatic(false);
    },
    delay: (step) =>
      [0, 1800, 1300, 1000, 2000, 900, 1200, 1200, 1300][step] ?? 1000,
    advance: (step) => {
      setPhase(step);
      if (step === 1) link();
      if (step === 3) setPrOpen(true);
      if (step === 5) setConfirm(true);
      if (step === 7) merge();
      if (step === 8) {
        setPrOpen(false);
        setAutomatic(false);
      }
    },
  });
  const pause = () => {
    setAutomatic(false);
    playback.pause();
  };
  const pointer = createDemoPointer({
    frame: () => root,
    target: () =>
      !automatic()
        ? undefined
        : phase() >= 6 && phase() < 8
          ? '[data-confirm-merge]'
          : phase() >= 4 && phase() < 6
            ? '[data-merge]'
            : phase() >= 2 && phase() < 4
              ? '[data-pr-mention]'
              : undefined,
  });
  return (
    <div ref={root} class="review-flow-frame" onWheel={pause}>
      <ProductDemo
        label="A linked pull request updates its task"
        height={650}
        mobileHeight={700}
        onInteract={pause}
      >
        <div
          class="github-task-scene"
          data-pr-open={prOpen()}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !confirm()) {
              setPrOpen(false);
              setSource(false);
            }
          }}
        >
          <div class="github-task-document">
            <Show
              when={!source()}
              fallback={
                <>
                  <Button
                    variant="plain"
                    size="sm"
                    onClick={() => setSource(false)}
                  >
                    <ArrowLeft />
                    Back to task
                  </Button>
                  <WorkspaceChannel workspace={w} />
                </>
              }
            >
              <TaskNotebook
                workspace={{
                  ...w,
                  openItem: (view, id) => {
                    if (view === 'messages') setSource(true);
                    else w.openItem(view, id);
                  },
                }}
                onShare={() => setShare(true)}
                task={task()}
                hideCollectionNavigation
                pills={
                  <Show when={linked()}>
                    <PrMention
                      pr={signInPr}
                      status={merged() ? 'merged' : 'open'}
                      onOpen={() => {
                        pause();
                        setPrOpen(true);
                      }}
                    />
                  </Show>
                }
                sourceContent={
                  <button
                    type="button"
                    class="text-sm text-ink-muted"
                    onClick={() => setSource(true)}
                  >
                    From #website
                  </button>
                }
              />
            </Show>
          </div>
          <Show when={prOpen()}>
            <div class="github-task-pr">
              <PullRequestView
                pr={signInPr}
                status={merged() ? 'merged' : 'open'}
                onMerge={merge}
                mergeRequested={confirm()}
                onMergeRequest={setConfirm}
                crumb={{ label: 'Task', onClick: () => setPrOpen(false) }}
              />
            </div>
          </Show>
        </div>
      </ProductDemo>
      <DocumentShareSheet
        open={share()}
        title={task().title}
        autoFocus
        onClose={() => setShare(false)}
      />
      <Show when={pointer()}>
        {(point) => (
          <DemoCursor
            label="Julia"
            class="review-flow-pointer"
            clicking={[3, 5, 7].includes(phase())}
            style={{ transform: `translate(${point().x}px, ${point().y}px)` }}
          />
        )}
      </Show>
    </div>
  );
}
