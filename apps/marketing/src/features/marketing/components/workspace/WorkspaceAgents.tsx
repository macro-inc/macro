import ChatGptIcon from '@icon/openai.svg';
import ClaudeIcon from '@icon/wide-claude.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import GitPull from '@phosphor/git-pull-request.svg';
import Plus from '@phosphor/plus.svg';
import Terminal from '@phosphor/terminal-window.svg';
import { Button } from '@ui';
import { createEffect, createSignal, For, on, Show } from 'solid-js';
import { DEPLOY_PROMPT, DEPLOY_TRACE } from '../../core/deploy-agent-demo';
import { sampleAgentSessions } from '../../core/workspace-parity-fixtures';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { AgentAnswer, AgentPrompt, AgentTurn } from '../agents/AgentTranscript';
import { AGENT_MODELS, AGENT_PLACEHOLDER } from '../agents/agentDemoData';
import { LaunchConversation } from '../agents/LaunchConversation';
import { AgentMessage } from '../DemoAgentMessage';
import { ViewShell } from '../DemoWorkspaceChrome';
import { InputActionButton } from '../email/frozen/ActionButton';
import { ChannelComposer } from '../email/frozen/ChannelComposer';
import { ModelCatalogPicker } from './frozen/model-picker/ModelCatalogPicker';

