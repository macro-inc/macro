import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type QueryLike = { isPending: boolean; isError: boolean; data: unknown };

const mocks = vi.hoisted(() => ({
  displayNames: new Map<string, string>(),
  botProfiles: new Map<string, QueryLike>(),
  requestedBotIds: [] as string[],
  teams: { isPending: false, isError: false, data: [] as unknown },
  mutate: vi.fn(),
}));

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|me@example.com',
}));
vi.mock('@core/user', async () => ({
  ...(await import('@core/user/macroId')),
  getDisplayName: (id: string | undefined) =>
    (id && mocks.displayNames.get(id)) ?? '',
  getDisplayNameParts: () => ({ firstName: '', lastName: '' }),
  getInitials: () => '',
  useIsConnectedSecondaryInbox: () => () => false,
}));
vi.mock('@queries/bots/profiles', () => ({
  useBotProfile: (botId: () => string) => {
    mocks.requestedBotIds.push(botId());
    const current = () => mocks.botProfiles.get(botId());
    return {
      get isPending() {
        return current()?.isPending ?? true;
      },
      get isError() {
        return current()?.isError ?? false;
      },
      get data() {
        return current()?.data;
      },
    };
  },
}));
vi.mock('@queries/team/teams', () => ({
  useUserTeamsQuery: () => mocks.teams,
}));
vi.mock('@queries/channel/get-or-create-dm', () => ({
  useGetOrCreateDirectMessageMutation: () => ({ mutate: mocks.mutate }),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));
vi.mock('@core/signal/profilePicture', () => ({
  useProfilePictureUrl: () => [() => undefined],
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/component/UserCardTrigger', () => ({
  UserCardTrigger: (props: { trigger: JSX.Element }) => props.trigger,
}));

import { OwnerLabel } from './owner-display';

const VIEWER = 'macro|me@example.com';
const PETER = 'macro|peter@example.com';
const DEPLOY_BOT = '5f0c8a4e-2d1b-4c3a-9e7f-6a5b4c3d2e1f';
const ENGINEERING = '01234567-89ab-cdef-0123-456789abcdef';

function settled(data: unknown): QueryLike {
  return { isPending: false, isError: false, data };
}

beforeEach(() => {
  mocks.displayNames = new Map([
    [VIEWER, 'Sarah Chen'],
    [PETER, 'Peter Park'],
  ]);
  mocks.botProfiles = new Map();
  mocks.requestedBotIds = [];
  mocks.teams = settled([{ id: ENGINEERING, name: 'Engineering' }]);
  mocks.mutate.mockReset();
});

afterEach(cleanup);

function textOf(ownerId: string | undefined, viewerLabel?: string): string {
  const { container, unmount } = render(() => (
    <OwnerLabel ownerId={ownerId} viewerLabel={viewerLabel} />
  ));
  const text = container.textContent ?? '';
  unmount();
  return text;
}

describe('OwnerLabel', () => {
  it('reads the viewer word for the viewer and their name without one', () => {
    expect(textOf(VIEWER, 'Me')).toBe('Me');
    expect(textOf(VIEWER)).toBe('Sarah Chen');
  });

  it('names another user even when a viewer word is given', () => {
    expect(textOf(PETER, 'Me')).toBe('Peter Park');
  });

  it('names a first-party bot without requesting its profile', () => {
    expect(textOf('bot|00000000-0000-0000-0000-00000000a1a1')).toBe('Macro');
    expect(textOf('00000000-0000-0000-0000-00000000c5c5')).toBe('Cursor');
    expect(mocks.requestedBotIds).toEqual([]);

    mocks.botProfiles.set(
      DEPLOY_BOT,
      settled({ name: 'Deploy Bot', avatarUrl: undefined, deleted: false })
    );
    expect(textOf(`bot|${DEPLOY_BOT}`)).toBe('Deploy Bot');
    expect(mocks.requestedBotIds).toEqual([DEPLOY_BOT]);
  });

  it('suffixes a deleted bot', () => {
    mocks.botProfiles.set(
      DEPLOY_BOT,
      settled({ name: 'Deploy Bot', avatarUrl: undefined, deleted: true })
    );
    expect(textOf(`bot|${DEPLOY_BOT}`)).toBe('Deploy Bot (deleted)');
  });

  it('reads Bot for a bot the backend does not know', () => {
    mocks.botProfiles.set(DEPLOY_BOT, settled(null));
    expect(textOf(`bot|${DEPLOY_BOT}`)).toBe('Bot');
  });

  it('shows the next bot from the same profile subscription', () => {
    const triageBot = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    mocks.botProfiles.set(
      DEPLOY_BOT,
      settled({ name: 'Deploy Bot', avatarUrl: undefined, deleted: false })
    );
    mocks.botProfiles.set(
      triageBot,
      settled({ name: 'Triage Bot', avatarUrl: undefined, deleted: false })
    );
    const [ownerId, setOwnerId] = createSignal(`bot|${DEPLOY_BOT}`);
    const { container } = render(() => <OwnerLabel ownerId={ownerId()} />);

    expect(container.textContent).toBe('Deploy Bot');
    setOwnerId(`bot|${triageBot}`);
    expect(container.textContent).toBe('Triage Bot');
    expect(mocks.requestedBotIds).toEqual([DEPLOY_BOT]);
  });

  it('fills in a bot name in place once its profile arrives', () => {
    const [query, setQuery] = createSignal<QueryLike>({
      isPending: true,
      isError: false,
      data: undefined,
    });
    mocks.botProfiles.set(DEPLOY_BOT, {
      get isPending() {
        return query().isPending;
      },
      get isError() {
        return query().isError;
      },
      get data() {
        return query().data;
      },
    });
    const { container } = render(() => (
      <OwnerLabel ownerId={`bot|${DEPLOY_BOT}`} />
    ));
    const avatar = container.querySelector('[data-slot="avatar"]');
    expect(container.textContent).toBe('');

    setQuery(
      settled({ name: 'Deploy Bot', avatarUrl: undefined, deleted: false })
    );

    expect(container.textContent).toBe('Deploy Bot');
    expect(container.querySelector('[data-slot="avatar"]')).toBe(avatar);
  });

  it('names a known team and reads Team for any other', () => {
    expect(textOf(ENGINEERING)).toBe('Engineering');
    expect(textOf('fedcba98-7654-3210-fedc-ba9876543210')).toBe('Team');
  });

  it('renders nothing without an owner', () => {
    expect(textOf('')).toBe('');
    expect(textOf(undefined)).toBe('');
    expect(textOf('system:nightly')).toBe('?Unknown');
  });

  it('opens a DM only from a user avatar that allows it', () => {
    mocks.botProfiles.set(
      DEPLOY_BOT,
      settled({ name: 'Deploy Bot', avatarUrl: undefined, deleted: false })
    );
    const { container, getByText } = render(() => (
      <>
        <OwnerLabel ownerId={PETER} />
        <OwnerLabel ownerId={VIEWER} suppressClick />
        <OwnerLabel ownerId={`bot|${DEPLOY_BOT}`} />
        <OwnerLabel ownerId={ENGINEERING} />
      </>
    ));

    for (const avatar of container.querySelectorAll('[data-slot="avatar"]')) {
      fireEvent.mouseDown(avatar);
    }
    fireEvent.mouseDown(getByText('Engineering'));

    expect(container.querySelectorAll('[data-slot="avatar"]').length).toBe(3);
    expect(mocks.mutate.mock.calls.map(([vars]) => vars)).toEqual([
      { recipient_id: PETER },
    ]);
  });
});

it('renders compact metadata names without avatars for every owner kind', () => {
  mocks.botProfiles.set(
    DEPLOY_BOT,
    settled({ name: 'Deploy Bot', deleted: false })
  );
  for (const [ownerId, expected] of [
    [PETER, 'Peter Park'],
    [`bot|${DEPLOY_BOT}`, 'Deploy Bot'],
    [ENGINEERING, 'Engineering'],
    ['unknown-owner', 'Unknown'],
  ]) {
    const view = render(() => <OwnerLabel ownerId={ownerId} textOnly />);
    expect(view.container.textContent).toBe(expected);
    expect(
      view.container.querySelector('img, svg, button, [data-slot="avatar"]')
    ).toBeNull();
    view.unmount();
  }
});
