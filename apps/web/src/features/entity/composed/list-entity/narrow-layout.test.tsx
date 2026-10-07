import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  GithubPullRequestEntity,
  UnknownForeignEntity,
} from '../../types/entity';
import type { LayoutProps } from './shared';

vi.mock('../../entity', () => ({
  Entity: {
    Layout: (props: JSX.HTMLAttributes<HTMLDivElement>) => (
      <div data-testid="layout" {...props} />
    ),
    Slot: (props: ParentProps<{ placement: string; class?: string }>) => (
      <div data-testid={props.placement} class={props.class}>
        {props.children}
      </div>
    ),
    Icon: () => null,
    Title: (props: { entity: { name: string } }) => (
      <span>{props.entity.name}</span>
    ),
    Timestamp: () => null,
    Properties: () => null,
  },
}));
vi.mock('./shared', () => ({ RowIndicator: () => null }));
vi.mock('./channel', () => ({
  ChannelActiveCallBadge: () => null,
  ChannelJoinButton: () => null,
  ChannelMessageSingleLine: () => null,
}));
vi.mock('./email', () => ({ EmailInboxChip: () => null }));
vi.mock('./row-end', () => ({
  RowEnd: (props: ParentProps) => props.children,
}));
vi.mock('../../views/PrAgentSessionsChip', () => ({
  PrAgentSessionsChip: (props: { url: string }) => (
    <span data-testid="linked-sessions">{props.url}</span>
  ),
}));

import { NarrowLayout } from './narrow-layout';

const review: GithubPullRequestEntity = {
  id: 'pr-7',
  name: 'Fix rendering',
  ownerId: 'owner',
  type: 'foreign',
  foreignId: 'org/repo/7',
  storedForId: 'team',
  storedForAuthEntity: 'team',
  foreignSource: 'github_pull_request',
  metadata: {
    name: 'Fix rendering',
    number: 7,
    owner: 'org',
    repo: 'repo',
    url: 'https://github.com/org/repo/pull/7',
    status: 'open',
    additions: 5,
    deletions: 2,
    authorLogin: 'alice',
    comments: [],
    checks: [],
    labels: [],
  },
};
const layoutProps = (entity: LayoutProps['entity']): LayoutProps => ({
  entity,
  unread: false,
  isShared: false,
  hasNotifications: false,
  showHitSnippet: false,
  setSnippetContainerRef: () => {},
  chars: 200,
});

afterEach(cleanup);

describe('narrow PR metadata', () => {
  it('shows author, diff, and linked sessions below the title', () => {
    render(() => (
      <NarrowLayout {...layoutProps(review)} authorDisplayName="Alice" />
    ));
    const body = screen.getByTestId('body');
    expect(body.textContent).toContain('Alice');
    expect(body.textContent).toContain('+5');
    expect(body.textContent).toContain('−2');
    expect(body.contains(screen.getByTestId('linked-sessions'))).toBe(true);
    expect(screen.getByTestId('linked-sessions').textContent).toBe(
      review.metadata.url
    );
    expect(screen.getByTestId('layout').style.gridTemplateRows).toBe(
      '44px auto'
    );
    expect(screen.getByTestId('title').textContent).toBe('Fix rendering');
  });

  it('keeps non-PR compact rows unchanged', () => {
    const foreign: UnknownForeignEntity = {
      id: 'foreign',
      name: 'Other item',
      ownerId: 'owner',
      type: 'foreign',
      foreignId: 'other',
      storedForId: 'team',
      storedForAuthEntity: 'team',
      foreignSource: 'unknown',
      rawForeignSource: 'other',
      metadata: {},
    };
    render(() => <NarrowLayout {...layoutProps(foreign)} />);
    expect(screen.queryByTestId('body')).toBeNull();
    expect(screen.queryByTestId('linked-sessions')).toBeNull();
    expect(screen.getByTestId('layout').style.gridTemplateRows).toBe('44px');
  });
});
