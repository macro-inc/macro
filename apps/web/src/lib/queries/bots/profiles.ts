import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { BotOwnerProfile } from '@service-storage/generated/schemas/botOwnerProfile';
import { AsyncBatcher } from '@tanstack/pacer';
import { useQuery } from '@tanstack/solid-query';
import { isHexHyphenatedId } from './bot-id';
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

function toBotProfile(row: BotOwnerProfile): BotProfile {
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
        this.batcher.addItem(botId);
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

/** Profile for a bare bot UUID. `null` when the backend does not know it. */
export function useBotProfile(botId: () => string) {
  return useQuery(() => ({
    queryKey: botProfileKeys.detail(botId()).queryKey,
    queryFn: () => botProfileLoader.load(botId()),
    enabled: botId().length > 0,
  }));
}
