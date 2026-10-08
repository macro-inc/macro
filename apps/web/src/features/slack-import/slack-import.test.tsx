import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importReceipt } from './tests/fake-sources';

const host = vi.hoisted(() => ({
  enabled: true,
  channels: vi.fn(() => ({ isSuccess: false, data: [] as { id: string }[] })),
  invalidateChannels: vi.fn(async () => {}),
  invalidateSoup: vi.fn(),
  revalidate: vi.fn(async () => {}),
  createSource: vi.fn(),
  view: vi.fn(),
  props: undefined as
    | {
        onCompleted(): Promise<void>;
        channelHref(id: string): string | undefined;
      }
    | undefined,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: host.enabled }),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableSlackArchiveImport: {},
}));
vi.mock('@core/util/reloadForNewerBuild', () => ({
  holdAutomaticReload: vi.fn(),
}));
vi.mock('@queries/channel/channels', () => ({
  useListChannelsQuery: host.channels,
  invalidateListChannels: host.invalidateChannels,
}));
vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('@queries/soup/graphql/channel-list-revalidation', () => ({
  revalidateChannelLists: host.revalidate,
}));
vi.mock('@queries/soup/normalized-cache', () => ({
  invalidateAllSoup: host.invalidateSoup,
}));
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({}),
}));
vi.mock('@service-storage/slack-import-upload', () => ({
  uploadSlackImport: vi.fn(),
}));
vi.mock('./queries/import-source', () => ({
  createImportSource: host.createSource,
}));
vi.mock('./queries/archive-source', () => ({
  createArchiveSource: vi.fn(),
  protectImportFile: vi.fn(),
}));
vi.mock('./views/import-dialog', async () => {
  const { useImportContext } = await import('./context/import-context');
  return {
    ImportDialog: (
      props: NonNullable<typeof host.props> & { teamId: string }
    ) => {
      host.view(props.teamId);
      host.props = props;
      useImportContext().createSource({
        teamId: () => props.teamId,
        jobId: () => undefined,
        enabled: () => true,
      });
      return <p>Mounted import</p>;
    },
  };
});

import { SlackImport } from './slack-import';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  host.enabled = true;
});

describe('Slack import production boundary', () => {
  it.each([
    { isAdmin: false, enabled: true },
    { isAdmin: true, enabled: false },
  ])('mounts no queries for $isAdmin admin / $enabled flag', (gate) => {
    host.enabled = gate.enabled;
    render(() => <SlackImport teamId="team" isAdmin={gate.isAdmin} />);
    expect(screen.queryByText('Mounted import')).toBeNull();
    expect(host.channels).not.toHaveBeenCalled();
    expect(host.createSource).not.toHaveBeenCalled();
  });

  it('remounts on team changes, unmounts on role revocation and wires all completion refreshes', async () => {
    const [admin, setAdmin] = createSignal(true);
    const [teamId, setTeamId] = createSignal('one');
    render(() => <SlackImport teamId={teamId()} isAdmin={admin()} />);
    await screen.findByText('Mounted import');
    expect(host.createSource).toHaveBeenCalledOnce();
    await host.props!.onCompleted();
    expect(host.invalidateChannels).toHaveBeenCalledOnce();
    expect(host.invalidateSoup).toHaveBeenCalledOnce();
    expect(host.revalidate).toHaveBeenCalledOnce();
    expect(host.props!.channelHref(importReceipt().jobId)).toBeUndefined();
    setTeamId('two');
    await waitFor(() => expect(host.view).toHaveBeenLastCalledWith('two'));
    setAdmin(false);
    expect(screen.queryByText('Mounted import')).toBeNull();
  });
});
