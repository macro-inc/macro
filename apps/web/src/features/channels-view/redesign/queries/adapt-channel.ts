import type { ChannelEntity } from '@entity';
import type { DirectoryChannel } from '@queries/channel/directory-core';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { unwrap } from 'solid-js/store';
import {
  type SidebarChannel,
  type SidebarSection,
  toEpochMs,
} from '../core/sidebar-model';

const BOT_PRINCIPAL_PREFIX = 'bot|';

/**
 * Adapt a combined `ChannelEntity` + optional `DirectoryChannel` into a pure
 * `SidebarChannel`. Unwraps store proxies up front so reading nested arrays
 * like `participantIds` or `participants` inside a tracked scope never
 * allocates per-element Solid signals.
 */
export function toSidebarChannel(
  rawChannel: ChannelEntity,
  rawDirectoryRecord?: DirectoryChannel
): SidebarChannel {
  const channel = unwrap(rawChannel);
  const directoryRecord = rawDirectoryRecord
    ? unwrap(rawDirectoryRecord)
    : undefined;

  const rawParticipants = channel.participantIds ?? [];
  const participantIds = directoryRecord
    ? directoryRecord.participants
        .filter((participant) => participant.leftAt === null)
        .map((participant) => participant.userId)
    : rawParticipants.filter((id) => !id.startsWith(BOT_PRINCIPAL_PREFIX));

  const botParticipantIds = directoryRecord
    ? directoryRecord.botParticipants
        .filter((participant) => participant.leftAt === null)
        .map((participant) => participant.botId)
    : rawParticipants
        .filter((id) => id.startsWith(BOT_PRINCIPAL_PREFIX))
        .map((id) => id.slice(BOT_PRINCIPAL_PREFIX.length));

  const latest =
    channel.latestRootMessage ??
    channel.latestMessage ??
    (directoryRecord?.latestNonThreadMessage
      ? {
          messageId: directoryRecord.latestNonThreadMessage.messageId,
          senderId: directoryRecord.latestNonThreadMessage.senderId,
          content: directoryRecord.latestNonThreadMessage.content,
          createdAt: directoryRecord.latestNonThreadMessage.createdAt,
          threadId:
            directoryRecord.latestNonThreadMessage.threadId ?? undefined,
          mentions: directoryRecord.latestNonThreadMessage.mentions,
        }
      : undefined);

  const isAgentDm =
    directoryRecord !== undefined
      ? Boolean(directoryRecord.agentDm)
      : channel.channelType === 'direct_message' &&
        botParticipantIds.length > 0;

  return {
    id: channel.id,
    name: directoryRecord?.agentDm?.name ?? channel.name,
    channelType: channel.channelType,
    teamId: channel.teamId ?? directoryRecord?.teamId ?? undefined,
    isParticipant:
      channel.isParticipant ?? directoryRecord?.isParticipant ?? true,
    updatedAtMs: toEpochMs(channel.updatedAt ?? directoryRecord?.updatedAt),
    viewedAtMs: toEpochMs(channel.viewedAt ?? directoryRecord?.viewedAt),
    createdAtMs: toEpochMs(channel.createdAt ?? directoryRecord?.createdAt),
    frecencyScore: directoryRecord?.frecencyScore ?? 0,
    participantIds,
    botParticipantIds,
    isAgentDm,
    latestMessage: latest
      ? {
          messageId: latest.messageId,
          senderId: latest.senderId,
          content: latest.content,
          createdAtMs: toEpochMs(latest.createdAt),
          threadId: latest.threadId ?? undefined,
          mentions: latest.mentions ?? [],
        }
      : undefined,
  };
}

/**
 * Adapt a single `DirectoryChannel` record into a `SidebarChannel` without
 * allocating reactive store signals. Intended ONLY for small lazy top-K
 * Quick Switch hits, never for eagerly mapping the full directory.
 */
export function toSidebarChannelFromDirectory(
  rawRecord: DirectoryChannel
): SidebarChannel {
  const record = unwrap(rawRecord);
  const latest = record.latestNonThreadMessage;
  return {
    id: record.id,
    name: record.agentDm?.name ?? record.name ?? 'Unnamed channel',
    channelType: record.channelType,
    teamId: record.teamId ?? undefined,
    isParticipant: record.isParticipant,
    updatedAtMs: toEpochMs(record.updatedAt),
    viewedAtMs: toEpochMs(record.viewedAt),
    createdAtMs: toEpochMs(record.createdAt),
    frecencyScore: record.frecencyScore ?? 0,
    participantIds: record.participants
      .filter((participant) => participant.leftAt === null)
      .map((participant) => participant.userId),
    botParticipantIds: record.botParticipants
      .filter((participant) => participant.leftAt === null)
      .map((participant) => participant.botId),
    isAgentDm: Boolean(record.agentDm),
    latestMessage: latest
      ? {
          messageId: latest.messageId,
          senderId: latest.senderId,
          content: latest.content,
          createdAtMs: toEpochMs(latest.createdAt),
          threadId: latest.threadId ?? undefined,
          mentions: latest.mentions,
        }
      : undefined,
  };
}

/** Adapt a backend `ChannelLabel` (`/channel-sections`) into a pure `SidebarSection`. */
export function toSidebarSection(label: ChannelLabel): SidebarSection {
  return {
    id: label.id,
    name: label.name,
    scope: label.teamId ? 'team' : 'personal',
    teamId: label.teamId ?? undefined,
    ruleContains: label.rule?.contains,
    channelIds: label.channelIds,
    sortOrder: label.sortOrder,
  };
}
