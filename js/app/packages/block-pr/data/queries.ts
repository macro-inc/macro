import { throwOnErr } from '@core/util/result';
import type { GithubPullRequestEntity } from '@entity';
import { queryClient } from '@queries/client';
import type { GithubPullRequestWithDetails } from '@queries/storage/github-pull-requests';
import { storageServiceClient } from '@service-storage/client';
import type { ForeignEntity } from '@service-storage/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

import type { PrRef } from '../util/prKey';
import {
  parseGithubKey,
  prDisplayName,
  prHtmlUrl,
  toGithubKey,
} from '../util/prKey';
import { logPrLoading } from '../util/prLoadingLog';

const PR_STALE_TIME = 60 * 1000;
const GITHUB_PULL_REQUEST_SOURCE = 'github_pull_request';

export type PrForeignEntityData = {
  id: string;
  prRef: PrRef;
  pullRequest: GithubPullRequestWithDetails;
};

export function prForeignEntityQueryKey(id: string): string[] {
  return ['github-pr', 'foreign-entity', id];
}

function metadataRecord(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

function optionalString(value: unknown): string | null | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | null | undefined {
  return typeof value === 'number' ? value : undefined;
}

function optionalArray<T>(value: unknown): T[] | null | undefined {
  return Array.isArray(value) ? (value as T[]) : undefined;
}

function prForeignEntityDataFromParts(args: {
  id: string;
  foreignId: string;
  metadata: unknown;
}): PrForeignEntityData {
  const metadata = metadataRecord(args.metadata);
  const owner = optionalString(metadata.owner);
  const repo = optionalString(metadata.repo);
  const number = optionalNumber(metadata.number);
  const refFromMetadata =
    owner && repo && number != null ? { owner, repo, number } : null;
  const prRef = refFromMetadata ?? parseGithubKey(args.foreignId);

  if (!prRef) {
    throw new Error(`Invalid GitHub pull request metadata for ${args.id}`);
  }

  const githubKey =
    optionalString(metadata.githubKey) ?? args.foreignId ?? toGithubKey(prRef);

  return {
    id: args.id,
    prRef,
    pullRequest: {
      additions: optionalNumber(metadata.additions),
      authorLogin: optionalString(metadata.authorLogin),
      description: optionalString(metadata.description),
      checks: optionalArray(metadata.checks),
      comments: optionalArray(metadata.comments),
      deletions: optionalNumber(metadata.deletions),
      displayName: optionalString(metadata.displayName) ?? prDisplayName(prRef),
      foreignEntityId: args.id,
      githubKey,
      name: optionalString(metadata.name),
      number: prRef.number,
      owner: prRef.owner,
      repo: prRef.repo,
      status: optionalString(metadata.status),
      url: optionalString(metadata.url) ?? prHtmlUrl(prRef),
    },
  };
}

function prForeignEntityDataFromForeignEntity(
  entity: ForeignEntity
): PrForeignEntityData {
  if (entity.foreignEntitySource !== GITHUB_PULL_REQUEST_SOURCE) {
    throw new Error(`Foreign entity ${entity.id} is not a GitHub pull request`);
  }

  return prForeignEntityDataFromParts({
    id: entity.id,
    foreignId: entity.foreignEntityId,
    metadata: entity.metadata,
  });
}

/**
 * Seed the PR block's query cache from a soup/entity-list
 * `GithubPullRequestEntity` — its metadata is the same stored, team-visible
 * data the block renders, so clicking through shows it immediately without
 * requiring a personal GitHub link.
 */
export function seedPrBlockData(entity: GithubPullRequestEntity): string {
  const { owner, repo, number } = entity.metadata;
  const ref: PrRef = { owner, repo, number };
  logPrLoading('seedPrBlockData called', {
    ref,
    storedForId: entity.storedForId,
    hasName: !!entity.metadata.name,
    hasStatus: !!entity.metadata.status,
    checks: entity.metadata.checks?.length ?? null,
    comments: entity.metadata.comments?.length ?? null,
  });
  queryClient.setQueryData<PrForeignEntityData>(
    prForeignEntityQueryKey(entity.id),
    prForeignEntityDataFromParts({
      id: entity.id,
      foreignId: entity.foreignId,
      metadata: {
        additions: entity.metadata.additions,
        checks: entity.metadata.checks,
        comments: entity.metadata.comments,
        deletions: entity.metadata.deletions,
        displayName: prDisplayName(ref),
        githubKey: toGithubKey(ref),
        name: entity.metadata.name,
        number,
        owner,
        repo,
        status: entity.metadata.status,
        url: entity.metadata.url,
      },
    })
  );
  logPrLoading('seedPrBlockData wrote foreign entity cache', {
    id: entity.id,
    ref,
  });
  return entity.id;
}

export function usePrForeignEntityQuery(id: Accessor<string>) {
  return useQuery(() => {
    const currentId = id();
    return {
      queryKey: prForeignEntityQueryKey(currentId),
      queryFn: async (): Promise<PrForeignEntityData> => {
        logPrLoading('foreign entity queryFn start', { id: currentId });
        const entity = await throwOnErr(() =>
          storageServiceClient.getForeignEntity({ id: currentId })
        );
        const data = prForeignEntityDataFromForeignEntity(entity);
        logPrLoading('foreign entity queryFn success', {
          id: currentId,
          githubKey: data.pullRequest.githubKey,
          hasName: !!data.pullRequest.name,
          hasDescription: !!data.pullRequest.description,
          authorLogin: data.pullRequest.authorLogin,
          checks: data.pullRequest.checks?.length ?? null,
          comments: data.pullRequest.comments?.length ?? null,
        });
        return data;
      },
      staleTime: PR_STALE_TIME,
      retry: 1,
    };
  });
}
