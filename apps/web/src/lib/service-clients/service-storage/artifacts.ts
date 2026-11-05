/** The `/artifacts` routes of the document storage service. */
import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import type { ObjectLike, ResultError } from '@core/util/result';
import { ResultAsync } from 'neverthrow';
import type { ArtifactResponse } from './generated/schemas/artifactResponse';
import type { ArtifactVersionResponse } from './generated/schemas/artifactVersionResponse';
import type { ArtifactVersionsResponse } from './generated/schemas/artifactVersionsResponse';
import type { ArtifactViewUrlRequest } from './generated/schemas/artifactViewUrlRequest';
import type { ArtifactViewUrlResponse } from './generated/schemas/artifactViewUrlResponse';

export type ArtifactsError = ResultError<FetchWithTokenErrorCode>;

const documentStorageHost = SERVER_HOSTS['document-storage-service'];

function artifactsFetch<Data extends ObjectLike>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {}
): ResultAsync<Data, ArtifactsError[]> {
  return new ResultAsync(
    fetchWithToken<Data>(`${documentStorageHost}/artifacts/${path}`, {
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  );
}

const encode = encodeURIComponent;

export const artifactsClient = {
  get({ documentId }: { documentId: string }) {
    return artifactsFetch<ArtifactResponse>(encode(documentId));
  },

  /** Newest first. */
  listVersions({ documentId }: { documentId: string }) {
    return artifactsFetch<ArtifactVersionsResponse>(
      `${encode(documentId)}/versions`
    );
  },

  getVersion({ documentId, number }: { documentId: string; number: number }) {
    return artifactsFetch<ArtifactVersionResponse>(
      `${encode(documentId)}/versions/${number}`
    );
  },

  /** Publishes the version's manifest again as a new current version. */
  restore({ documentId, number }: { documentId: string; number: number }) {
    return artifactsFetch<ArtifactVersionResponse>(
      `${encode(documentId)}/versions/${number}/restore`,
      { method: 'POST' }
    );
  },

  /** A short-lived URL on the artifact's own origin, for the viewer. */
  viewUrl({
    documentId,
    request,
  }: {
    documentId: string;
    request: ArtifactViewUrlRequest;
  }) {
    return artifactsFetch<ArtifactViewUrlResponse>(
      `${encode(documentId)}/view_url`,
      {
        method: 'POST',
        body: request,
      }
    );
  },
};
