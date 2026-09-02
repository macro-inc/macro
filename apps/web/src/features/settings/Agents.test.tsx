/**
 * @vitest-environment jsdom
 */

import { Model } from '@core/component/AI/constant/model';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agents } from './Agents';

const cursorMocks = vi.hoisted(() => ({
  status: {
    data: {
      registered: false,
      updatedAt: null as string | null,
    },
  },
  models: {
    data: {
      models: [
        { id: 'cursor-small', displayName: 'Cursor Small' },
        { id: 'cursor-large', displayName: 'Cursor Large' },
      ],
    },
  },
}));

const agentMocks = vi.hoisted(() => ({
  query: {
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
  useCursorModelsQuery: () => cursorMocks.models,
}));

const harnessMocks = vi.hoisted(() => ({
  query: {
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
  useCurrentTeamQuery: () => ({ data: agentMocks.currentTeam }),
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

beforeAll(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

beforeEach(() => {
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

  it('swaps the model select for a free-text input seeded with default for macrod harnesses', () => {
    harnessMocks.query.data = [MACROD_HARNESS];

    render(() => <Agents />);
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));

    const dialog = screen.getByRole('dialog');
    const harness = within(dialog).getByLabelText('Harness');
    fireEvent.change(harness, { target: { value: MACROD_HARNESS.id } });

    const defaultModel = within(dialog).getByLabelText('Default model');
    expect(defaultModel.tagName).toBe('INPUT');
    expect(defaultModel).toHaveProperty('value', 'default');
  });

  it('submits macrod agents with the macrod slug and harness id', async () => {
    harnessMocks.query.data = [MACROD_HARNESS];

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
        defaultModel: 'default',
        handle: 'bug-fixer',
        harness: 'macrod',
        harnessId: MACROD_HARNESS.id,
        name: 'Bug fixer',
        instructions: '',
        teamId: undefined,
      });
    });
  });

  it('preselects the bound macrod harness when editing', () => {
    harnessMocks.query.data = [MACROD_HARNESS];
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
    expect(defaultModel.tagName).toBe('INPUT');
    expect(defaultModel).toHaveProperty('value', 'default');
  });
});
