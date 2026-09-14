/**
 * @vitest-environment jsdom
 */

import { Model } from '@core/component/AI/constant/model';
import { useAgentModelsQueries } from '@queries/agents/models';
import type { LoadAgentModelsResponse } from '@service-agent-harness/generated/schemas';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import { Suspense } from 'solid-js';
import { createStore } from 'solid-js/store';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agents } from './Agents';

const [searchParams, updateSearchParams] = createStore<{
  createAgent?: string;
}>({});
const setSearchParams = vi.fn((next: { createAgent?: string }) =>
  updateSearchParams(next)
);

vi.mock('@solidjs/router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@solidjs/router')>()),
  useSearchParams: () => [searchParams, setSearchParams],
}));

const cursorMocks = vi.hoisted(() => ({
  status: {
    isSuccess: true,
    isError: false,
    data: {
      registered: false,
      updatedAt: null as string | null,
    },
  },
}));

const agentMocks = vi.hoisted(() => ({
  query: {
    isSuccess: true,
    isPending: false,
    data: [] as unknown[],
    isError: false,
  },
  create: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
  toastSuccess: vi.fn(),
  toastFailure: vi.fn(),
  currentUserId: 'macro|user@example.com',
  currentTeam: { team: { id: 'team-1' } } as { team: { id: string } } | null,
  isTeamOwner: false,
}));

vi.mock('@queries/auth/cursor-api-key', () => ({
  useCursorApiKeyStatusQuery: () => cursorMocks.status,
}));

const modelMocks = vi.hoisted(() => ({
  queries: {} as Record<
    string,
    {
      data?: {
        status: 'available' | 'unsupported';
        currentModel?: string | null;
        models: { id: string; name: string; description?: string | null }[];
      };
      isPending: boolean;
      isError: boolean;
      isSuccess: boolean;
      refetch: ReturnType<typeof vi.fn>;
    }
  >,
}));

function modelTargetKey(target: {
  harness: string;
  harnessId?: string;
}): string {
  return `${target.harness}:${target.harnessId ?? ''}`;
}

function successfulModels(
  models: { id: string; name: string }[],
  currentModel = models[0]?.id
) {
  return {
    data: {
      status: 'available' as const,
      currentModel,
      models,
    },
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  };
}

vi.mock('@queries/agents/models', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@queries/agents/models')>();
  return {
    ...actual,
    useAgentModelsQueries: vi.fn(
      (targets: () => { harness: string; harnessId?: string }[]) =>
        targets().map(
          (target) =>
            modelMocks.queries[modelTargetKey(target)] ?? {
              isPending: true,
              isError: false,
              isSuccess: false,
              refetch: vi.fn(),
            }
        )
    ),
  };
});

const harnessMocks = vi.hoisted(() => ({
  query: {
    isSuccess: true,
    isPending: false,
    data: [] as unknown[],
  },
}));

vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessesQuery: () => harnessMocks.query,
}));

vi.mock('@queries/agents/agents', () => ({
  useAgentsQuery: () => agentMocks.query,
  useCreateAgentMutation: () => ({
    mutateAsync: agentMocks.create,
    isPending: false,
  }),
  useDeleteAgentMutation: () => ({
    mutateAsync: agentMocks.delete,
    isPending: false,
  }),
  useUpdateAgentMutation: () => ({
    mutateAsync: agentMocks.update,
    isPending: false,
  }),
}));

vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    data: agentMocks.currentTeam,
    isSuccess: true,
  }),
  useIsTeamOwner: () => () => agentMocks.isTeamOwner,
}));

vi.mock('@core/context/user', () => ({
  useUserId: () => () => agentMocks.currentUserId,
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    success: agentMocks.toastSuccess,
    failure: agentMocks.toastFailure,
  },
}));

vi.mock('@core/context/channels', () => ({
  useChannelsContext: () => ({
    channels: () => [
      { id: 'channel-general', name: 'general', channel_type: 'private' },
      {
        id: 'channel-engineering',
        name: 'engineering',
        channel_type: 'team',
      },
    ],
  }),
}));

const pipedreamMocks = vi.hoisted(() => ({
  enabled: true,
  connected: [] as string[],
  connect: vi.fn(),
  catalog: [
    {
      app_slug: 'linear',
      display_name: 'Linear',
      description: 'Issue tracking',
      icon_url: null,
    },
    {
      app_slug: 'notion',
      display_name: 'Notion',
      description: 'Docs and wikis',
      icon_url: null,
    },
  ],
}));

