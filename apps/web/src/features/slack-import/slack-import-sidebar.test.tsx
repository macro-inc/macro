import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlackImportSidebar } from './slack-import-sidebar';

const host = vi.hoisted(() => ({
  enabled: true,
  admin: true,
  openHistory: vi.fn(),
  openNewChannel: vi.fn(),
  promotion: undefined as
    | undefined
    | {
        category: string;
        applies: boolean | undefined;
        alternatives: { label: string; onSelect(opener?: unknown): void }[];
        actionLabel?: string;
        secondaryAction?: { label: string; onClick(trigger: unknown): void };
      },
  slackImport: undefined as undefined | { historyOnly?: boolean },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: host.enabled }),
}));
vi.mock('@queries/team/teams', () => ({
  useIsTeamAdmin: () => () => host.admin,
  useCurrentTeamQuery: () => ({ isSuccess: true, data: { team: { id: 't' } } }),
}));
vi.mock('@channel/CreateChannelModal', () => ({
  openNewChannelModal: host.openNewChannel,
}));
vi.mock('./slack-import', () => ({
  SlackImport: (props: {
    historyOnly?: boolean;
    trigger: (open: (opener: unknown) => void) => JSX.Element;
  }) => {
    host.slackImport = props;
    return <>{props.trigger(host.openHistory)}</>;
  },
}));
vi.mock('@app/features/connector-import/connector-import', () => ({
  ConnectorImportPromotion: (props: NonNullable<typeof host.promotion>) => {
    host.promotion = props;
    return props.applies ? <p>Shared import card</p> : null;
  },
}));

beforeEach(() => {
  host.enabled = true;
  host.admin = true;
  host.promotion = undefined;
  host.slackImport = undefined;
  host.openHistory.mockReset();
  host.openNewChannel.mockReset();
});
afterEach(cleanup);

describe('Slack import sidebar', () => {
  it('renders the shared channels card with history import as its alternative', async () => {
    render(() => <SlackImportSidebar />);
    expect(screen.getByText('Shared import card')).toBeTruthy();
    expect(host.promotion?.category).toBe('channels');
    // The archive dialog loads behind the card.
    await vi.waitFor(() => expect(host.slackImport?.historyOnly).toBe(true));
    expect(host.promotion?.alternatives[0]?.label).toBe('Import with history');
    const opener = document.createElement('button');
    host.promotion?.alternatives[0]?.onSelect(opener);
    expect(host.openHistory).toHaveBeenCalledWith(opener);
  });

  it('offers creating a channel beside the import', () => {
    render(() => <SlackImportSidebar />);
    expect(host.promotion?.actionLabel).toBe('Import Slack');
    expect(host.promotion?.secondaryAction?.label).toBe('New channel');
    host.promotion?.secondaryAction?.onClick(document.createElement('button'));
    expect(host.openNewChannel).toHaveBeenCalledOnce();
  });

  it.each([
    { enabled: false, admin: true },
    { enabled: true, admin: false },
  ])('preserves the feature and admin gates: %o', (gate) => {
    Object.assign(host, gate);
    render(() => <SlackImportSidebar />);
    expect(screen.queryByText('Shared import card')).toBeNull();
  });
});
