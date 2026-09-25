/**
 * @vitest-environment jsdom
 */

import { Model } from '@core/component/AI/constant/model';
import { useAgentModelsQueries } from '@queries/agents/models';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import type { LoadAgentModelsResponse } from '@service-agent-harness/generated/schemas';
import type { Harness } from '@service-storage/client';
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
import { chooseSelectOption, selectOptions } from './tests/select-helpers';

// The real Lexical surface has its own Markdown round-trip suite.
vi.mock('./components/instructions-editor', () => ({
  AgentInstructionsEditor: (props: {
    markdown: string;
    disabled?: boolean;
    onChange: (markdown: string) => void;
  }) => (
    <textarea
      aria-label="Instructions"
      disabled={props.disabled}
      value={props.markdown}
      onInput={(event) => props.onChange(event.currentTarget.value)}
    />
  ),
}));

const claudeFlag = vi.hoisted(() => ({ enabled: true }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => {
    expect(flag.key).toBe('claude-cloud');
    return () => ({ enabled: claudeFlag.enabled });
  },
}));

vi.mock('@queries/claude-auth/connection', () => ({
  useClaudeConnectionSource: () => ({
    status: () => ({ enabled: true, connected: false, ephemeral: true }),
    failed: () => false,
    begin: vi.fn(),
    complete: vi.fn(),
    disconnect: vi.fn(),
    refresh: vi.fn(),
  }),
}));

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
  useHarnessesQuery: vi.fn(() => harnessMocks.query),
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
    isSuccess: true,
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
  allow_permission_bypass: false,
  id: '3f1c9d2e-8a4b-4c5d-9e6f-1a2b3c4d5e6f',
  kind: 'macrod',
  name: 'Dev box',
  owner: { type: 'user', user_id: 'macro|user@example.com' },
  created_by: 'macro|user@example.com',
  created_at: '2026-08-27T12:00:00Z',
  updated_at: '2026-08-27T12:00:00Z',
  connected: true,
  last_connected_at: '2026-08-27T12:34:00Z',
} satisfies Harness;

