import FileText from '@phosphor/file-text.svg';
import ListChecks from '@phosphor/list-checks.svg';
import Plus from '@phosphor/plus.svg';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type { DemoAgentMessage } from '../../core/deploy-agent-demo';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { AgentMessage } from '../DemoAgentMessage';
import { ViewShell } from '../DemoWorkspaceChrome';
import { DocumentAgentDemo } from '../documents/DocumentStories';
import { InputActionButton } from '../email/frozen/ActionButton';
import { ChannelComposer } from '../email/frozen/ChannelComposer';
import { HomepageConversation } from '../HomepageConversation';
import HomepageEmailCompose from '../HomepageEmailCompose';
import { ProductDemo } from '../product/ProductPage';
import { ProductWorkspace } from '../product/ProductWorkspace';
import { ModelCatalogPicker } from '../workspace/frozen/model-picker/ModelCatalogPicker';
import { WorkspaceEmail } from '../workspace/WorkspaceEmail';
import '../workspace/dummy-workspace.css';

function message(text: string, user = false): DemoAgentMessage {
  return {
    agentSessionId: 'product-agent-example',
    turn: 0,
    requestId: null,
    pending: false,
    author: user ? { kind: 'user', userId: 'demo-jacob' } : { kind: 'agent' },
    stop: { kind: 'end_turn' },
    parts: [{ kind: 'text', text }],
  };
}

/** Frozen agent conversation, composer, and model picker; no tools or network. */
function AgentSession(props: {
  question: string;
  answer: string;
  result?: JSX.Element;
  onAnswer?: () => void;
  onContext?: () => void;
}) {
  let root!: HTMLDivElement;
  const contextWorkspace = createDummyWorkspace('documents');
  contextWorkspace.open('documents', 'plan');
  const [contextOpen, setContextOpen] = createSignal(false);
  const [stage, setStage] = createSignal(1);
  const [model, setModel] = createSignal('auto');
  const [followups, setFollowups] = createSignal<
    { question: string; answer: string }[]
  >([]);
  const finish = () => {
    props.onAnswer?.();
    setStage(2);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 3,
    reset: () => {},
    reduced: finish,
    advance: (step) => {
      if (step === 1) setStage(1);
      if (step === 2) finish();
    },
  });
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="A specific request in the agent conversation"
      onInteract={playback.pause}
    >
      <Show
        when={contextOpen()}
        fallback={
          <>
            <ViewShell.TopBar>
              <span class="text-sm font-medium">Launch preparation</span>
              <span class="ml-auto text-xs text-ink-extra-muted">
                Sample workspace
              </span>
            </ViewShell.TopBar>
            <div class="dummy-scroll product-agent-log">
              <Show when={stage() > 0}>
                <AgentMessage
                  message={message(props.question, true)}
                  inFlight={false}
                />
              </Show>
              <Show when={stage() === 2}>
                <AgentMessage
                  message={message(props.answer)}
                  inFlight={false}
                />
                {props.result}
              </Show>
              <For each={followups()}>
                {(item) => (
                  <div class="mt-8">
                    <AgentMessage
                      message={message(item.question, true)}
                      inFlight={false}
                    />
                    <AgentMessage
                      message={message(item.answer)}
                      inFlight={false}
                    />
                  </div>
                )}
              </For>
            </div>
            <div class="dummy-composer sample-chat-composer">
              <ChannelComposer
                agent
                label="Ask sample agent"
                placeholder="Ask about the launch…"
                leadingAction={
                  <InputActionButton
                    label="Open the launch plan"
                    onClick={() => {
                      playback.pause();
                      if (props.onContext) props.onContext();
                      else setContextOpen(true);
                    }}
                  >
                    <Plus />
                  </InputActionButton>
                }
                accessory={
                  <ModelCatalogPicker
                    value={model()}
                    options={[
                      { id: 'auto', label: 'Auto' },
                      { id: 'claude-opus-5', label: 'Opus 5' },
                      { id: 'gpt-5', label: 'GPT-5' },
                    ]}
                    onSelect={setModel}
                    ariaLabel="Choose sample model"
                    placement="top-end"
                  />
                }
                onSend={(question) => {
                  playback.pause();
                  finish();
                  setFollowups((items) => [
                    ...items,
                    {
                      question,
                      answer:
                        'In this local example, Teo owns the invite check, Julia owns the announcement, and Jacob owns the final launch checklist. Open the linked work to make changes.',
                    },
                  ]);
                }}
              />
            </div>
          </>
        }
      >
        <button
          type="button"
          class="px-4 py-2 text-xs text-ink-muted text-left"
          onClick={() => setContextOpen(false)}
        >
          Back to agent conversation
        </button>
        <ProductWorkspace workspace={contextWorkspace} />
      </Show>
    </ProductDemo>
  );
}

