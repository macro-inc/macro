import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { BotOwnerProfile } from '@service-storage/generated/schemas/botOwnerProfile';
import type { MessageSender } from '@service-storage/messages';
import { AsyncBatcher } from '@tanstack/pacer';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import { queryReadyGate } from '../gate';
import { isHexHyphenatedId } from './bot-id';
import { firstPartyBotName } from './first-party-bot-name';
import { botProfileKeys } from './keys';

export type BotProfile = {
  name: string;
  avatarUrl: string | undefined;
  deleted: boolean;
};

type PendingRequest = {
  resolve: (profile: BotProfile | null) => void;
  reject: (error: Error) => void;
};

const MAX_BOT_OWNER_PROFILE_IDS = 100;

export function toBotProfile(row: BotOwnerProfile): BotProfile {
  return {
    name: row.name,
    avatarUrl: row.avatar_url ?? undefined,
    deleted: row.deleted_at != null,
  };
}

class BotProfileLoader {
  private pendingRequests = new Map<string, PendingRequest[]>();

  private batcher = new AsyncBatcher<string>(
    async (botIds) =>
      await throwOnErr(() =>
        storageServiceClient.getBotOwnerProfiles({ ids: botIds })
      ),
    {
      wait: 30,
      maxSize: MAX_BOT_OWNER_PROFILE_IDS,
      onSuccess: (rows: BotOwnerProfile[], botIds) => {
        const profiles = new Map(
          rows.map((row) => [row.id, toBotProfile(row)])
        );
        for (const botId of botIds) {
          const profile = profiles.get(botId) ?? null;
          for (const request of this.take(botId)) request.resolve(profile);
        }
      },
      onError: (error, botIds) => {
        const err =
          error instanceof Error
            ? error
            : new Error('Failed to fetch bot profiles');
        for (const botId of botIds) {
          for (const request of this.take(botId)) request.reject(err);
        }
      },
      throwOnError: false,
    }
  );

  load(botId: string): Promise<BotProfile | null> {
    if (!isHexHyphenatedId(botId)) {
      return Promise.reject(new Error('Invalid bot id'));
    }
    return new Promise((resolve, reject) => {
      const existing = this.pendingRequests.get(botId);
      if (existing) {
        existing.push({ resolve, reject });
      } else {
        this.pendingRequests.set(botId, [{ resolve, reject }]);
        fireAndForget(this.batcher.addItem(botId), 'bot-profiles');
      }
    });
  }

  private take(botId: string): PendingRequest[] {
    const requests = this.pendingRequests.get(botId) ?? [];
    this.pendingRequests.delete(botId);
    return requests;
  }
}

export const botProfileLoader = new BotProfileLoader();

function botProfileQueryOptions(botId: string, seed?: BotProfile) {
  return queryOptions({
    queryKey: botProfileKeys.detail(botId).queryKey,
    queryFn: () => botProfileLoader.load(botId),
    enabled: botId.length > 0,
    initialData: seed,
  });
}

/**
 * Profile for a bare bot UUID. `null` when the backend does not know it. This
 * cache is the one record of a bot's name and picture: every change to the bot
 * is pushed into it (`handleBotProfileChanged`). `seed` is a copy a payload
 * arrived with; it fills an empty cache so rendering needs no request.
 */
export function useBotProfile(
  botId: () => string,
  seed?: () => BotProfile | undefined
) {
  return useQuery(() => botProfileQueryOptions(botId(), seed?.()));
}

/**
 * `sender` with a team bot's name and picture as they are now. The copy the
 * message arrived with seeds the bot's profile; after that every message by
 * the bot shows the cached profile, which a rename or new picture replaces.
 * First-party bots and posts made through a client keep their own identity.
 */
export function useLiveBotSender(
  sender: () => MessageSender
): () => MessageSender {
  const botId = () => {
    const current = sender();
    const isTeamBot =
      current.type === 'bot' &&
      !current.triggered_via &&
      !firstPartyBotName(current.id) &&
      isHexHyphenatedId(current.id);
    return isTeamBot ? current.id : '';
  };
  const seed = (): BotProfile | undefined => {
    const current = sender();
    if (!current.name) return undefined;
    return {
      name: current.name,
      avatarUrl: current.avatar_url ?? undefined,
      deleted: false,
    };
  };
  const profile = useBotProfile(botId, seed);

  return () => {
    const current = sender();
    if (!botId() || !queryReadyGate(profile) || !profile.data) return current;
    return {
      ...current,
      name: profile.data.name,
      avatar_url: profile.data.avatarUrl ?? null,
    };
  };
}
