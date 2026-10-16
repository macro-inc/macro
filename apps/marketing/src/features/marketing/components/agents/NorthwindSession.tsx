import X from '@phosphor/x.svg';
import { Button } from '@ui';
import {
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import type { WorkspaceView } from '../../core/dummy-workspace';
import {
  createDummyWorkspace,
  type DummyWorkspace,
} from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { CallRecordBody, createCallPlayback } from '../calls/CallRecord';
import { ViewShell } from '../DemoWorkspaceChrome';
import '../calls/call-stories.css';
import { ProductDemo } from '../product/ProductPage';
import { WorkspaceChannel } from '../workspace/WorkspaceChannel';
import { WorkspaceDocuments } from '../workspace/WorkspaceDocuments';
import { WorkspaceEmail } from '../workspace/WorkspaceEmail';
import { WorkspaceTasks } from '../workspace/WorkspaceTasks';
import { AgentSession } from './AgentSession';
import {
  AgentAnswer,
  type AgentMention,
  AgentPrompt,
  type AgentToolCall,
  AgentToolGroup,
  AgentTurn,
} from './AgentTranscript';
import {
  createNorthwindAccessTask,
  NORTHWIND_CALL,
  NORTHWIND_PROMPT,
  seedNorthwind,
  updateNorthwindPlan,
  updateNorthwindTraining,
} from './northwindScenario';
import '../workspace/dummy-workspace.css';

type Scene = 'complete' | 'sources' | 'actions';

/** The hero and focused scenes use this conversation and the same local, editable records. */
export function NorthwindSession(props: {
  workspace: DummyWorkspace;
  scene?: Scene;
}) {
  const w = props.workspace;
  const scene = props.scene ?? 'complete';
  seedNorthwind(w, scene === 'complete');
  let root!: HTMLDivElement;
  let returnFocus: HTMLElement | undefined;
  const [narrow, setNarrow] = createSignal(false);
  const [item, setItem] = createSignal<string>();
  const [itemView, setItemView] = createSignal<WorkspaceView>('documents');
  const [phase, setPhase] = createSignal(scene === 'complete' ? 3 : 0);
  const [turns, setTurns] = createSignal<string[]>([]);
  const finish = () => {
    if (scene === 'actions') {
      updateNorthwindPlan(w);
      updateNorthwindTraining(w);
      createNorthwindAccessTask(w);
    }
    setPhase(3);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 3,
    reset: () => {},
    reduced: finish,
    delay: () => 1300,
    advance: (step) => {
      if (scene === 'complete') return;
      if (scene === 'sources') {
        setPhase(step);
        return;
      }
      if (step === 1) updateNorthwindPlan(w);
      if (step === 2) updateNorthwindTraining(w);
      if (step === 3) finish();
      else setPhase(step);
    },
  });
  const open = (view: WorkspaceView, id: string) => {
    playback.pause();
    if (!item() && document.activeElement instanceof HTMLElement)
      returnFocus = document.activeElement;
    setItemView(view);
    setItem(id);
    queueMicrotask(() =>
      root
        .querySelector<HTMLButtonElement>('.agent-split-close')
        ?.focus({ preventScroll: true })
    );
  };
  const close = () => {
    setItem(undefined);
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  };
  onMount(() => {
    const measure = () => setNarrow(root.clientWidth < 640);
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    measure();
    onCleanup(() => observer.disconnect());
  });
  const linkedWorkspace = {
    ...w,
    selected: item,
    contentView: itemView,
    view: itemView,
    open: (view: WorkspaceView, id?: string) => {
      if (id) open(view, id);
      else if (view === 'messages') open(view, w.channel());
      else close();
    },
    openItem: (view: WorkspaceView, id?: string) => {
      if (id) open(view, id);
      else if (view === 'messages') open(view, w.channel());
      else close();
    },
    backToCollection: close,
  };
  const taskMention = (id: string): AgentMention => ({
    kind: 'task',
    get task() {
      const task = w.data.tasks.find((t) => t.id === id);
      return task
        ? { status: task.status, priority: task.priority, owner: task.owner }
        : undefined;
    },
    onOpen: () => open('tasks', id),
  });
  const mentions: Record<string, AgentMention> = {
    email: { kind: 'email', onOpen: () => open('email', 'northwind-email') },
    call: { kind: 'call', onOpen: () => open('documents', 'northwind-call') },
    plan: {
      kind: 'document',
      onOpen: () => open('documents', 'northwind-plan'),
    },
    training: taskMention('northwind-training'),
    sso: taskMention('northwind-sso'),
  };
  const sourceAnswer =
    'Friday isn’t ready yet. The @[rollout plan](agent:plan) assumes 20 people and passwords; the customer now needs 40 and SSO.\n\nThe call limits Friday to 10 people, pending Teo’s SSO check. The other 30 join Monday, and the @[training task](agent:training) needs to move from Jacob to Julia.';
  const diagnosis =
    'The @[customer email](agent:email) and @[call decision](agent:call) changed the rollout to 40 people with SSO. The plan still assumed 20.';
  const completedResult =
    '- Updated the @[rollout plan](agent:plan): 10 Friday, 30 Monday.\n- Reassigned @[Training for 40 people](agent:training) to Julia, with two sessions.\n- Created urgent @[SSO verification](agent:sso) for Teo.';
  const resultAnswer = () =>
    [
      ...(phase() >= 1
        ? [
            '- Updated the @[rollout plan](agent:plan): 20 on Friday → 10 Friday, 30 Monday, with SSO required.',
          ]
        : []),
      ...(phase() >= 2
        ? [
            '- Reassigned @[Training for 40 people](agent:training): Jacob → Julia, with two sessions instead of one.',
          ]
        : []),
      ...(phase() >= 3
        ? [
            '- Created @[SSO verification](agent:sso) for Teo, marked urgent before invitations go out.',
          ]
        : []),
    ].join('\n');
  const sourceSearch = (): AgentToolCall => ({
    kind: 'search',
    query: 'Northwind',
    hits: [
      {
        kind: 'email',
        title: 'Northwind rollout requirements',
        sender: 'Marcus',
        snippet: '40 seats. SSO required before anyone joins.',
        time: 'Wed',
        onOpen: () => open('email', 'northwind-email'),
      },
      ...(phase() >= 1
        ? [
            {
              kind: 'call' as const,
              title: NORTHWIND_CALL.title,
              snippet:
                '10 Friday, 30 Monday. Teo checks SSO; Julia takes training.',
              time: 'Thu',
              onOpen: () => open('documents', 'northwind-call'),
            },
          ]
        : []),
      ...(phase() >= 2
        ? [
            {
              kind: 'document' as const,
              title: 'Northwind rollout plan',
              snippet: 'All 20 staff on Friday. Password sign-in.',
              time: 'Mon',
              onOpen: () => open('documents', 'northwind-plan'),
            },
            {
              kind: 'task' as const,
              title: 'Prepare Northwind training for 20 people',
              sender: 'Jacob',
              snippet: 'One session for 20 people on Friday.',
              time: 'Mon',
              onOpen: () => open('tasks', 'northwind-training'),
            },
          ]
        : []),
    ],
  });
  const sourceReads: AgentToolCall[] = [
    { kind: 'read-thread' },
    { kind: 'read-call' },
    { kind: 'read-document', title: 'Northwind rollout plan' },
    { kind: 'read-document', title: 'Northwind training task' },
  ];
  const [searchOpen, setSearchOpen] = createSignal(true);
  const callPlayback = createCallPlayback(NORTHWIND_CALL.duration);
  return (
    <div
      ref={root}
      class="agent-split"
      data-narrow={narrow()}
      data-item-open={item() ? 'true' : undefined}
      onPointerDown={playback.pause}
      onKeyDown={playback.pause}
    >
      <div class="agent-split-pane" inert={!!item() && narrow()}>
        <AgentSession
          title="Northwind rollout"
          onSend={(text) => setTurns((all) => [...all, text])}
        >
          <AgentTurn>
            <AgentPrompt
              text={
                scene === 'sources'
                  ? 'Are we ready for Northwind’s Friday rollout?'
                  : scene === 'actions'
                    ? 'Update the rollout plan and assign the missing work.'
                    : NORTHWIND_PROMPT
              }
            />
          </AgentTurn>
          <AgentTurn>
            <Show when={scene === 'sources'}>
              <AgentToolGroup
                calls={[sourceSearch()]}
                active={phase() < 2}
                defaultOpen
                searchOpen={searchOpen()}
                onSearchOpenChange={setSearchOpen}
              />
              <Show when={phase() === 3}>
                <AgentToolGroup calls={sourceReads} />
                <AgentAnswer text={sourceAnswer} mentions={mentions} />
              </Show>
              <Show when={phase() < 3}>
                <span class="magic-chip-shimmer text-sm">
                  {phase() < 2
                    ? 'Finding the customer requirements and rollout decision…'
                    : 'Comparing the decision with the existing plan and task…'}
                </span>
              </Show>
            </Show>
            <Show when={scene === 'complete'}>
              <AgentToolGroup calls={[sourceSearch(), ...sourceReads]} />
              <AgentAnswer text={diagnosis} mentions={mentions} />
            </Show>
            <Show when={scene !== 'sources'}>
              <AgentToolGroup
                active={phase() < 3}
                calls={[
                  {
                    kind: 'action',
                    label:
                      phase() < 1
                        ? 'Edit Northwind rollout plan'
                        : 'Edited Northwind rollout plan',
                  },
                  ...(phase() >= 1
                    ? [
                        {
                          kind: 'action' as const,
                          label:
                            phase() < 2
                              ? 'Update training task'
                              : 'Updated training task · Julia',
                        },
                      ]
                    : []),
                  ...(phase() >= 2
                    ? [
                        {
                          kind: 'action' as const,
                          label:
                            phase() < 3
                              ? 'Create SSO verification task'
                              : 'Created SSO verification task · Teo',
                        },
                      ]
                    : []),
                ]}
              />
              <Show when={phase() > 0}>
                <AgentAnswer
                  text={scene === 'complete' ? completedResult : resultAnswer()}
                  mentions={mentions}
                />
              </Show>
              <Show when={phase() < 3}>
                <span class="magic-chip-shimmer text-sm">
                  {phase() === 0
                    ? 'Updating the plan to match the call’s decision…'
                    : phase() === 1
                      ? 'Reassigning training and adding the second session…'
                      : 'Creating the missing SSO check for Teo…'}
                </span>
              </Show>
              <Show when={phase() === 3}>
                <AgentAnswer
                  text="SSO is still open. Friday’s pilot can go ahead only after Teo confirms access."
                  mentions={mentions}
                />
              </Show>
            </Show>
          </AgentTurn>
          <For each={turns()}>
            {(text) => (
              <>
                <AgentTurn>
                  <AgentPrompt text={text} />
                </AgentTurn>
                <AgentTurn>
                  <AgentAnswer
                    text="You can open the rollout plan and assigned tasks above to explore and edit the result."
                    mentions={{}}
                  />
                </AgentTurn>
              </>
            )}
          </For>
        </AgentSession>
      </div>
      <Show when={item()}>
        <section
          class="agent-split-pane agent-split-item"
          aria-label="Opened item"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
        >
          <Switch>
            <Match when={item() === 'northwind-call'}>
              <ViewShell.TopBar>
                <span class="text-sm font-semibold">
                  Northwind rollout decision
                </span>
              </ViewShell.TopBar>
              <CallRecordBody call={NORTHWIND_CALL} playback={callPlayback} />
            </Match>
            <Match when={itemView() === 'documents'}>
              <WorkspaceDocuments workspace={linkedWorkspace} />
            </Match>
            <Match when={itemView() === 'tasks'}>
              <WorkspaceTasks workspace={linkedWorkspace} filter="all" />
            </Match>
            <Match when={itemView() === 'messages'}>
              <WorkspaceChannel workspace={linkedWorkspace} />
            </Match>
            <Match when={itemView() === 'email'}>
              <WorkspaceEmail
                workspace={linkedWorkspace}
                tab="all"
                account="all"
              />
            </Match>
          </Switch>
          <Button
            variant="plain"
            size="icon-sm"
            class="agent-split-close"
            label="Close opened item"
            onClick={close}
          >
            <X class="size-4" />
          </Button>
        </section>
      </Show>
    </div>
  );
}
export function NorthwindStory(props: { scene: Exclude<Scene, 'complete'> }) {
  const w = createDummyWorkspace('agents');
  return (
    <ProductDemo
      label={`Northwind ${props.scene}`}
      height={600}
      mobileHeight={660}
    >
      <NorthwindSession workspace={w} scene={props.scene} />
    </ProductDemo>
  );
}
