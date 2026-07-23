/**
 * Client for the import pipeline on the document cognition service.
 *
 * Types are hand-written mirrors of the `import` crate's API models (not
 * yet in the generated schemas; replace with generated types on the next
 * codegen run).
 */
import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import type { ObjectLike, ResultError } from '@core/util/result';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type { Result } from 'neverthrow';

const dcsHost: string = SERVER_HOSTS['cognition-service'];

function importFetch(
  url: string,
  init?: SafeFetchInit
): Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>>;
function importFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>;
function importFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>
  | Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>> {
  return fetchWithToken<T>(`${dcsHost}${url}`, init);
}

export type ImportSource = 'linear' | 'notion' | 'slack';

export type ImportEntityStatus =
  | 'staged'
  | 'importing'
  | 'imported'
  | 'discarded';

export type ImportInitiator = 'onboarding' | 'chat';

export type ImportRunStatus =
  | 'running'
  | 'ready'
  | 'importing'
  | 'completed'
  | 'failed'
  | 'dismissed';

/** Metadata shape for staged Linear issues (`source === 'linear'`). */
export type LinearIssueMeta = {
  identifier?: string | null;
  title: string;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  assignee?: string | null;
  assignee_email?: string | null;
  url?: string | null;
};

/** Metadata shape for staged Notion pages (`source === 'notion'`). */
export type NotionDocMeta = {
  title: string;
  url?: string | null;
  summary?: string | null;
};

export type SlackParticipant = {
  name: string;
  email?: string | null;
};

/** Metadata shape for staged Slack channels (`source === 'slack'`). */
export type SlackChannelMeta = {
  name: string;
  channel_id?: string | null;
  purpose?: string | null;
  participants?: SlackParticipant[];
};

/** One row of the import ledger. */
export type ImportEntity = {
  id: string;
  /** Owner; teammates' team-imported rows carry the teammate's id. */
  user_id: string;
  team_id?: string | null;
  source: ImportSource;
  foreign_id: string;
  status: ImportEntityStatus;
  initiator: ImportInitiator;
  /** Per-source metadata; shape keyed by `source` (see the Meta types). */
  metadata: Record<string, unknown>;
  entity_id?: string | null;
  entity_type?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
};

/** Gather-run state for one source. */
export type ImportRun = {
  source: ImportSource;
  status: ImportRunStatus;
  auto_import: boolean;
  error?: string | null;
  updated_at: string;
};

export type ImportState = {
  runs: ImportRun[];
  entities: ImportEntity[];
};

export type RunImportOutcome = {
  discarded: number;
  importing: number;
};

export const importClient = {
  /** Gather runs plus visible ledger rows for the authenticated user. */
  async getState() {
    return await importFetch<ImportState>('/import/state', { method: 'GET' });
  },

  /** Accept staged rows (starts import jobs) and/or discard staged rows. */
  async runImport(args: { import_ids: string[]; discard_ids: string[] }) {
    return await importFetch<RunImportOutcome>('/import/run', {
      method: 'POST',
      body: JSON.stringify(args),
    });
  },

  /** Restart a failed gather run for one source. */
  async retryGather(source: ImportSource) {
    return await importFetch(`/import/runs/${source}/retry`, {
      method: 'POST',
    });
  },

  /** Dismiss one source's import section. */
  async dismissRun(source: ImportSource) {
    return await importFetch(`/import/runs/${source}/dismiss`, {
      method: 'POST',
    });
  },
};