vi.mock('@core/pipedream/flag', () => ({
  usePipedreamMcpFlag: () => () => pipedreamMocks.enabled,
}));

vi.mock('@queries/pipedream-connectors', () => ({
  usePipedreamConnectedSlugs: () => ({
    slugs: () => new Set(pipedreamMocks.connected),
    ready: () => true,
  }),
  usePipedreamCatalogQuery: (search: () => string) => ({
    get data() {
      const term = search().trim().toLowerCase();
      return {
        pages: [
          {
            servers: pipedreamMocks.catalog.filter((entry) =>
              entry.display_name.toLowerCase().includes(term)
            ),
            next_cursor: null,
          },
        ],
        pageParams: [undefined],
      };
    },
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    isError: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  connectPipedreamApp: pipedreamMocks.connect,
}));

beforeAll(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

beforeEach(() => {
  updateSearchParams({ createAgent: undefined });
  setSearchParams.mockClear();
  cursorMocks.status.data = {
    registered: false,
    updatedAt: null,
  };
  agentMocks.query.data = [];
  agentMocks.query.isError = false;
  agentMocks.create.mockResolvedValue(undefined);
  agentMocks.delete.mockResolvedValue(undefined);
  agentMocks.update.mockResolvedValue(undefined);
  agentMocks.currentUserId = 'macro|user@example.com';
  agentMocks.currentTeam = { team: { id: 'team-1' } };
  agentMocks.isTeamOwner = false;
  harnessMocks.query.data = [];
  pipedreamMocks.enabled = true;
  pipedreamMocks.connected = [];
  pipedreamMocks.connect.mockReset();
  pipedreamMocks.connect.mockImplementation(
    async (args: { appSlug: string }) => {
      pipedreamMocks.connected = [...pipedreamMocks.connected, args.appSlug];
      return 'connected';
    }
  );
  modelMocks.queries = {
    'in-memory:': successfulModels([
      { id: Model.sonnet5, name: 'Claude Sonnet 4.5' },
      { id: Model.opus5, name: 'Claude Opus 4.5' },
    ]),
  };
});

const MACROD_HARNESS = {
  id: '3f1c9d2e-8a4b-4c5d-9e6f-1a2b3c4d5e6f',
  kind: 'macrod',
  name: 'Dev box',
  owner: { type: 'user', user_id: 'macro|user@example.com' },
  created_by: 'macro|user@example.com',
  created_at: '2026-08-27T12:00:00Z',
  updated_at: '2026-08-27T12:00:00Z',
  connected: true,
  last_connected_at: '2026-08-27T12:34:00Z',
};

describe('Agents', () => {
  it('opens the new-agent form from a link and clears the action on cancel', () => {
    updateSearchParams({ createAgent: 'true' });
    render(() => <Agents />);
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('button', { name: 'Create agent' })
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(setSearchParams).toHaveBeenCalledWith(
      { createAgent: undefined },
      { replace: true }
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['success', 'error'] as const)(
    'keeps settings visible while Cursor models load and after %s',
    async (outcome) => {
      cursorMocks.status.data.registered = true;
      let resolveModels!: (models: LoadAgentModelsResponse) => void;
      let rejectModels!: (error: Error) => void;
      const response = new Promise<LoadAgentModelsResponse>(
        (resolve, reject) => {
          resolveModels = resolve;
          rejectModels = reject;
        }
      );
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      vi.mocked(useAgentModelsQueries).mockImplementationOnce((targets) =>
        targets().map((target) =>
          useQuery(() => ({
            queryKey: ['pending-models', target.harness],
            queryFn: () =>
              target.harness === 'cursor'
                ? response
                : Promise.resolve(successfulModels([]).data),
          }))
        )
      );
      const view = render(() => (
        <QueryClientProvider client={client}>
          <Suspense fallback={<p>Settings suspended</p>}>
            <Agents />
          </Suspense>
        </QueryClientProvider>
      ));
      fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));
      fireEvent.change(screen.getByRole('combobox', { name: 'Harness' }), {
        target: { value: 'cursor' },
      });
      expect(screen.queryByText('Settings suspended')).toBeNull();
      expect(screen.getByText('Loading models…')).toBeTruthy();
      expect(
        (
          screen.getByRole('combobox', {
            name: 'Default model',
          }) as HTMLSelectElement
        ).disabled
      ).toBe(true);

      if (outcome === 'error') {
        rejectModels(new Error('Cursor is unavailable'));
        await waitFor(() =>
          expect(
            screen.getByText(/Could not load models for Cursor/)
          ).toBeTruthy()
        );
        expect(screen.queryByText('Settings suspended')).toBeNull();
        expect(
          screen.getByRole('button', { name: 'Retry models for Cursor' })
        ).toBeTruthy();
      } else {
        resolveModels({
          status: 'available',
          currentModel: 'loaded-model',
          models: [
            {
              id: 'loaded-model',
              name: 'Loaded Model',
              group: 'Cursor',
            },
          ],
        });
        await waitFor(() =>
          expect(
            screen.getByRole('option', { name: 'Loaded Model' })
          ).toBeTruthy()
        );
        expect(screen.queryByText('Settings suspended')).toBeNull();
        expect(
          (
            screen.getByRole('combobox', {
              name: 'Default model',
            }) as HTMLSelectElement
          ).disabled
        ).toBe(false);
      }
      view.unmount();
      client.clear();
    }
  );

  it('lists the built-in global Macro agent as a team agent', () => {
    render(() => <Agents />);

    const teamSection = screen
      .getByRole('heading', { name: 'Team agents' })
      .closest('section') as HTMLElement;
    const privateSection = screen
      .getByRole('heading', { name: 'Private agents' })
      .closest('section') as HTMLElement;

    expect(within(teamSection).getByText('Macro')).toBeTruthy();
    expect(within(teamSection).getByText('@macro')).toBeTruthy();
    expect(within(teamSection).getByText('Team')).toBeTruthy();
    expect(within(teamSection).getByText(/All channels/)).toBeTruthy();
    expect(
      within(teamSection).queryByRole('button', { name: 'Delete Macro' })
    ).toBeNull();
    expect(
      within(privateSection).getByText('No private agents yet.')
    ).toBeTruthy();
  });

  it('groups server agents into team and private sections', () => {
    agentMocks.query.data = [
      {
        bot: {
          id: 'agent-1',
          kind: 'owned',
          owner: { type: 'user', user_id: 'macro|user@example.com' },
          name: 'Bug fixer',
          handle: 'bug-fixer',
          description: 'Finds and fixes bugs.',
          has_agent: true,
          created_at: '2026-08-27T12:00:00Z',
          updated_at: '2026-08-27T12:00:00Z',
        },
        instructions: 'Fix the root cause.',
        harness: 'in-memory',
        default_model: Model.sonnet5,
        channel_scope: 'all',
        channel_ids: [],
      },
      {
        bot: {
          id: 'agent-2',
          kind: 'owned',
          owner: { type: 'team', team_id: 'team-1' },
          name: 'Release helper',
          handle: 'release-helper',
          description: 'Coordinates releases.',
          has_agent: true,
          created_at: '2026-08-27T12:00:00Z',
          updated_at: '2026-08-27T12:00:00Z',
        },
        instructions: 'Keep releases moving.',
        harness: 'in-memory',
        default_model: Model.sonnet5,
        channel_scope: 'selected',
        channel_ids: ['channel-engineering'],
      },
    ];

    render(() => <Agents />);

    const teamSection = screen
      .getByRole('heading', { name: 'Team agents' })
      .closest('section') as HTMLElement;
    const privateSection = screen
      .getByRole('heading', { name: 'Private agents' })
      .closest('section') as HTMLElement;

    expect(within(teamSection).getByText('Macro')).toBeTruthy();
    expect(within(teamSection).getByText('Release helper')).toBeTruthy();
    expect(within(teamSection).queryByText('Coordinates releases.')).toBeNull();
    expect(within(teamSection).queryByText('Bug fixer')).toBeNull();

    const agentName = within(privateSection).getByText('Bug fixer');
    expect(within(privateSection).getByText('@bug-fixer')).toBeTruthy();
    expect(
      within(privateSection).queryByText('Finds and fixes bugs.')
    ).toBeNull();
    expect(within(privateSection).queryByText('Release helper')).toBeNull();
    expect(
      within(agentName.parentElement?.parentElement as HTMLElement).getByText(
        /All channels/
      )
    ).toBeTruthy();
  });

  it('edits and persists an existing agent through the agents API', async () => {
    agentMocks.query.data = [
      {
        bot: {
          id: 'agent-1',
          kind: 'owned',
          owner: { type: 'user', user_id: 'macro|user@example.com' },
          name: 'Bug fixer',
          handle: 'bug-fixer',
          description: 'Finds and fixes bugs.',
          has_agent: true,
          created_at: '2026-08-27T12:00:00Z',
          updated_at: '2026-08-27T12:00:00Z',
        },
        instructions: 'Fix the root cause.',
        harness: 'in-memory',
        default_model: Model.sonnet5,
        channel_scope: 'selected',
        channel_ids: ['channel-engineering'],
      },
    ];

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Bug fixer' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Edit agent')).toBeTruthy();
    expect(within(dialog).getByLabelText('Name')).toHaveProperty(
      'value',
      'Bug fixer'
    );
    expect(within(dialog).getByLabelText('@tag')).toHaveProperty(
      'value',
      'bug-fixer'
    );
    expect(within(dialog).getByLabelText('Specific channels')).toHaveProperty(
      'checked',
      true
    );

    fireEvent.input(within(dialog).getByLabelText('Name'), {
      target: { value: 'Bug resolver' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Save changes' })
    );

    await waitFor(() => {
      expect(agentMocks.update).toHaveBeenCalledWith({
        agentId: 'agent-1',
        avatarUrl: undefined,
        channelIds: ['channel-engineering'],
        channelScope: 'selected',
        defaultModel: Model.sonnet5,
        description: 'Finds and fixes bugs.',
        handle: 'bug-fixer',
        harness: 'in-memory',
        name: 'Bug resolver',
        instructions: 'Fix the root cause.',
        mcp: { scope: 'owner_connections' },
        teamId: undefined,
      });
      expect(agentMocks.toastSuccess).toHaveBeenCalledWith('Agent updated');
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('lets team members edit without deleting or privatizing another creator agent', () => {
    agentMocks.query.data = [
      {
        bot: {
          id: 'agent-1',
          kind: 'owned',
          owner: { type: 'team', team_id: 'team-1' },
          name: 'Bug fixer',
          handle: 'bug-fixer',
          description: 'Finds and fixes bugs.',
          created_by: 'macro|creator@example.com',
          has_agent: true,
          created_at: '2026-08-27T12:00:00Z',
          updated_at: '2026-08-27T12:00:00Z',
        },
        instructions: 'Fix the root cause.',
        harness: 'in-memory',
        default_model: Model.sonnet5,
        channel_scope: 'all',
        channel_ids: [],
      },
    ];

    render(() => <Agents />);

    expect(screen.getByRole('button', { name: 'Edit Bug fixer' })).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Delete Bug fixer' })
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Bug fixer' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Team')).toHaveProperty(
      'checked',
      true
    );
    expect(within(dialog).getByLabelText('Private')).toHaveProperty(
      'disabled',
      true
    );
    expect(
      within(dialog).getByText('Only the agent creator can make it private.')
    ).toBeTruthy();
  });

  it('lets the creator privatize and the team owner delete a team agent', () => {
    agentMocks.query.data = [
      {
        bot: {
          id: 'agent-1',
          kind: 'owned',
          owner: { type: 'team', team_id: 'team-1' },
          name: 'Bug fixer',
          handle: 'bug-fixer',
          description: 'Finds and fixes bugs.',
          created_by: 'macro|user@example.com',
          has_agent: true,
          created_at: '2026-08-27T12:00:00Z',
          updated_at: '2026-08-27T12:00:00Z',
        },
        instructions: 'Fix the root cause.',
        harness: 'in-memory',
        default_model: Model.sonnet5,
        channel_scope: 'all',
        channel_ids: [],
      },
    ];

    const view = render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Bug fixer' }));
    expect(
      within(screen.getByRole('dialog')).getByLabelText('Private')
    ).toHaveProperty('disabled', false);
    view.unmount();

    agentMocks.currentUserId = 'macro|team-owner@example.com';
    agentMocks.isTeamOwner = true;
    render(() => <Agents />);
    expect(
      screen.getByRole('button', { name: 'Delete Bug fixer' })
    ).toBeTruthy();
  });

  it('confirms before deleting a created agent', async () => {
    agentMocks.query.data = [
      {
        bot: {
          id: 'agent-1',
          kind: 'owned',
          owner: { type: 'user', user_id: 'macro|user@example.com' },
          name: 'Bug fixer',
          handle: 'bug-fixer',
          description: 'Finds and fixes bugs.',
          has_agent: true,
          created_at: '2026-08-27T12:00:00Z',
          updated_at: '2026-08-27T12:00:00Z',
        },
        instructions: 'Fix the root cause.',
        harness: 'in-memory',
        default_model: Model.sonnet5,
        channel_scope: 'selected',
        channel_ids: ['channel-engineering'],
      },
    ];

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Bug fixer' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete Bug fixer?')).toBeTruthy();
    expect(agentMocks.delete).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete agent' })
    );

    await waitFor(() => {
      expect(agentMocks.delete).toHaveBeenCalledWith({
        agentId: 'agent-1',
        channelIds: ['channel-engineering'],
      });
      expect(agentMocks.toastSuccess).toHaveBeenCalledWith('Agent deleted');
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('offers agent configuration without description and only connected harnesses', () => {
    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));

    const dialog = screen.getByRole('dialog');
    const harness = within(dialog).getByLabelText('Harness');

    expect(
      within(dialog).getByRole('button', { name: 'Upload avatar' })
    ).toBeTruthy();
    const avatarInput = dialog.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(avatarInput, {
      target: {
        files: [
          new File(['avatar'], 'agent-avatar.png', { type: 'image/png' }),
        ],
      },
    });
    expect(within(dialog).queryByText('agent-avatar.png')).toBeNull();
    expect(
      within(dialog).getByText('Optional · square images work best')
    ).toBeTruthy();
    expect(within(dialog).getByLabelText('Name')).toBeTruthy();
    expect(within(dialog).getByLabelText('@tag')).toBeTruthy();
    expect(within(dialog).queryByLabelText('Description')).toBeNull();
    expect(within(dialog).getByLabelText('System prompt')).toBeTruthy();
    expect(harness).toHaveProperty('value', 'in-memory');
    expect(within(harness).getAllByRole('option')).toHaveLength(1);
    expect(within(dialog).getByLabelText('Default model')).toBeTruthy();
    expect(
      within(dialog).getByRole('group', { name: 'Channels' })
    ).toBeTruthy();
    expect(within(dialog).getByRole('group', { name: 'Share' })).toBeTruthy();

    fireEvent.click(within(dialog).getByLabelText('Specific channels'));
    const channelSearch =
      within(dialog).getByPlaceholderText('Search channels…');
    fireEvent.input(channelSearch, { target: { value: 'gen' } });
    expect(screen.getByRole('option', { name: 'general' })).toBeTruthy();
  });

  it('explains why team sharing is disabled without a team', () => {
    agentMocks.currentTeam = null;

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));

    const dialog = screen.getByRole('dialog');
    const teamOption = within(dialog).getByLabelText('Team');
    expect(teamOption).toHaveProperty('disabled', true);
    const teamCardClasses = teamOption.closest('label')?.classList;
    expect(teamCardClasses?.contains('cursor-not-allowed')).toBe(true);
    expect(teamCardClasses?.contains('opacity-50')).toBe(true);
    expect(
      within(dialog).getByText(
        'Team agents need a team owner. Create or join a team in Team settings to enable this option.'
      )
    ).toBeTruthy();
  });

  it('persists creation through the agents API', async () => {
    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.input(within(dialog).getByLabelText('Name'), {
      target: { value: 'Bug fixer' },
    });
    fireEvent.input(within(dialog).getByLabelText('System prompt'), {
      target: { value: 'Fix the root cause and add tests.' },
    });
    fireEvent.click(within(dialog).getByLabelText('Team'));
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create agent' })
    );

    await waitFor(() => {
      expect(agentMocks.create).toHaveBeenCalledWith({
        avatarUrl: undefined,
        channelIds: [],
        channelScope: 'all',
        defaultModel: Model.sonnet5,
        handle: 'bug-fixer',
        harness: 'in-memory',
        name: 'Bug fixer',
        instructions: 'Fix the root cause and add tests.',
        mcp: { scope: 'owner_connections' },
        teamId: 'team-1',
      });
      expect(agentMocks.toastSuccess).toHaveBeenCalledWith('Agent created');
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('offers Cursor and its models when Cursor is connected', () => {
    cursorMocks.status.data = {
      registered: true,
      updatedAt: '2026-08-27T12:00:00Z',
    };
    modelMocks.queries['cursor:'] = successfulModels([
      { id: 'cursor-small', name: 'Cursor Small' },
      { id: 'cursor-large', name: 'Cursor Large' },
    ]);

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));

    const dialog = screen.getByRole('dialog');
    const harness = within(dialog).getByLabelText('Harness');
    expect(within(harness).getAllByRole('option')).toHaveLength(2);

    fireEvent.change(harness, { target: { value: 'cursor' } });
    expect(harness).toHaveProperty('value', 'cursor');

    const defaultModel = within(dialog).getByLabelText('Default model');
    expect(within(defaultModel).getAllByRole('option')).toHaveLength(2);
    expect(
      within(defaultModel).getByRole('option', { name: 'Cursor Small' })
    ).toHaveProperty('selected', true);
  });

  it('offers registered macrod harnesses in the harness picker', () => {
    harnessMocks.query.data = [MACROD_HARNESS];

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));

    const dialog = screen.getByRole('dialog');
    const harness = within(dialog).getByLabelText('Harness');
    expect(within(harness).getAllByRole('option')).toHaveLength(2);
    expect(
      within(harness).getByRole('option', { name: 'Dev box' })
    ).toBeTruthy();
  });

  it('keeps loading, error, and unsupported states independent per harness', () => {
    cursorMocks.status.data = {
      registered: true,
      updatedAt: '2026-08-27T12:00:00Z',
    };
    const loadingHarness = {
      ...MACROD_HARNESS,
      id: '4f1c9d2e-8a4b-4c5d-9e6f-1a2b3c4d5e70',
      name: 'Loading box',
    };
    harnessMocks.query.data = [MACROD_HARNESS, loadingHarness];
    const retry = vi.fn();
    modelMocks.queries['cursor:'] = {
      isPending: false,
      isError: true,
      isSuccess: false,
      refetch: retry,
    };
    modelMocks.queries[`macrod:${MACROD_HARNESS.id}`] = {
      data: { status: 'unsupported', models: [] },
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    };
    modelMocks.queries[`macrod:${loadingHarness.id}`] = {
      isPending: true,
      isError: false,
      isSuccess: false,
      refetch: vi.fn(),
    };

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));
    const dialog = screen.getByRole('dialog');
    const harness = within(dialog).getByLabelText('Harness');

    expect(
      within(dialog).getByRole('option', { name: 'Claude Sonnet 4.5' })
    ).toBeTruthy();

    fireEvent.change(harness, { target: { value: 'cursor' } });
    expect(
      within(dialog).getByText(/Could not load models for Cursor/)
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Retry models for Cursor' })
    );
    expect(retry).toHaveBeenCalledOnce();

    fireEvent.change(harness, { target: { value: MACROD_HARNESS.id } });
    expect(
      within(dialog).getByText(
        'Model selection is unsupported by this harness.'
      )
    ).toBeTruthy();

    fireEvent.change(harness, { target: { value: loadingHarness.id } });
    expect(within(dialog).getByText('Loading models…')).toBeTruthy();
  });

  it('uses the discovered model selector for macrod harnesses', () => {
    harnessMocks.query.data = [MACROD_HARNESS];
    modelMocks.queries[`macrod:${MACROD_HARNESS.id}`] = successfulModels(
      [
        { id: 'claude-code', name: 'Claude Code' },
        { id: 'codex', name: 'Codex' },
      ],
      'codex'
    );

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));

    const dialog = screen.getByRole('dialog');
    const harness = within(dialog).getByLabelText('Harness');
    fireEvent.change(harness, { target: { value: MACROD_HARNESS.id } });

    const defaultModel = within(dialog).getByLabelText('Default model');
    expect(defaultModel.tagName).toBe('SELECT');
    expect(defaultModel).toHaveProperty('value', 'codex');
    expect(within(defaultModel).getAllByRole('option')).toHaveLength(2);
  });

  it('falls back to the first advertised model when current is absent', () => {
    harnessMocks.query.data = [MACROD_HARNESS];
    modelMocks.queries[`macrod:${MACROD_HARNESS.id}`] = successfulModels(
      [
        { id: 'claude-code', name: 'Claude Code' },
        { id: 'codex', name: 'Codex' },
      ],
      'retired-model'
    );

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Harness'), {
      target: { value: MACROD_HARNESS.id },
    });

    expect(within(dialog).getByLabelText('Default model')).toHaveProperty(
      'value',
      'claude-code'
    );
  });

  it('shows the current model when an available catalog has no options', () => {
    harnessMocks.query.data = [MACROD_HARNESS];
    modelMocks.queries[`macrod:${MACROD_HARNESS.id}`] = successfulModels(
      [],
      'provider-default'
    );

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Harness'), {
      target: { value: MACROD_HARNESS.id },
    });

    const defaultModel = within(dialog).getByLabelText('Default model');
    expect(defaultModel).toHaveProperty('value', 'provider-default');
    expect(
      within(defaultModel).getByRole('option', {
        name: 'provider-default (unavailable)',
      })
    ).toBeTruthy();
  });

  it('submits macrod agents with the macrod slug and harness id', async () => {
    harnessMocks.query.data = [MACROD_HARNESS];
    modelMocks.queries[`macrod:${MACROD_HARNESS.id}`] = successfulModels(
      [{ id: 'claude-code', name: 'Claude Code' }],
      'claude-code'
    );

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.input(within(dialog).getByLabelText('Name'), {
      target: { value: 'Bug fixer' },
    });
    fireEvent.change(within(dialog).getByLabelText('Harness'), {
      target: { value: MACROD_HARNESS.id },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create agent' })
    );

    await waitFor(() => {
      expect(agentMocks.create).toHaveBeenCalledWith({
        avatarUrl: undefined,
        channelIds: [],
        channelScope: 'all',
        defaultModel: 'claude-code',
        handle: 'bug-fixer',
        harness: 'macrod',
        harnessId: MACROD_HARNESS.id,
        name: 'Bug fixer',
        instructions: '',
        mcp: { scope: 'owner_connections' },
        teamId: undefined,
      });
    });
  });

  it('preserves and labels a saved model missing from the fresh catalog', () => {
    agentMocks.query.data = [
      {
        bot: {
          id: 'agent-1',
          kind: 'owned',
          owner: { type: 'user', user_id: 'macro|user@example.com' },
          name: 'Bug fixer',
          handle: 'bug-fixer',
          has_agent: true,
          created_at: '2026-08-27T12:00:00Z',
          updated_at: '2026-08-27T12:00:00Z',
        },
        instructions: 'Fix the root cause.',
        harness: 'in-memory',
        default_model: 'retired-model',
        channel_scope: 'all',
        channel_ids: [],
      },
    ];

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Bug fixer' }));

    const defaultModel = within(screen.getByRole('dialog')).getByLabelText(
      'Default model'
    );
    expect(defaultModel).toHaveProperty('value', 'retired-model');
    expect(
      within(defaultModel).getByRole('option', {
        name: 'retired-model (saved, unavailable)',
      })
    ).toBeTruthy();
  });

  it('preselects the bound macrod harness when editing', () => {
    harnessMocks.query.data = [MACROD_HARNESS];
    modelMocks.queries[`macrod:${MACROD_HARNESS.id}`] = successfulModels([
      { id: 'default', name: 'Harness default' },
    ]);
    agentMocks.query.data = [
      {
        bot: {
          id: 'agent-1',
          kind: 'owned',
          owner: { type: 'user', user_id: 'macro|user@example.com' },
          name: 'Bug fixer',
          handle: 'bug-fixer',
          description: 'Finds and fixes bugs.',
          has_agent: true,
          created_at: '2026-08-27T12:00:00Z',
          updated_at: '2026-08-27T12:00:00Z',
        },
        instructions: 'Fix the root cause.',
        harness: 'macrod',
        harness_id: MACROD_HARNESS.id,
        default_model: 'default',
        channel_scope: 'all',
        channel_ids: [],
      },
    ];

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Bug fixer' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Harness')).toHaveProperty(
      'value',
      MACROD_HARNESS.id
    );
    const defaultModel = within(dialog).getByLabelText('Default model');
    expect(defaultModel.tagName).toBe('SELECT');
    expect(defaultModel).toHaveProperty('value', 'default');
  });

  const linearAgent = {
    bot: {
      id: 'agent-mcp',
      kind: 'owned',
      owner: { type: 'team', team_id: 'team-1' },
      name: 'Triage bot',
      handle: 'triage-bot',
      has_agent: true,
      created_by: 'macro|user@example.com',
      created_at: '2026-08-27T12:00:00Z',
      updated_at: '2026-08-27T12:00:00Z',
    },
    instructions: '',
    harness: 'in-memory',
    default_model: Model.sonnet5,
    channel_scope: 'all',
    channel_ids: [],
    mcp: {
      scope: 'selected',
      servers: [
        { app_slug: 'linear', server_name: 'Linear' },
        { app_slug: 'notion', server_name: 'Notion' },
      ],
    },
  };

  it('hides the Connections section when the Pipedream stack is off but keeps the selection', async () => {
    pipedreamMocks.enabled = false;
    agentMocks.query.data = [linearAgent];
    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Triage bot' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText('Connections')).toBeNull();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Save changes' })
    );

    await waitFor(() => {
      expect(agentMocks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          mcp: { scope: 'selected', servers: linearAgent.mcp.servers },
        })
      );
    });
  });

  it('defaults new agents to the owner connections policy', () => {
    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByLabelText('Use my connected apps')
    ).toHaveProperty('checked', true);
    expect(within(dialog).queryByLabelText('Search connectors')).toBeNull();
  });

  it('picks apps from the whole catalog, shows the viewer connection state, and persists them', async () => {
    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.input(within(dialog).getByLabelText('Name'), {
      target: { value: 'Triage bot' },
    });
    fireEvent.click(within(dialog).getByLabelText('Specific apps'));

    // An explicit selection with nothing in it is not something to save.
    expect(
      within(dialog).getByRole('button', { name: 'Create agent' })
    ).toHaveProperty('disabled', true);

    fireEvent.input(within(dialog).getByLabelText('Search connectors'), {
      target: { value: 'lin' },
    });
    await waitFor(() => {
      expect(
        within(dialog).getByRole('option', { name: /Linear/ })
      ).toBeTruthy();
    });
    fireEvent.click(within(dialog).getByRole('option', { name: /Linear/ }));

    // The pick is listed as not connected for this viewer, with a way in.
    await waitFor(() => {
      expect(within(dialog).getByText('Linear')).toBeTruthy();
    });
    expect(within(dialog).getByLabelText('Not connected')).toBeTruthy();
    expect(
      within(dialog).getByRole('button', { name: 'Connect' })
    ).toBeTruthy();
    // ...and no longer offered by the search.
    fireEvent.input(within(dialog).getByLabelText('Search connectors'), {
      target: { value: 'lin' },
    });
    await waitFor(() => {
      expect(
        within(dialog).queryByRole('option', { name: /Linear/ })
      ).toBeNull();
    });

    // Unconnected picks never block saving: the agent's author chooses the
    // apps, each person connects their own.
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create agent' })
    );
    await waitFor(() => {
      expect(agentMocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mcp: {
            scope: 'selected',
            servers: [{ app_slug: 'linear', server_name: 'Linear' }],
          },
        })
      );
    });
  });

  it('connects a picked app in place and flips its indicator without saving', async () => {
    agentMocks.update.mockClear();
    agentMocks.query.data = [linearAgent];
    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Triage bot' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Specific apps')).toHaveProperty(
      'checked',
      true
    );
    expect(within(dialog).getAllByLabelText('Not connected')).toHaveLength(2);
    // Team agents say out loud that connections are per person.
    expect(within(dialog).getByText(/Connections are personal/)).toBeTruthy();

    // Linear is listed first; its row carries the first Connect action.
    fireEvent.click(
      within(dialog).getAllByRole('button', {
        name: 'Connect',
      })[0] as HTMLElement
    );

    await waitFor(() => {
      expect(pipedreamMocks.connect).toHaveBeenCalledWith(
        expect.objectContaining({ appSlug: 'linear', serverName: 'Linear' })
      );
    });
    expect(agentMocks.update).not.toHaveBeenCalled();

    // Removing one pick keeps the other.
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remove Notion' })
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Save changes' })
    );
    await waitFor(() => {
      expect(agentMocks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          mcp: {
            scope: 'selected',
            servers: [{ app_slug: 'linear', server_name: 'Linear' }],
          },
        })
      );
    });
  });
});
