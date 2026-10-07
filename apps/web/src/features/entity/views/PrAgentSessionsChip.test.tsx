import type { AgentSessionMentionPreview } from '@queries/agent-session/mention-types';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { type Accessor, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  links: { isSuccess: false, data: [] as string[] },
  previews: new Map<string, AgentSessionMentionPreview>(),
  previewCalls: [] as { id: Accessor<string>; enabled: Accessor<boolean> }[],
  url: undefined as Accessor<string | undefined> | undefined,
  open: vi.fn(),
}));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.open }),
}));
vi.mock('@queries/agent-session/pull-requests', () => ({
  usePullRequestAgentSessionsQuery: (url: Accessor<string | undefined>) => {
    mocks.url = url;
    return mocks.links;
  },
}));
vi.mock('@queries/agent-session/mentions', () => ({
  useAgentSessionMentionPreview: (
    id: Accessor<string>,
    enabled: Accessor<boolean>
  ) => {
    mocks.previewCalls.push({ id, enabled });
    return {
      get isSuccess() {
        return enabled() && mocks.previews.has(id());
      },
      isError: false,
      get data() {
        if (!enabled()) throw new Error('Read a disabled session preview');
        return mocks.previews.get(id());
      },
    };
  },
}));

import { PrAgentSessionsChip } from './PrAgentSessionsChip';

const url = 'https://github.com/org/repo/pull/7';
const accessibleSession = (
  id: string,
  name: string
): AgentSessionMentionPreview => ({
  access: 'access',
  data: {
    id,
    name,
    ownerId: 'owner',
    botId: 'bot',
    status: { kind: 'no_messages' },
    createdAt: '',
    updatedAt: '',
  },
});

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  mocks.links = { isSuccess: true, data: [] };
  mocks.previews.clear();
  mocks.previewCalls = [];
  mocks.open.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('linked PR session chip', () => {
  it('does not show a chip for an empty or pending links result', () => {
    const first = render(() => <PrAgentSessionsChip url={url} />);
    expect(screen.queryByRole('button')).toBeNull();
    first.unmount();
    mocks.links = { isSuccess: false, data: ['pending-session'] };
    render(() => <PrAgentSessionsChip url={url} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(mocks.previewCalls.every((call) => !call.enabled())).toBe(true);
  });

  it('uses the sole session name and opens the session without opening the PR row', () => {
    mocks.links.data = ['session-1'];
    mocks.previews.set(
      'session-1',
      accessibleSession('session-1', 'Fix the unread rail')
    );
    const rowClick = vi.fn();
    render(() => (
      <div onClick={rowClick}>
        <PrAgentSessionsChip url={url} />
      </div>
    ));
    const chip = screen.getByRole('button', {
      name: 'Open agent session: Fix the unread rail',
    });
    expect(chip.querySelector('svg')).toBeTruthy();
    fireEvent.click(chip, { shiftKey: true });
    expect(mocks.open).toHaveBeenCalledWith(
      { type: 'agent', id: 'session-1' },
      { preferNewSplit: true }
    );
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('never opens a private or deleted session', () => {
    mocks.links.data = ['session-1'];
    mocks.previews.set('session-1', { access: 'no_access' });
    const first = render(() => <PrAgentSessionsChip url={url} />);
    expect(
      screen.getByRole('button', {
        name: 'Open agent session: Private agent session',
      })
    ).toHaveProperty('disabled', true);
    first.unmount();
    mocks.previews.set('session-1', { access: 'does_not_exist' });
    render(() => <PrAgentSessionsChip url={url} />);
    expect(
      screen.getByRole('button', {
        name: 'Open agent session: Deleted agent session',
      })
    ).toHaveProperty('disabled', true);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('opens the sole session with the keyboard without activating the PR row', async () => {
    mocks.links.data = ['session-1'];
    mocks.previews.set(
      'session-1',
      accessibleSession('session-1', 'Keyboard session')
    );
    const rowKeyDown = vi.fn();
    render(() => (
      <div onKeyDown={rowKeyDown}>
        <PrAgentSessionsChip url={url} />
      </div>
    ));
    const user = userEvent.setup();
    screen
      .getByRole('button', { name: 'Open agent session: Keyboard session' })
      .focus();
    await user.keyboard('{Enter}');
    expect(mocks.open).toHaveBeenCalledWith(
      { type: 'agent', id: 'session-1' },
      { preferNewSplit: false }
    );
    expect(rowKeyDown).not.toHaveBeenCalled();
  });

  it('shows a count for multiple sessions and resolves names only when the menu opens', async () => {
    mocks.links.data = ['session-1', 'session-2'];
    mocks.previews.set(
      'session-1',
      accessibleSession('session-1', 'First session')
    );
    mocks.previews.set(
      'session-2',
      accessibleSession('session-2', 'Second session')
    );
    const rowClick = vi.fn();
    render(() => (
      <div onClick={rowClick}>
        <PrAgentSessionsChip url={url} />
      </div>
    ));
    const chip = screen.getByRole('button', { name: 'Show 2 agent sessions' });
    expect(chip.querySelector('svg')).toBeTruthy();
    expect(mocks.previewCalls.filter((call) => call.enabled())).toHaveLength(0);
    const user = userEvent.setup();
    await user.click(chip);
    const item = await screen.findByRole('menuitem', {
      name: 'Second session',
    });
    expect(mocks.previewCalls.filter((call) => call.enabled())).toHaveLength(2);
    await user.click(item);
    await waitFor(() =>
      expect(mocks.open).toHaveBeenCalledWith(
        { type: 'agent', id: 'session-2' },
        { preferNewSplit: false }
      )
    );
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('disables navigation while a sole session preview is loading', () => {
    mocks.links.data = ['session-1'];
    render(() => <PrAgentSessionsChip url={url} />);
    expect(
      screen.getByRole('button', { name: 'Open agent session: Agent session' })
    ).toHaveProperty('disabled', true);
    expect(mocks.previewCalls.filter((call) => call.enabled())).toHaveLength(1);
  });

  it('does not reuse links when the PR URL becomes unavailable', () => {
    mocks.links.data = ['session-1'];
    mocks.previews.set(
      'session-1',
      accessibleSession('session-1', 'First session')
    );
    const [currentUrl, setUrl] = createSignal<string | undefined>(url);
    render(() => <PrAgentSessionsChip url={currentUrl()} />);
    expect(
      screen.getByRole('button', { name: 'Open agent session: First session' })
    ).toBeTruthy();
    setUrl(undefined);
    expect(screen.queryByRole('button')).toBeNull();
    expect(mocks.url?.()).toBeUndefined();
    expect(mocks.previewCalls.every((call) => !call.enabled())).toBe(true);
  });
});
