import type { ImportEntity, ImportState } from '@queries/import';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlackChannelImportCard } from './SlackChannelImportCard';

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  importChannels: vi.fn(),
  failure: vi.fn(),
}));
const [state, setState] = createSignal<ImportState>({ runs: [], entities: [] });

vi.mock('@core/context/user', () => ({ useUserId: () => () => 'me' }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@queries/import', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@queries/import')>()),
  useImportQuery: () => ({
    isSuccess: true,
    get data() {
      return state();
    },
  }),
  useDiscoverMutation: () => ({ mutate: mocks.discover, isPending: false }),
  useRunImportMutation: () => ({
    mutate: mocks.importChannels,
    isPending: false,
  }),
}));
// Test the card's controls without unrelated app theme/layout dependencies.
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock('../../primitives', () => ({
  SettingsSection: (props: { title: string; children: JSX.Element }) => (
    <section aria-label={props.title}>{props.children}</section>
  ),
  SettingsCard: (props: { children: JSX.Element }) => (
    <div>{props.children}</div>
  ),
}));

function channel(
  id: string,
  overrides: Partial<ImportEntity> = {}
): ImportEntity {
  return {
    id,
    foreign_id: `C${id}`,
    source: 'slack',
    status: 'staged',
    initiator: 'manual',
    user_id: 'me',
    created_at: '',
    updated_at: '',
    metadata: { name: id, members_resolved: true, participants: [] },
    ...overrides,
  };
}

function checkbox(name: string): HTMLInputElement {
  return screen.getByRole('checkbox', { name }) as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  setState({ runs: [], entities: [] });
});
afterEach(cleanup);

describe('Slack channel import card', () => {
  it('discovers Slack and disables refresh during a running gather', () => {
    render(() => <SlackChannelImportCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Find channels' }));
    expect(mocks.discover).toHaveBeenCalledWith('slack', expect.any(Object));
    setState({
      runs: [
        {
          source: 'slack',
          status: 'running',
          auto_import: false,
          updated_at: '',
        },
      ],
      entities: [],
    });
    expect(
      (screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      screen.getByText('Finding channels and checking members…')
    ).toBeTruthy();
  });

  it('selects only visible staged channels, preserves hidden selections and clears on success', () => {
    setState({
      runs: [],
      entities: [
        channel('general'),
        channel('archive', { metadata: { name: 'archive', archived: true } }),
        channel('existing', { status: 'imported' }),
      ],
    });
    render(() => <SlackChannelImportCard />);
    expect(
      screen.queryByRole('checkbox', { name: 'Select archive' })
    ).toBeNull();
    expect(
      screen.queryByRole('checkbox', { name: 'Select existing' })
    ).toBeNull();
    fireEvent.click(checkbox('Select all visible'));
    expect(checkbox('Select general').checked).toBe(true);
    fireEvent.click(checkbox('Show archived'));
    expect(checkbox('Select all visible').indeterminate).toBe(true);
    fireEvent.click(checkbox('Select archive'));
    fireEvent.input(screen.getByRole('searchbox'), {
      target: { value: 'no match' },
    });
    expect(screen.getByText('No matching channels.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 channels' }));
    expect(mocks.importChannels).toHaveBeenCalledWith(
      { importIds: ['general', 'archive'], discardIds: [] },
      expect.any(Object)
    );
    mocks.importChannels.mock.calls[0][1].onSuccess();
    expect(
      (
        screen.getByRole('button', {
          name: 'Import 0 channels',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it('updates selected rows to importing and then links to a teammate import', () => {
    setState({ runs: [], entities: [channel('general')] });
    render(() => <SlackChannelImportCard />);
    fireEvent.click(checkbox('Select general'));
    setState({
      runs: [],
      entities: [channel('general', { status: 'importing' })],
    });
    expect(screen.getByText('Importing…')).toBeTruthy();
    expect(
      screen.queryByRole('checkbox', { name: 'Select general' })
    ).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: 'Import 0 channels',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    setState({
      runs: [],
      entities: [
        channel('general', {
          status: 'imported',
          user_id: 'teammate',
          entity_id: 'macro-channel',
          entity_type: 'channel',
        }),
      ],
    });
    expect(
      screen
        .getByRole('link', { name: 'Open imported channel general' })
        .getAttribute('href')
    ).toContain('/app/channel/macro-channel');
    expect(screen.getByText('by a teammate', { exact: false })).toBeTruthy();
  });

  it('shows empty and failed discoveries with retry', () => {
    setState({
      runs: [
        {
          source: 'slack',
          status: 'ready',
          auto_import: false,
          updated_at: '',
        },
      ],
      entities: [],
    });
    render(() => <SlackChannelImportCard />);
    expect(screen.getByText('No public channels found')).toBeTruthy();
    setState({
      runs: [
        {
          source: 'slack',
          status: 'failed',
          error: 'Slack is not connected',
          auto_import: false,
          updated_at: '',
        },
      ],
      entities: [],
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'Slack is not connected'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.discover).toHaveBeenCalledWith('slack', expect.any(Object));
    mocks.discover.mock.calls[0][1].onError();
    expect(mocks.failure).toHaveBeenCalledWith('Failed to find Slack channels');
  });

  it('retains the selection and shows a toast when importing fails', () => {
    setState({ runs: [], entities: [channel('general')] });
    render(() => <SlackChannelImportCard />);
    fireEvent.click(checkbox('Select general'));
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 channel' }));
    expect(mocks.importChannels).toHaveBeenCalledWith(
      { importIds: ['general'], discardIds: [] },
      expect.any(Object)
    );
    mocks.importChannels.mock.calls[0][1].onError();
    expect(mocks.failure).toHaveBeenCalledWith(
      'Failed to import Slack channels'
    );
    expect(checkbox('Select general').checked).toBe(true);
  });
});
