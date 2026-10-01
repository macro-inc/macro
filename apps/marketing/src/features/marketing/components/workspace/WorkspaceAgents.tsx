import ChatGptIcon from '@icon/openai.svg';
import ClaudeIcon from '@icon/wide-claude.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import GitPull from '@phosphor/git-pull-request.svg';
import Plus from '@phosphor/plus.svg';
import Terminal from '@phosphor/terminal.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { DEPLOY_PROMPT, DEPLOY_TRACE } from '../../core/deploy-agent-demo';
import { sampleAgentSessions } from '../../core/workspace-parity-fixtures';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { AgentMessage } from '../DemoAgentMessage';
import { ViewShell } from '../DemoWorkspaceChrome';
import { InputActionButton } from '../email/frozen/ActionButton';
import { ChannelComposer } from '../email/frozen/ChannelComposer';
import { ModelCatalogPicker } from './frozen/model-picker/ModelCatalogPicker';

const SAMPLE_MODELS = [
  { id: 'auto', label: 'Auto' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'gpt-5', label: 'GPT-5' },
];

export function WorkspaceAgents(props: {
  workspace: DummyWorkspace;
  home?: boolean;
}) {
  const w = props.workspace;
  const [model, setModel] = createSignal('auto');
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
      label="Ask sample agent"
      placeholder={w.busy() ? 'Working…' : 'Ask about your workspace…'}
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
          options={SAMPLE_MODELS}
          onSelect={setModel}
          ariaLabel="Choose sample model"
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
        <span class="text-sm font-medium">
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
        <span
          class="text-xs text-ink-extra-muted"
          classList={{
            'ml-auto': !conversation() || !pullRequest(),
            'ml-4': !!pullRequest(),
          }}
          title="Agent responses use scripted sample data"
        >
          Sample workspace
        </span>
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
                      <AgentMessage message={message(current().prompt, true)} />
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
                <p class="text-sm text-ink-muted">
                  Reviewing sample workspace…
                </p>
              </Show>
            </div>
            <div class="dummy-composer sample-chat-composer">{composer()}</div>
          </Show>
        }
      >
        <Show
          when={w.selected() === 'catalog'}
          fallback={
            <div class="mx-auto max-w-3xl p-8">
              <h1 class="text-2xl font-semibold mb-6">Connections</h1>
              <p class="text-sm text-ink-muted mb-6">
                This sample workspace uses local data. Your accounts are not
                connected.
              </p>
              <For each={['Gmail', 'Google Calendar', 'GitHub', 'Slack']}>
                {(name) => (
                  <div class="border-b border-edge-muted py-4 flex justify-between gap-12">
                    <span>{name}</span>
                    <span class="text-xs text-ink-muted">Sample data</span>
                  </div>
                )}
              </For>
            </div>
          }
        >
          <div class="dummy-scroll">
            <div class="sample-agent-catalog">
              <h1 class="text-2xl font-semibold mb-2">Agents</h1>
              <p class="text-sm text-ink-muted leading-6 mb-6">
                Bring your conversations and coding agents into one workspace.
                Choose a sample agent to explore its work.
              </p>
              <div class="rounded-xl bg-surface-2 p-6 mb-8">
                <Terminal class="size-5 mb-4 text-ink-muted" />
                <h2 class="text-xl mb-2">Bring your own agent to Macro.</h2>
                <p class="text-sm text-ink-muted leading-6">
                  Your agent, your workspace. Coding sessions, pull requests,
                  and conversations stay together.
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