describe('Agents', () => {
  it.each([false, true])(
    'gates Claude harness selection and discovery when enabled=%s',
    (enabled) => {
      claudeFlag.enabled = enabled;
      modelMocks.queries['claude-cloud:'] = successfulModels([
        { id: 'claude-default', name: 'Subscription default' },
      ]);
      try {
        render(() => <Agents />);
        fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
        const option = selectOptions(
          screen.getByLabelText('Runtime')
        ).queryByRole('option', {
          name: 'Claude Cloud',
        });
        expect(Boolean(option)).toBe(enabled);
        const targets = vi.mocked(useAgentModelsQueries).mock.lastCall?.[0]();
        expect(
          targets?.some((target) => target.harness === 'claude-cloud')
        ).toBe(enabled);
      } finally {
        claudeFlag.enabled = true;
      }
    }
  );

  it('opens the new-agent form from a link and clears the action on cancel', () => {
    updateSearchParams({ createAgent: 'true' });
    render(() => <Agents />);
    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
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
      fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
      chooseSelectOption(screen.getByLabelText('Runtime'), 'Cursor');
      expect(screen.queryByText('Settings suspended')).toBeNull();
      expect(screen.getByText('Loading models…')).toBeTruthy();
      expect(
        (screen.getByLabelText('Default model') as HTMLButtonElement).disabled
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
          expect(screen.getByText('Loaded Model')).toBeTruthy()
        );
        expect(screen.queryByText('Settings suspended')).toBeNull();
        expect(
          (screen.getByLabelText('Default model') as HTMLButtonElement).disabled
        ).toBe(false);
      }
      view.unmount();
      client.clear();
    }
  );

  it('keeps a saved Claude harness selected while discovery loads and scopes Fable to it', async () => {
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
        harness: 'claude-cloud',
        default_model: 'claude-fable-5-1',
        channel_scope: 'all',
        channel_ids: [],
      },
    ];
    let resolveModels!: (models: LoadAgentModelsResponse) => void;
    const response = new Promise<LoadAgentModelsResponse>((resolve) => {
      resolveModels = resolve;
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(useAgentModelsQueries).mockImplementationOnce((targets) =>
      targets().map((target) =>
        useQuery(() => ({
          queryKey: ['pending-models', target.harness],
          queryFn: () =>
            target.harness === 'claude-cloud'
              ? response
              : Promise.resolve(modelMocks.queries['in-memory:'].data!),
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
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Edit Bug fixer' }));
      const harness = screen.getByLabelText('Runtime');
      expect(harness).toHaveProperty('textContent', 'Claude Cloud');
      expect(screen.getByText('Loading models…')).toBeTruthy();
      resolveModels({
        status: 'available',
        currentModel: 'claude-fable-5-1',
        models: [{ id: 'claude-fable-5-1', name: 'Fable 5.1' }],
      });
      await waitFor(() => expect(screen.getByText('Fable 5.1')).toBeTruthy());
      expect(harness).toHaveProperty('textContent', 'Claude Cloud');
      chooseSelectOption(harness, 'Macro Agent');
      await waitFor(() =>
        expect(screen.getByLabelText('Default model')).toHaveProperty(
          'textContent',
          'Claude Sonnet 4.5'
        )
      );
      expect(
        selectOptions(screen.getByLabelText('Default model')).queryByRole(
          'option',
          { name: /Fable/i }
        )
      ).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() =>
        expect(agentMocks.update).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: 'agent-1',
            harness: 'in-memory',
            defaultModel: Model.sonnet5,
          })
        )
      );
    } finally {
      view.unmount();
      client.clear();
    }
  });

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

  it('does not list a coworker private agent in Settings', () => {
    agentMocks.query.data = [
      {
        bot: {
          id: 'agent-shared',
          kind: 'owned',
          owner: { type: 'user', user_id: 'macro|coworker@example.com' },
          name: 'Shared Reviewer',
          handle: 'shared-reviewer',
          has_agent: true,
          created_at: '2026-08-27T12:00:00Z',
          updated_at: '2026-08-27T12:00:00Z',
        },
        instructions: 'Review pull requests.',
        harness: 'in-memory',
        default_model: Model.sonnet5,
        channel_scope: 'selected',
        channel_ids: ['channel-engineering'],
      },
    ];

    render(() => <Agents />);

    expect(screen.queryByText('Shared Reviewer')).toBeNull();
    expect(screen.getByText('No private agents yet.')).toBeTruthy();
  });

  it("does not list another team's mentionable agent in Settings", () => {
    agentMocks.query.data = [
      {
        bot: {
          id: 'agent-other-team',
          kind: 'owned',
          owner: { type: 'team', team_id: 'team-other' },
          name: 'Other Team Helper',
          handle: 'other-team-helper',
          has_agent: true,
          created_at: '2026-08-27T12:00:00Z',
          updated_at: '2026-08-27T12:00:00Z',
        },
        instructions: 'Help the other team.',
        harness: 'in-memory',
        default_model: Model.sonnet5,
        channel_scope: 'selected',
        channel_ids: ['channel-engineering'],
      },
    ];

    render(() => <Agents />);

    expect(screen.queryByText('Other Team Helper')).toBeNull();
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

    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
    expect(screen.getByRole('heading', { name: 'Edit agent' })).toBeTruthy();
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
        autoAcceptPermissions: true,
        isCoding: false,
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
    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
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
      within(
        screen.getByRole('region', { name: /^(New|Edit) agent$/ })
      ).getByLabelText('Private')
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
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));

    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
    const harness = within(dialog).getByLabelText('Runtime');

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
    expect(within(dialog).getByLabelText('Instructions')).toBeTruthy();
    expect(harness).toHaveProperty('textContent', 'Macro Agent');
    expect(selectOptions(harness).getAllByRole('option')).toHaveLength(1);
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
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));

    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
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
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));

    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
    fireEvent.input(within(dialog).getByLabelText('Name'), {
      target: { value: 'Bug fixer' },
    });
    fireEvent.input(within(dialog).getByLabelText('Instructions'), {
      target: { value: 'Fix the **root cause** and add tests.' },
    });
    fireEvent.click(within(dialog).getByLabelText('Team'));
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create agent' })
    );

    await waitFor(() => {
      expect(agentMocks.create).toHaveBeenCalledWith({
        autoAcceptPermissions: true,
        avatarUrl: undefined,
        isCoding: false,
        channelIds: [],
        channelScope: 'all',
        defaultModel: Model.sonnet5,
        handle: 'bug-fixer',
        harness: 'in-memory',
        name: 'Bug fixer',
        instructions: 'Fix the **root cause** and add tests.',
        mcp: { scope: 'owner_connections' },
        teamId: 'team-1',
      });
      expect(agentMocks.toastSuccess).toHaveBeenCalledWith('Agent created');
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('offers Cursor and saves the model chosen from its dropdown', async () => {
    cursorMocks.status.data = {
      registered: true,
      updatedAt: '2026-08-27T12:00:00Z',
    };
    modelMocks.queries['cursor:'] = successfulModels([
      { id: 'cursor-small', name: 'Cursor Small' },
      { id: 'cursor-large', name: 'Cursor Large' },
    ]);

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));

    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
    const harness = within(dialog).getByLabelText('Runtime');
    expect(selectOptions(harness).getAllByRole('option')).toHaveLength(2);

    chooseSelectOption(harness, 'Cursor');
    expect(harness).toHaveProperty('textContent', 'Cursor');

    const defaultModel = within(dialog).getByLabelText('Default model');
    expect(selectOptions(defaultModel).getAllByRole('option')).toHaveLength(2);
    expect(
      selectOptions(defaultModel)
        .getByRole('option', { name: 'Cursor Small' })
        .getAttribute('aria-selected')
    ).toBe('true');
    chooseSelectOption(defaultModel, 'Cursor Large');
    expect(defaultModel.textContent).toBe('Cursor Large');
    fireEvent.input(within(dialog).getByLabelText('Name'), {
      target: { value: 'Coding agent' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create agent' })
    );
    await waitFor(() =>
      expect(agentMocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          harness: 'cursor',
          defaultModel: 'cursor-large',
        })
      )
    );
  });

  it('offers registered macrod harnesses in the harness picker', () => {
    harnessMocks.query.data = [MACROD_HARNESS];

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));

    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
    const harness = within(dialog).getByLabelText('Runtime');
    expect(selectOptions(harness).getAllByRole('option')).toHaveLength(2);
    expect(
      selectOptions(harness).getByRole('option', { name: 'Dev box' })
    ).toBeTruthy();
  });

  it('preserves the selected harness and submission when the harness list refetches', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryKey = ['refreshed-harnesses'];
    const fetchHarnesses = vi.fn(
      async (): Promise<Harness[]> => [{ ...MACROD_HARNESS }]
    );
    vi.mocked(useHarnessesQuery).mockImplementationOnce(() =>
      useQuery(() => ({
        queryKey,
        queryFn: fetchHarnesses,
        initialData: [MACROD_HARNESS],
      }))
    );
    modelMocks.queries[`macrod:${MACROD_HARNESS.id}`] = successfulModels([
      { id: 'codex-model', name: 'Codex model' },
    ]);
    const view = render(() => (
      <QueryClientProvider client={client}>
        <Suspense>
          <Agents />
        </Suspense>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(fetchHarnesses).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
    const harness = within(dialog).getByLabelText('Runtime');
    expect(
      selectOptions(harness).getByRole('option', { name: 'Dev box' })
    ).toBeTruthy();
    chooseSelectOption(harness, 'Dev box');
    fireEvent.input(within(dialog).getByLabelText('Name'), {
      target: { value: 'Coding agent' },
    });

    for (let refresh = 0; refresh < 2; refresh++) {
      await client.refetchQueries({ queryKey });
      expect(harness).toHaveProperty('textContent', 'Dev box');
      expect(within(dialog).getByLabelText('Default model')).toHaveProperty(
        'textContent',
        'Codex model'
      );
    }
    expect(fetchHarnesses).toHaveBeenCalledTimes(3);
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create agent' })
    );
    await waitFor(() =>
      expect(agentMocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          harness: 'macrod',
          harnessId: MACROD_HARNESS.id,
          defaultModel: 'codex-model',
        })
      )
    );
    view.unmount();
    client.clear();
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
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
    const harness = within(dialog).getByLabelText('Runtime');

    expect(within(dialog).getByText('Claude Sonnet 4.5')).toBeTruthy();

    chooseSelectOption(harness, 'Cursor');
    expect(
      within(dialog).getByText(/Could not load models for Cursor/)
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Retry models for Cursor' })
    );
    expect(retry).toHaveBeenCalledOnce();

    chooseSelectOption(harness, 'Dev box');
    expect(
      within(dialog).getByText(
        'Model selection is unsupported by this runtime.'
      )
    ).toBeTruthy();

    chooseSelectOption(harness, 'Loading box');
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
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));

    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
    const harness = within(dialog).getByLabelText('Runtime');
    chooseSelectOption(harness, 'Dev box');

    const defaultModel = within(dialog).getByLabelText('Default model');
    expect(defaultModel.tagName).toBe('BUTTON');
    expect(defaultModel).toHaveProperty('textContent', 'Codex');
    expect(selectOptions(defaultModel).getAllByRole('option')).toHaveLength(2);
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
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
    chooseSelectOption(within(dialog).getByLabelText('Runtime'), 'Dev box');

    expect(within(dialog).getByLabelText('Default model')).toHaveProperty(
      'textContent',
      'Claude Code'
    );
  });

  it('shows the current model when an available catalog has no options', () => {
    harnessMocks.query.data = [MACROD_HARNESS];
    modelMocks.queries[`macrod:${MACROD_HARNESS.id}`] = successfulModels(
      [],
      'provider-default'
    );

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
    chooseSelectOption(within(dialog).getByLabelText('Runtime'), 'Dev box');

    const defaultModel = within(dialog).getByLabelText('Default model');
    expect(defaultModel).toHaveProperty(
      'textContent',
      'provider-default (unavailable)'
    );
    expect(
      selectOptions(defaultModel).getByRole('option', {
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
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));

    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
    fireEvent.input(within(dialog).getByLabelText('Name'), {
      target: { value: 'Bug fixer' },
    });
    chooseSelectOption(within(dialog).getByLabelText('Runtime'), 'Dev box');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create agent' })
    );

    await waitFor(() => {
      expect(agentMocks.create).toHaveBeenCalledWith({
        autoAcceptPermissions: false,
        avatarUrl: undefined,
        isCoding: true,
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

  it('seeds the coding choice from the runtime and lets the user override it', async () => {
    harnessMocks.query.data = [MACROD_HARNESS];
    modelMocks.queries[`macrod:${MACROD_HARNESS.id}`] = successfulModels(
      [{ id: 'claude-code', name: 'Claude Code' }],
      'claude-code'
    );

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));

    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
    fireEvent.input(within(dialog).getByLabelText('Name'), {
      target: { value: 'Chatty' },
    });
    // Macro's in-memory runtime chats; a macrod harness codes.
    expect(within(dialog).getByLabelText('Chat agent')).toHaveProperty(
      'checked',
      true
    );
    chooseSelectOption(within(dialog).getByLabelText('Runtime'), 'Dev box');
    expect(within(dialog).getByLabelText('Coding agent')).toHaveProperty(
      'checked',
      true
    );
    fireEvent.click(within(dialog).getByLabelText('Chat agent'));
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create agent' })
    );

    await waitFor(() => {
      expect(agentMocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ harness: 'macrod', isCoding: false })
      );
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

    const defaultModel = within(
      screen.getByRole('region', { name: /^(New|Edit) agent$/ })
    ).getByLabelText('Default model');
    expect(defaultModel).toHaveProperty(
      'textContent',
      'retired-model (saved, unavailable)'
    );
    expect(
      selectOptions(defaultModel).getByRole('option', {
        name: 'retired-model (saved, unavailable)',
      })
    ).toBeTruthy();
  });

  it('keeps a saved Claude harness visible when model discovery fails', async () => {
    modelMocks.queries['claude-cloud:'] = {
      isPending: false,
      isError: true,
      isSuccess: false,
      refetch: vi.fn(),
    };
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
        harness: 'claude-cloud',
        default_model: 'saved-claude-model',
        channel_scope: 'all',
        channel_ids: [],
      },
    ];

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Bug fixer' }));

    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
    expect(within(dialog).getByLabelText('Runtime')).toHaveProperty(
      'textContent',
      'Claude Cloud'
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Save changes' })
    );
    await waitFor(() => {
      expect(agentMocks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          harness: 'claude-cloud',
          defaultModel: 'saved-claude-model',
        })
      );
    });
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

    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
    expect(within(dialog).getByLabelText('Runtime')).toHaveProperty(
      'textContent',
      'Dev box'
    );
    const defaultModel = within(dialog).getByLabelText('Default model');
    expect(defaultModel.tagName).toBe('BUTTON');
    expect(defaultModel).toHaveProperty('textContent', 'Harness default');
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

    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
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
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));

    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
    expect(
      within(dialog).getByLabelText('Use my connected apps')
    ).toHaveProperty('checked', true);
    expect(within(dialog).queryByLabelText('Search connectors')).toBeNull();
  });

  it('picks apps from the whole catalog, shows the viewer connection state, and persists them', async () => {
    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));

    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
    fireEvent.input(within(dialog).getByLabelText('Name'), {
      target: { value: 'Triage bot' },
    });
    fireEvent.click(within(dialog).getByLabelText('Specific apps'));

    // An explicit selection with nothing in it is not something to save.
    expect(
      within(dialog).getByRole('button', { name: 'Create agent' })
    ).toHaveProperty('disabled', true);

    within(dialog).getByLabelText('Search connectors').focus();
    fireEvent.input(within(dialog).getByLabelText('Search connectors'), {
      target: { value: 'lin' },
    });
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Linear/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('option', { name: /Linear/ }));

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
      expect(screen.queryByRole('option', { name: /Linear/ })).toBeNull();
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

    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
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

