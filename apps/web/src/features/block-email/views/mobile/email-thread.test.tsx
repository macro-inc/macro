import type { BlockTool } from '@components/app/block-tool';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { type ComponentProps, For, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { EmailThreadToolsOptions } from '../../component/useEmailThreadTools';
import type { EmailThreadHostViewProps } from '../../EmailThreadHostView';
import { MobileEmailThread } from './email-thread';

const actions = vi.hoisted(() => ({ task: vi.fn(), details: vi.fn() }));

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
  MobileHeader.Info = () => (
    <button onClick={actions.details}>Show details</button>
  );
  return { MobileHeader };
});
vi.mock('@components/app/split-layout/components/SplitFileMenu', () => ({
  BlockSplitFileMenu: (props: { tools: BlockTool[] }) => (
    <menu aria-label="Email actions">
      <For each={props.tools}>
        {(tool) => (
          <li>
            <button onClick={tool.action}>{tool.label as string}</button>
          </li>
        )}
      </For>
    </menu>
  ),
}));
vi.mock('../../EmailThreadHostView', () => ({
  EmailThreadHostView: (props: EmailThreadHostViewProps) => {
    const context = {
      createTask: actions.task,
      createEvent: () => false,
      canCreateEvent: () => false,
    };
    return (
      <>
        {props.topBar?.(context)}
        {props.actions?.(context)}
      </>
    );
  },
}));
vi.mock('../../component/useEmailThreadTools', () => ({
  useEmailThreadTools: (options: EmailThreadToolsOptions) => {
    const action = (label: string, run = () => {}) => ({
      label,
      icon: () => null,
      action: run,
    });
    return {
      isInvite: () => false,
      emailEntity: () => undefined,
      permissions: () => undefined,
      actions: {
        markDone: action('Mark Done'),
        markNotDone: action('Mark Not Done'),
        markUnread: action('Mark Unread'),
        markRead: action('Mark Read'),
        askMacro: action('Ask Macro'),
        createTask: action('Create task', () => options.onCreateTask?.()),
        createEvent: action('Create event'),
        share: action('Share'),
        moveToFolder: action('Move to folder'),
        downloadEml: action('Download'),
        trash: action('Delete'),
        senderToSignal: action('Sender → Signal'),
        senderToNoise: action('Sender → Noise'),
        blockSender: action('Block Sender'),
      },
    };
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('keeps the header to the subject and details, with thread actions in the title menu', () => {
  const props = {
    title: 'A shared email',
    threadId: () => 'thread-1',
    source: {},
    threadTransport: {},
    host: {},
  } as ComponentProps<typeof MobileEmailThread>;
  render(() => <MobileEmailThread {...props} />);

  const header = screen.getByRole('banner');
  expect(
    within(header).getByRole('heading', { name: 'A shared email' })
  ).toBeTruthy();
  expect(
    within(header)
      .getAllByRole('button')
      .map((button) => button.textContent)
  ).toEqual(['Show details']);
  fireEvent.click(within(header).getByRole('button', { name: 'Show details' }));
  expect(actions.details).toHaveBeenCalledOnce();

  const menu = screen.getByRole('list', { name: 'Email actions' });
  expect(within(menu).getByRole('button', { name: 'Ask Macro' })).toBeTruthy();
  fireEvent.click(within(menu).getByRole('button', { name: 'Create task' }));
  expect(actions.task).toHaveBeenCalledOnce();
});
