import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrLinks } from '../../data/pr-links';

const openWithSplit = vi.fn();
const setIsOpen = vi.fn();
let touch = false;
let links: PrLinks;

vi.mock('@components/app/side-panel', () => ({
  SidePanel: { Section: (props: { children: JSX.Element }) => props.children },
  useSidePanel: () => ({ setIsOpen }),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit }),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => touch,
}));
vi.mock('@core/context/channels', () => ({
  useChannelName: () => () => 'bug-reports',
}));
vi.mock('../../queries/pr-links-query', () => ({
  prLinksTarget: () => ({ url: 'https://github.com/org/repo/pull/7' }),
  usePrLinksQuery: () => ({
    linksFor: () => links,
    companyName: () => undefined,
    isError: () => false,
    retry: vi.fn(),
  }),
}));
vi.mock('./PrAgentSessionsSection', () => ({
  useAgentSessionLabel: () => ({ label: () => 'Fix the sharing button' }),
}));

import { PrLinkedWorkSection } from './PrLinkedWorkSection';

const pullRequest = { owner: 'org', repo: 'repo', number: 7 };

afterEach(cleanup);
beforeEach(() => {
  openWithSplit.mockReset();
  setIsOpen.mockReset();
  touch = false;
  links = {
    sessions: [],
    tasks: [],
    channelIds: ['channel-1'],
    channelOrigins: [],
    companyIds: [],
    priority: { id: 'none' },
    origin: { tool: 'macro', signal: 'agent-session', sessionId: 'session-1' },
  };
});

describe('PR linked work', () => {
  it('names the agent session the pull request was started from', () => {
    render(() => <PrLinkedWorkSection pullRequest={pullRequest} />);
    fireEvent.click(screen.getByRole('button', { name: /Fix the sharing/ }));
    expect(openWithSplit).toHaveBeenCalledWith(
      { type: 'agent', id: 'session-1' },
      { preferNewSplit: false }
    );
    expect(setIsOpen).not.toHaveBeenCalled();
  });

  it('closes the touch sheet before opening a linked item', () => {
    touch = true;
    render(() => <PrLinkedWorkSection pullRequest={pullRequest} />);
    fireEvent.click(screen.getByRole('button', { name: /Fix the sharing/ }));
    fireEvent.click(screen.getByRole('button', { name: /bug-reports/ }));
    expect(setIsOpen).toHaveBeenCalledTimes(2);
    expect(setIsOpen).toHaveBeenCalledWith(false);
    expect(openWithSplit).toHaveBeenCalledWith(
      { type: 'channel', id: 'channel-1' },
      { preferNewSplit: false }
    );
  });
});
