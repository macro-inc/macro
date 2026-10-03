import { cleanup, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const PETER = 'macro|peter@example.com';
const DEPLOY_BOT = '5f0c8a4e-2d1b-4c3a-9e7f-6a5b4c3d2e1f';
const ENGINEERING = '01234567-89ab-cdef-0123-456789abcdef';

vi.mock('@core/component/UserIcon', () => ({
  UserIcon: () => <span>avatar</span>,
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|me@example.com',
}));
vi.mock('@core/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/user')>()),
  getDisplayName: (id: string | undefined) =>
    id === 'macro|peter@example.com' ? 'Peter Park' : '',
}));
vi.mock('@queries/bots/profiles', () => ({
  useBotProfile: () => ({
    isPending: false,
    isError: false,
    data: { name: 'Deploy Bot', avatarUrl: undefined, deleted: true },
  }),
}));
vi.mock('@queries/team/teams', () => ({
  useUserTeamsQuery: () => ({
    isPending: false,
    isError: false,
    data: [{ id: '01234567-89ab-cdef-0123-456789abcdef', name: 'Engineering' }],
  }),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/component/HoverCard', () => ({
  HoverCard: (props: { trigger: JSX.Element; content: JSX.Element }) => (
    <>
      {props.trigger}
      {props.content}
    </>
  ),
}));

import { CreatedByBadgeSmall, SharedBadge, SharedBadgeSmall } from './Badges';

afterEach(cleanup);

function textsOf(badge: () => JSX.Element): string[] {
  const { container } = render(badge);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const texts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (text) texts.push(text);
  }
  return texts;
}

describe('SharedBadge', () => {
  it('draws a user as an avatar, a bot with its name, and a team as a badge', () => {
    expect(textsOf(() => <SharedBadge ownerId={PETER} />)).toEqual([
      'avatar',
      'shared',
    ]);
    expect(
      textsOf(() => <SharedBadge ownerId={`bot|${DEPLOY_BOT}`} />)
    ).toEqual(['avatar', 'Deploy Bot (deleted)', 'shared']);
    expect(textsOf(() => <SharedBadge ownerId={ENGINEERING} />)).toEqual([
      'Engineering',
      'shared',
    ]);
  });
});

describe('SharedBadgeSmall', () => {
  it('names the user, bot, or team that shared the row', () => {
    expect(textsOf(() => <SharedBadgeSmall ownerId={PETER} />)).toEqual([
      'avatar',
      'Peter Park',
      'shared this with you',
    ]);
    expect(
      textsOf(() => <SharedBadgeSmall ownerId={`bot|${DEPLOY_BOT}`} />)
    ).toEqual(['avatar', 'Deploy Bot (deleted)', 'shared this with you']);
    expect(textsOf(() => <SharedBadgeSmall ownerId={ENGINEERING} />)).toEqual([
      'Engineering',
      'shared this with you',
    ]);
  });
});

describe('CreatedByBadgeSmall', () => {
  it('names the user, bot, or team that created the row', () => {
    expect(textsOf(() => <CreatedByBadgeSmall ownerId={PETER} />)).toEqual([
      'Created by',
      'avatar',
      'Peter Park',
    ]);
    expect(
      textsOf(() => <CreatedByBadgeSmall ownerId={`bot|${DEPLOY_BOT}`} />)
    ).toEqual(['Created by', 'avatar', 'Deploy Bot (deleted)']);
    expect(
      textsOf(() => <CreatedByBadgeSmall ownerId={ENGINEERING} />)
    ).toEqual(['Created by', 'Engineering']);
  });
});
