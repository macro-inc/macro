/** The `/artifacts` routes of the document storage service. */
import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import type { ObjectLike, ResultError } from '@core/util/result';
import { ResultAsync } from 'neverthrow';

// TEMPORARY: replaced by the generated schemas once the artifacts API lands
// in openapi.json (`bun run gen-api`).
export type ArtifactScene = { id: string; title: string; path: string };
export type ArtifactFile = {
  path: string;
  sha256: string;
  size: number;
  content_type: string;
};
export type ArtifactVersion = {
  number: number;
  files: ArtifactFile[];
  scenes: ArtifactScene[];
  message?: string | null;
  created_by: string;
  created_by_agent?: string | null;
  created_at: string;
};
export type Artifact = {
  document_id: string;
  name: string;
  owner: string;
  current: ArtifactVersion;
};
export type ArtifactVersionSummary = {
  number: number;
  message?: string | null;
  created_by: string;
  created_by_agent?: string | null;
  created_at: string;
  file_count: number;
  total_size: number;
};
export type ArtifactVersionList = { versions: ArtifactVersionSummary[] };
export type ArtifactViewUrlRequest = {
  version?: number | null;
  scene?: string | null;
  theme?: 'light' | 'dark' | null;
};
export type ArtifactViewUrl = {
  url: string;
  origin: string;
  version: number;
  expires_at: string;
};

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
    return artifactsFetch<Artifact>(encode(documentId));
  },

  /** Newest first. */
  listVersions({ documentId }: { documentId: string }) {
    return artifactsFetch<ArtifactVersionList>(
      `${encode(documentId)}/versions`
    );
  },

  getVersion({ documentId, number }: { documentId: string; number: number }) {
    return artifactsFetch<ArtifactVersion>(
      `${encode(documentId)}/versions/${number}`
    );
  },

  /** Publishes the version's manifest again as a new current version. */
  restore({ documentId, number }: { documentId: string; number: number }) {
    return artifactsFetch<ArtifactVersion>(
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
    return artifactsFetch<ArtifactViewUrl>(`${encode(documentId)}/view_url`, {
      method: 'POST',
      body: request,
    });
  },
};