export function AgentRequestDemo() {
  return (
    <AgentSession
      question="Which launch tasks still need attention, and who owns each one?"
      answer="Teo is checking the invite handoff. Julia is reviewing the announcement. Jacob’s launch checklist has not started. Check those three items before publishing on Thursday."
    />
  );
}

export function AgentContextDemo() {
  const w = createDummyWorkspace('agents');
  w.setData(
    'documents',
    (d) => d.id === 'plan',
    'body',
    '## Thursday’s launch\n\n- Teo: verify the invite flow.\n- Julia: review the announcement.\n- Jacob: confirm the final checklist.'
  );
  const [opened, setOpened] = createSignal(false);
  return (
    <Show
      when={opened()}
      fallback={
        <AgentSession
          question="Read the Q3 launch plan. What needs to happen before Thursday?"
          answer="The plan calls for three checks: Teo verifies the invite flow, Julia reviews the announcement, and Jacob confirms the final checklist. The announcement is the shared draft; keep changes there."
          result={
            <button
              class="dummy-entity-link mt-6"
              type="button"
              onClick={() => {
                w.open('documents', 'plan');
                setOpened(true);
              }}
            >
              <FileText class="size-4 text-document" />
              Q3 launch plan
            </button>
          }
        />
      }
    >
      <ProductDemo label="Read the document used by the agent">
        <ProductWorkspace workspace={w} />
      </ProductDemo>
    </Show>
  );
}

export { DocumentAgentDemo as AgentArtifactDemo };

export function AgentEmailReviewDemo() {
  const [sent, setSent] = createSignal(false);
  const w = createDummyWorkspace('email');
  return (
    <>
      <div class="product-demo-request">
        <HomepageConversation
          messages={[
            {
              person: 'jacob',
              text: '@Claude, draft a follow-up to Dana. Confirm Thursday at 9 and let her know Julia will help with the rollout.',
            },
          ]}
        />
      </div>
      <ProductDemo label="Review and edit an agent’s email draft before sending">
        <ViewShell.TopBar>
          <span class="text-sm font-medium">
            {sent() ? 'Sent to Dana · sample' : 'Draft: Thursday’s rollout'}
          </span>
        </ViewShell.TopBar>
        <div class="dummy-scroll product-email-review">
          <Show
            when={!sent()}
            fallback={<WorkspaceEmail workspace={w} tab="sent" account="all" />}
          >
            <HomepageEmailCompose
              appChrome
              draft={{
                subject: 'Thursday’s rollout',
                to: 'Dana Whitfield <dana@northwind.example>',
                body: 'Hi Dana,\n\nThursday at 9 works for our follow-up. Julia will join us to help your team get started with the rollout.\n\nSee you then,\nJacob',
              }}
              onSend={(draft) => {
                w.sendEmail(draft.subject, draft.body, draft.to);
                w.open('email', w.data.emails[0].id);
                setSent(true);
              }}
            />
          </Show>
        </div>
      </ProductDemo>
    </>
  );
}

export function AgentTaskResultDemo() {
  const w = createDummyWorkspace('agents');
  const [taskId, setTaskId] = createSignal('');
  const [opened, setOpened] = createSignal(false);
  const create = () => {
    if (taskId()) return;
    const task = w.createTask(
      'Review Thursday’s launch checks',
      'Confirm the invite flow, announcement, and final checklist before publishing.'
    );
    setTaskId(task);
    w.open('agents', 'launch-status');
  };
  return (
    <Show
      when={opened()}
      fallback={
        <AgentSession
          question="Create a task to review Thursday’s launch checks. Include the invite flow, announcement, and final checklist."
          answer="I created Review Thursday’s launch checks. Open it to assign an owner, set the priority, and add your final checks."
          onAnswer={create}
          result={
            <button
              class="dummy-entity-link mt-6"
              type="button"
              onClick={() => {
                w.open('tasks', taskId());
                setOpened(true);
              }}
            >
              <ListChecks class="size-4 text-task" />
              Review Thursday’s launch checks
            </button>
          }
        />
      }
    >
      <ProductDemo label="Continue with the task in its ordinary task view">
        <ProductWorkspace workspace={w} />
      </ProductDemo>
    </Show>
  );
}