it('requires prompts unless the harness operator permits bypass', async () => {
  harnessMocks.query.data = [MACROD_HARNESS];
  modelMocks.queries[`macrod:${MACROD_HARNESS.id}`] = successfulModels([
    { id: 'claude-code', name: 'Claude Code' },
  ]);
  render(() => <Agents />);
  fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
  const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
  chooseSelectOption(within(dialog).getByLabelText('Runtime'), 'Dev box');
  expect(within(dialog).getByLabelText('Always prompt')).toHaveProperty(
    'checked',
    true
  );
  expect(within(dialog).queryByLabelText('Always bypass')).toBeNull();
});

it('offers bypass only after harness consent and resets the choice on harness change', async () => {
  harnessMocks.query.data = [
    { ...MACROD_HARNESS, allow_permission_bypass: true },
    { ...MACROD_HARNESS, id: 'prompt-only', name: 'Prompt only' },
  ];
  modelMocks.queries[`macrod:${MACROD_HARNESS.id}`] = successfulModels([
    { id: 'claude-code', name: 'Claude Code' },
  ]);
  render(() => <Agents />);
  fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
  const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
  chooseSelectOption(within(dialog).getByLabelText('Runtime'), 'Dev box');
  expect(within(dialog).getByLabelText('Always prompt')).toHaveProperty(
    'checked',
    true
  );
  fireEvent.click(within(dialog).getByLabelText('Always bypass'));
  expect(within(dialog).getByLabelText('Always bypass')).toHaveProperty(
    'checked',
    true
  );
  chooseSelectOption(within(dialog).getByLabelText('Runtime'), 'Prompt only');
  expect(within(dialog).getByLabelText('Always prompt')).toHaveProperty(
    'checked',
    true
  );
  expect(within(dialog).queryByLabelText('Always bypass')).toBeNull();
});

it.each(['in-memory', 'cursor', 'claude-cloud'])(
  'hides permission choices and saves bypass for built-in %s',
  async (harness) => {
    cursorMocks.status.data.registered = true;
    modelMocks.queries[`${harness}:`] = successfulModels([
      { id: 'provider-default', name: 'Provider default' },
    ]);
    agentMocks.create.mockClear();
    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
    const dialog = screen.getByRole('region', { name: /^(New|Edit) agent$/ });
    fireEvent.input(within(dialog).getByLabelText('Name'), {
      target: { value: 'Built-in agent' },
    });
    chooseSelectOption(
      within(dialog).getByLabelText('Runtime'),
      {
        'in-memory': 'Macro Agent',
        cursor: 'Cursor',
        'claude-cloud': 'Claude Cloud',
      }[harness]!
    );
    expect(within(dialog).queryByText('Permission requests')).toBeNull();
    expect(within(dialog).queryByLabelText('Always prompt')).toBeNull();
    expect(within(dialog).queryByLabelText('Always bypass')).toBeNull();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create agent' })
    );
    await waitFor(() => {
      expect(agentMocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ harness, autoAcceptPermissions: true })
      );
    });
  }
);
