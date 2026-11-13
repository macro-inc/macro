/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserIcon } from './UserIcon';

const mocks = vi.hoisted(() => ({
  agentDashboards: true,
  openDm: vi.fn(),
  openWithSplit: vi.fn(),
}));

vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  isFeatureEnabled: (flag: { key?: string }) =>
    flag.key === 'enable-agent-dashboards' && mocks.agentDashboards,
}));
vi.mock('@core/util/open-direct-message', () => ({
  useOpenDirectMessage: () => mocks.openDm,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@core/user', () => ({
  getDisplayName: () => 'Someone',
  getDisplayNameParts: () => ({ firstName: 'Some', lastName: 'One' }),
  getInitials: () => 'SO',
  getInitialsFromName: () => 'SO',
  isAgentAccount: (id: string | undefined) => id === 'macro|agent@example.com',
  macroIdToEmail: (id: string) => id.replace('macro|', ''),
  tryMacroId: (id: string) => id,
  useIsConnectedSecondaryInbox: () => () => false,
}));
vi.mock('@core/signal/profilePicture', () => ({
  useProfilePictureUrl: () => [() => undefined],
}));
vi.mock('./HoverCard', () => ({
  HoverCard: (props: { trigger: JSX.Element }) => <span>{props.trigger}</span>,
}));

const AGENT = 'macro|agent@example.com';
const PERSON = 'macro|person@example.com';

const press = (id: string, suppressClick = false) => {
  const { container } = render(() => (
    <UserIcon id={id} suppressClick={suppressClick} />
  ));
  const avatar = container.querySelector('[data-slot="avatar"]');
  if (!avatar) throw new Error('no avatar');
  fireEvent.mouseDown(avatar);
};

beforeEach(() => {
  mocks.agentDashboards = true;
  mocks.openDm.mockReset();
  mocks.openDm.mockResolvedValue(undefined);
  mocks.openWithSplit.mockReset();
});
afterEach(cleanup);

describe('UserIcon press', () => {
  it("opens an agent teammate's profile instead of a DM", () => {
    press(AGENT);

    expect(mocks.openWithSplit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: 'agent-dashboard',
        params: { userId: AGENT },
      }),
      { activate: true, preferNewSplit: true }
    );
    expect(mocks.openDm).not.toHaveBeenCalled();
  });

  it("opens a person's DM", () => {
    press(PERSON);

    expect(mocks.openDm).toHaveBeenCalledOnce();
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
  });

  it("opens an agent's DM with agent dashboards off", () => {
    mocks.agentDashboards = false;
    press(AGENT);

    expect(mocks.openDm).toHaveBeenCalledOnce();
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
  });

  it('does nothing when clicks are suppressed', () => {
    press(AGENT, true);

    expect(mocks.openDm).not.toHaveBeenCalled();
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
  });
});
