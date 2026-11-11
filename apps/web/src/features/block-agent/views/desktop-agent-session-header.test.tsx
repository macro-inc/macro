import type { BlockTool } from '@components/app/block-tool';
import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { For, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentSessionHeaderState } from '../component/agent-session-header';
import { DesktopAgentSessionHeader } from './desktop-agent-session-header';

vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: (props: { children: JSX.Element }) => <>{props.children}</>,
  SplitHeaderRight: (props: { children: JSX.Element }) => <>{props.children}</>,
}));
vi.mock('@components/app/split-layout/components/SplitLabel', () => ({
  StaticSplitLabel: (props: { label: string }) => <h1>{props.label}</h1>,
}));
vi.mock('@components/app/block-toolbar', () => ({
  BlockToolbar: (props: { trailing: JSX.Element; menuTools: BlockTool[] }) => (
    <>
      {props.trailing}
      <menu aria-label="Title menu">
        <For each={props.menuTools}>
          {(tool) => (
            <li>
              <button>
                {typeof tool.label === 'function' ? tool.label() : tool.label}
              </button>
            </li>
          )}
        </For>
      </menu>
    </>
  ),
}));
vi.mock('@components/app/HeaderActionGroup', () => ({
  HeaderActionGroup: (props: { children: JSX.Element }) => (
    <>{props.children}</>
  ),
}));
vi.mock('@components/app/tool-button', () => ({
  ToolButton: (props: { tool: BlockTool }) => (
    <button onClick={props.tool.action}>
      {typeof props.tool.label === 'function'
        ? props.tool.label()
        : props.tool.label}
    </button>
  ),
}));
vi.mock('@app/features/changes/changes', () => ({
  ChangesToggle: () => <button>Changes</button>,
}));
vi.mock('@core/component/AI/component/ProviderIcon', () => ({
  ProviderIcon: () => null,
}));
vi.mock('@core/component/LiveIndicators', () => ({
  BlockLiveIndicators: () => <button>Viewers</button>,
}));
vi.mock('@core/component/TopBar/ShareButton', () => ({
  ShareTrigger: (props: { onClick: () => void }) => (
    <button onClick={props.onClick}>Share</button>
  ),
}));
vi.mock('../component/AgentTaskChip', () => ({
  AgentTaskChip: () => <button>Task</button>,
}));
vi.mock('../component/AgentPullRequestChip', () => ({
  AgentPullRequestChip: () => <button>Pull request</button>,
}));
vi.mock('../context/AgentSessionContext', () => ({
  useAgentSession: () => ({
    sessionId: () => 'session-1',
    metadata: () => undefined,
  }),
}));

afterEach(cleanup);

const external = vi.fn();
const share = vi.fn();

const header = (fields: { linked: boolean }): AgentSessionHeaderState => ({
  title: () => 'Fix the build',
  entity: () => ({ type: 'agent_session', id: 'session-1' }) as never,
  permissions: () => 0 as never,
  openShare: share,
  ops: () => [],
  actions: {
    openExternally: {
      label: 'Open in Codex',
      icon: () => null,
      action: external,
      condition: () => fields.linked,
    },
    share: { label: 'Share', icon: () => null, action: share },
  },
});

const session = { model: 'model', taskId: 'task-1' } as AgentSessionResponse;

const headerButtons = () =>
  screen
    .getAllByRole('button')
    .filter((button) => !button.closest('menu'))
    .map((button) => button.textContent);

it('places viewers, the task, Changes, the external link, then Share', () => {
  render(() => (
    <DesktopAgentSessionHeader
      session={session}
      header={header({ linked: true })}
    />
  ));

  expect(screen.getByRole('heading', { name: 'Fix the build' })).toBeTruthy();
  expect(headerButtons()).toEqual([
    'Viewers',
    'Task',
    'Changes',
    'Open in Codex',
    'Share',
  ]);

  const [link] = screen
    .getAllByRole('button', { name: 'Open in Codex' })
    .filter((button) => !button.closest('menu'));
  fireEvent.click(link);
  expect(external).toHaveBeenCalledOnce();
});

it('drops the external link for a session that has none', () => {
  render(() => (
    <DesktopAgentSessionHeader
      session={session}
      header={header({ linked: false })}
    />
  ));

  expect(headerButtons()).toEqual(['Viewers', 'Task', 'Changes', 'Share']);
});
