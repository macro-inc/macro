import { describe, expect, it, vi } from 'vitest';
import {
  type ChannelSetupInput,
  type ChannelSetupProgress,
  completeChannelSetup,
} from './channel-setup';

const input: ChannelSetupInput = {
  name: 'Example channel',
  channelType: 'team',
  teamId: 'team',
  creatorId: 'creator',
  participantIds: ['participant'],
  agentIds: ['first-agent', 'second-agent'],
  autoJoinTeam: true,
};

describe('completeChannelSetup', () => {
  it('retries only unfinished invitations before enabling team auto-join', async () => {
    let progress: ChannelSetupProgress = {};
    const actions = {
      isCurrent: () => true,
      canContinue: () => true,
      create: vi.fn().mockResolvedValue('channel'),
      addParticipants: vi.fn().mockResolvedValue(undefined),
      addAgent: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('invite failed'))
        .mockResolvedValue(undefined),
      enableAutoJoin: vi.fn().mockResolvedValue(undefined),
    };
    const save = (value: ChannelSetupProgress) => {
      progress = value;
    };

    await expect(
      completeChannelSetup(input, progress, actions, save)
    ).rejects.toThrow('invite failed');
    expect(progress).toEqual({
      channelId: 'channel',
      participantsAdded: true,
      addedAgentIds: ['first-agent'],
    });
    expect(actions.enableAutoJoin).not.toHaveBeenCalled();

    await expect(
      completeChannelSetup(input, progress, actions, save)
    ).resolves.toBe('channel');
    expect(actions.create).toHaveBeenCalledTimes(1);
    expect(actions.addParticipants).toHaveBeenCalledTimes(1);
    expect(actions.addAgent.mock.calls).toEqual([
      ['channel', 'first-agent'],
      ['channel', 'second-agent'],
      ['channel', 'second-agent'],
    ]);
    expect(actions.enableAutoJoin).toHaveBeenCalledOnce();
    expect(progress.autoJoinEnabled).toBe(true);

    await completeChannelSetup(input, progress, actions, save);
    expect(actions.create).toHaveBeenCalledTimes(1);
    expect(actions.addAgent).toHaveBeenCalledTimes(3);
    expect(actions.enableAutoJoin).toHaveBeenCalledTimes(1);
  });

  it('does not repeat creation or invitations when auto-join fails', async () => {
    let progress: ChannelSetupProgress = {};
    const actions = {
      isCurrent: () => true,
      canContinue: () => true,
      create: vi.fn().mockResolvedValue('channel'),
      addParticipants: vi.fn().mockResolvedValue(undefined),
      addAgent: vi.fn().mockResolvedValue(undefined),
      enableAutoJoin: vi
        .fn()
        .mockRejectedValueOnce(new Error('patch failed'))
        .mockResolvedValue(undefined),
    };
    const save = (value: ChannelSetupProgress) => {
      progress = value;
    };
    await expect(
      completeChannelSetup(input, progress, actions, save)
    ).rejects.toThrow('patch failed');
    await completeChannelSetup(input, progress, actions, save);
    expect(actions.create).toHaveBeenCalledOnce();
    expect(actions.addParticipants).toHaveBeenCalledOnce();
    expect(actions.addAgent).toHaveBeenCalledTimes(2);
    expect(actions.enableAutoJoin).toHaveBeenCalledTimes(2);
  });

  it('does not enable team auto-join for private channels', async () => {
    const actions = {
      isCurrent: () => true,
      canContinue: () => true,
      create: vi.fn().mockResolvedValue('channel'),
      addParticipants: vi.fn().mockResolvedValue(undefined),
      addAgent: vi.fn().mockResolvedValue(undefined),
      enableAutoJoin: vi.fn(),
    };
    await completeChannelSetup(
      { ...input, channelType: 'private' },
      {},
      actions,
      () => {}
    );
    expect(actions.enableAutoJoin).not.toHaveBeenCalled();
  });

  it('stops setup without publishing stale progress after scope changes', async () => {
    let current = true;
    const save = vi.fn();
    const actions = {
      isCurrent: () => current,
      canContinue: () => true,
      create: vi.fn(async () => {
        current = false;
        return 'channel';
      }),
      addParticipants: vi.fn(),
      addAgent: vi.fn(),
      enableAutoJoin: vi.fn(),
    };
    await expect(
      completeChannelSetup(input, {}, actions, save)
    ).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();
    expect(actions.addParticipants).not.toHaveBeenCalled();
    expect(actions.addAgent).not.toHaveBeenCalled();
    expect(actions.enableAutoJoin).not.toHaveBeenCalled();
  });

  it('keeps the created channel when the team changes and resumes without recreating it', async () => {
    let sameTeam = true;
    let progress: ChannelSetupProgress = {};
    const actions = {
      isCurrent: () => true,
      canContinue: () => sameTeam,
      create: vi.fn(async () => {
        sameTeam = false;
        return 'channel';
      }),
      addParticipants: vi.fn().mockResolvedValue(undefined),
      addAgent: vi.fn().mockResolvedValue(undefined),
      enableAutoJoin: vi.fn().mockResolvedValue(undefined),
    };
    const save = (value: ChannelSetupProgress) => {
      progress = value;
    };
    await expect(
      completeChannelSetup(input, progress, actions, save)
    ).resolves.toBeUndefined();
    expect(progress.channelId).toBe('channel');
    expect(actions.addParticipants).not.toHaveBeenCalled();
    sameTeam = true;
    await expect(
      completeChannelSetup(input, progress, actions, save)
    ).resolves.toBe('channel');
    expect(actions.create).toHaveBeenCalledOnce();
    expect(actions.addParticipants).toHaveBeenCalledOnce();
    expect(actions.addAgent).toHaveBeenCalledTimes(2);
    expect(actions.enableAutoJoin).toHaveBeenCalledOnce();
  });
  it('performs no writes when the request scope has already retired', async () => {
    const actions = {
      isCurrent: () => false,
      canContinue: () => true,
      create: vi.fn(),
      addParticipants: vi.fn(),
      addAgent: vi.fn(),
      enableAutoJoin: vi.fn(),
    };
    await expect(
      completeChannelSetup(input, {}, actions, vi.fn())
    ).resolves.toBeUndefined();
    expect(actions.create).not.toHaveBeenCalled();
  });
});
