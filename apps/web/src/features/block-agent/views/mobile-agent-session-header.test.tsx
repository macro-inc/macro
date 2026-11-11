import type { BlockTool } from '@components/app/block-tool';
import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { For, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentSessionHeaderState } from '../component/agent-session-header';
import { MobileAgentSessionHeader } from './mobile-agent-session-header';

vi.mock('@components/app/mobile-header/mobile-header', () => {
  const MobileHeader = (props: {
    children: JSX.Element;
    trailing?: JSX.Element;
  }) => (
    <header>
      {props.children}
      {props.trailing}
    </header>
  );
  MobileHeader.Title = (props: { label: string }) => <h1>{props.label}</h1>;
  MobileHeader.Island = (props: { children: JSX.Element }) => (
    <>{props.children}</>
  );
  MobileHeader.Info = () => <button>Show details</button>;
  return { MobileHeader };
});
vi.mock('@components/app/split-layout/components/SplitFileMenu', () => ({
  BlockSplitFileMenu: (props: { tools: BlockTool[] }) => (
    <menu aria-label="Session actions">
      <For each={props.tools}>
        {(tool) => (
          <li>
            <button>
              {typeof tool.label === 'function' ? tool.label() : tool.label}
            </button>
          </li>
        )}
      </For>
    </menu>
  ),
}));
vi.mock('@core/component/AI/component/ProviderIcon', () => ({
  ProviderIcon: () => null,
}));
vi.mock('@core/component/LiveIndicators', () => ({
  BlockLiveIndicators: () => <button>Viewers</button>,
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

const action = (label: string): BlockTool => ({
  label,
  icon: () => null,
  action: () => {},
});

const header: AgentSessionHeaderState = {
  title: () => 'Fix the build',
  entity: () => undefined,
  permissions: () => 0 as never,
  openShare: () => {},
  ops: () => [],
  actions: {
    openExternally: action('Open externally'),
    share: action('Share'),
  },
};

const session = (fields: Partial<AgentSessionResponse> = {}) =>
  ({ model: 'model', ...fields }) as AgentSessionResponse;

const names = (container: HTMLElement) =>
  within(container)
    .getAllByRole('button')
    .map((button) => button.textContent);

it('shows the title, viewers, the session task and pull request, and Info', () => {
  render(() => (
    <MobileAgentSessionHeader
      session={session({ taskId: 'task-1', pullRequestUrl: 'https://pr' })}
      header={header}
    />
  ));

  expect(screen.getByRole('heading', { name: 'Fix the build' })).toBeTruthy();
  expect(names(screen.getByRole('banner'))).toEqual([
    'Viewers',
    'Task',
    'Pull request',
    'Show details',
  ]);
  expect(names(screen.getByRole('list', { name: 'Session actions' }))).toEqual([
    'Open externally',
    'Share',
  ]);
});

it('leaves out the chips a session does not have', () => {
  render(() => (
    <MobileAgentSessionHeader session={session()} header={header} />
  ));

  expect(names(screen.getByRole('banner'))).toEqual([
    'Viewers',
    'Show details',
  ]);
});
