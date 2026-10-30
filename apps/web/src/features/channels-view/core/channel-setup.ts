export type ChannelSetupInput = {
  name: string;
  channelType: 'team' | 'private';
  teamId?: string;
  creatorId: string;
  participantIds: string[];
  agentIds: string[];
  autoJoinTeam: boolean;
};

export type ChannelSetupProgress = {
  channelId?: string;
  participantsAdded?: boolean;
  addedAgentIds?: string[];
  autoJoinEnabled?: boolean;
};

type ChannelSetupActions = {
  isCurrent: () => boolean;
  canContinue: () => boolean;
  create: (input: ChannelSetupInput) => Promise<string>;
  addParticipants: (
    channelId: string,
    participantIds: string[]
  ) => Promise<unknown>;
  addAgent: (channelId: string, agentId: string) => Promise<unknown>;
  enableAutoJoin: (channelId: string) => Promise<unknown>;
};

/** Retain completed writes for the owner, but start no writes in another team. */
export async function completeChannelSetup(
  input: ChannelSetupInput,
  previous: ChannelSetupProgress,
  actions: ChannelSetupActions,
  onProgress: (progress: ChannelSetupProgress) => void
): Promise<string | undefined> {
  let progress = previous;
  const canContinue = () => actions.isCurrent() && actions.canContinue();
  if (!canContinue()) return;

  let channelId = progress.channelId;
  if (!channelId) {
    channelId = await actions.create(input);
    if (!actions.isCurrent()) return;
    progress = { ...progress, channelId };
    onProgress(progress);
  }

  if (!canContinue()) return;
  if (input.participantIds.length > 0 && !progress.participantsAdded) {
    await actions.addParticipants(channelId, input.participantIds);
    if (!actions.isCurrent()) return;
    progress = { ...progress, participantsAdded: true };
    onProgress(progress);
  }

  for (const agentId of input.agentIds) {
    if (!canContinue()) return;
    if (progress.addedAgentIds?.includes(agentId)) continue;
    await actions.addAgent(channelId, agentId);
    if (!actions.isCurrent()) return;
    progress = {
      ...progress,
      addedAgentIds: [...(progress.addedAgentIds ?? []), agentId],
    };
    onProgress(progress);
  }

  if (!canContinue()) return;
  if (
    input.channelType === 'team' &&
    input.autoJoinTeam &&
    !progress.autoJoinEnabled
  ) {
    await actions.enableAutoJoin(channelId);
    if (!actions.isCurrent()) return;
    onProgress({ ...progress, autoJoinEnabled: true });
  }

  return canContinue() ? channelId : undefined;
}