export function WorkspaceAgents(props: {
  workspace: DummyWorkspace;
  home?: boolean;
}) {
  const w = props.workspace;
  const [model, setModel] = createSignal(AGENT_MODELS[0].id);
  let log: HTMLDivElement | undefined;
  // A new reply lands below the cited answer; keep it in view.
  createEffect(
    on(
      () => [w.agentReplies().length, w.busy()],
      () => {
        if (log) log.scrollTop = log.scrollHeight;
      },
      { defer: true }
    )
  );
  const session = () =>
    sampleAgentSessions.find((item) => item.id === w.selected());
  const conversation = () => !props.home && !!session();
  const pullRequest = () => {
    const current = session();
    return current && 'pr' in current ? current.pr : undefined;
  };
  const message = (text: string, user = false) => ({
    ...DEPLOY_TRACE,
    author: user
      ? { kind: 'user' as const, userId: 'demo-jacob' }
      : DEPLOY_TRACE.author,
    parts: [{ kind: 'text' as const, text }],
    stop: null,
  });
  const composer = () => (
    <ChannelComposer
      richMentions
      agent
      label="Message the agent"
      placeholder={
        conversation()
          ? AGENT_PLACEHOLDER
          : 'Type @ to mention docs, people, or channels'
      }
      leadingAction={
        <InputActionButton
          label="Add workspace context"
          onClick={() => w.openItem('documents')}
        >
          <Plus />
        </InputActionButton>
      }
      accessory={
        <ModelCatalogPicker
          value={model()}
          options={AGENT_MODELS}
          onSelect={setModel}
          ariaLabel="Model"
          placement="top-end"
          triggerClass="h-[33.75px] min-w-0 max-w-full gap-[5.625px] rounded-full border-0 bg-transparent hover:bg-hover px-[7.5px] text-base font-normal text-ink-muted [&_svg]:size-[15px]"
        />
      }
      onSend={(prompt) => {
        w.openItem('agents', 'launch-status');
        w.ask(prompt);
      }}
    />
  );
  return (
    <>
      <ViewShell.TopBar>
        <span class="min-w-0 truncate text-sm font-semibold tracking-[-0.03em] text-ink">
          {props.home
            ? ''
            : w.selected() === 'connections'
              ? 'Connections'
              : w.selected() === 'catalog'
                ? 'Agents'
                : conversation()
                  ? session()?.title
                  : 'New conversation'}
        </span>
        <Show when={conversation() && session()?.runtime !== 'Macro'}>
          <span class="ml-auto flex gap-2 items-center text-xs text-success">
            <GitPull class="size-4" />
            {pullRequest()}
            <span>Open</span>
          </span>
        </Show>
      </ViewShell.TopBar>
      <Show
        when={
          (w.selected() === 'connections' || w.selected() === 'catalog') &&
          !props.home
        }
        fallback={
          <Show
            when={conversation()}
            fallback={
              <div class="sample-agent-empty">
                <div class="sample-agent-start">
                  <h1>What should we work on?</h1>
                  {composer()}
                  <Show when={props.home}>
                    <div class="sample-home-suggestions">
                      <For
                        each={w.data.tasks
                          .filter((task) => task.status !== 'Completed')
                          .slice(0, 3)}
                      >
                        {(task) => (
                          <button
                            type="button"
                            onClick={() => w.openItem('tasks', task.id)}
                          >
                            <span class="truncate">{task.title}</span>
                            <span>Open ↗</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
            }
          >
            <Show
              when={w.selected() === 'launch-status'}
              fallback={
                <div class="dummy-scroll sample-agent-log">
                  <Show when={w.selected() === 'deploy'}>
                    <div class="mb-8">
                      <AgentMessage message={message(DEPLOY_PROMPT, true)} />
                    </div>
                    <AgentMessage message={DEPLOY_TRACE} inFlight={false} />
                  </Show>
                  <Show when={w.selected() !== 'deploy' && session()}>
                    {(current) => (
                      <>
                        <div class="mb-8">
                          <AgentMessage
                            message={message(current().prompt, true)}
                          />
                        </div>
                        <AgentMessage
                          message={message(current().answer)}
                          inFlight={false}
                        />
                      </>
                    )}
                  </Show>
                  <For each={w.agentReplies()}>
                    {(reply) => (
                      <div class="mb-8">
                        <div class="mb-6">
                          <AgentMessage message={message(reply.prompt, true)} />
                        </div>
                        <AgentMessage
                          message={message(reply.answer)}
                          inFlight={false}
                        />
                      </div>
                    )}
                  </For>
                  <Show when={w.busy()}>
                    <p class="text-sm magic-chip-shimmer" role="status">
                      Working
                    </p>
                  </Show>
                </div>
              }
            >
              <div
                ref={(element) => (log = element)}
                class="dummy-scroll agent-transcript"
                role="log"
                aria-label={session()?.title}
              >
                <LaunchConversation workspace={w} />
                <For each={w.agentReplies()}>
                  {(reply) => (
                    <>
                      <AgentTurn>
                        <AgentPrompt text={reply.prompt} />
                      </AgentTurn>
                      <AgentTurn>
                        <AgentAnswer text={reply.answer} mentions={{}} />
                      </AgentTurn>
                    </>
                  )}
                </For>
                <Show when={w.busy()}>
                  <AgentTurn>
                    <span class="magic-chip-shimmer text-sm" role="status">
                      Working
                    </span>
                  </AgentTurn>
                </Show>
              </div>
            </Show>
            <div class="dummy-composer sample-chat-composer agent-composer">
              {composer()}
            </div>
          </Show>
        }
      >
        <Show
          when={w.selected() === 'catalog'}
          fallback={
            <div class="mx-auto max-w-3xl p-8">
              <h1 class="text-2xl font-semibold mb-6">Connections</h1>
              <div class="text-sm text-ink-muted mb-6">
                Connect the tools your team already uses so Macro's agent can
                work in them.
              </div>
              <For each={['Gmail', 'Google Calendar', 'GitHub', 'Slack']}>
                {(name) => (
                  <div class="border-b border-edge-muted py-4 flex justify-between gap-12">
                    <span>{name}</span>
                  </div>
                )}
              </For>
            </div>
          }
        >
          <div class="dummy-scroll">
            <div class="sample-agent-catalog">
              <h1 class="text-2xl font-semibold mb-2">Agents</h1>
              <div class="text-sm text-ink-muted leading-6 mb-6">
                Agents let you customize your Macro AI experience by combining a
                unique name, specific instructions, default model, and harness.
              </div>
              <div class="rounded-xl border border-edge-muted bg-surface-2 p-6 mb-8">
                <div class="mb-5 flex items-center gap-2 text-xs font-medium text-ink-muted">
                  <Terminal class="size-4" />
                  Bring your own agent
                </div>
                <h2 class="text-xl font-medium tracking-tight mb-3">
                  Bring <span class="text-accent">Claude Code</span> to Macro.
                </h2>
                <p class="text-sm text-ink-muted leading-relaxed">
                  Your agent, on your machine. Connect a runtime with macrod,
                  then give your agent instructions and a place in your
                  workspace.
                </p>
              </div>
              <h2 class="text-sm font-medium mb-3">Team agents</h2>
              <For
                each={[
                  {
                    name: 'ChatGPT',
                    detail:
                      'Workspace assistant · Emails, tasks, and documents',
                    id: 'customer-summary',
                    icon: ChatGptIcon,
                  },
                  {
                    name: 'Cursor',
                    detail: 'Coding agent · launch-team/workspace',
                    id: 'deploy',
                    icon: CursorIcon,
                  },
                  {
                    name: 'Claude Code',
                    detail: 'Coding agent · launch-team/workspace',
                    id: 'invite-review',
                    icon: ClaudeIcon,
                  },
                ]}
              >
                {(agent) => (
                  <button
                    type="button"
                    class="flex items-center gap-4 w-full rounded-xl bg-surface-2 hover:bg-hover p-4 text-left mb-3"
                    onClick={() => w.openItem('agents', agent.id)}
                  >
                    <agent.icon class="size-6 shrink-0 text-ink" />
                    <span>
                      <span class="text-sm font-medium">{agent.name}</span>
                      <span class="block text-xs text-ink-muted mt-1">
                        {agent.detail}
                      </span>
                    </span>
                  </button>
                )}
              </For>
              <Button
                variant="plain"
                size="sm"
                onClick={() => w.openItem('agents', 'new')}
              >
                <Plus />
                New conversation
              </Button>
            </div>
          </div>
        </Show>
      </Show>
    </>
  );
}
