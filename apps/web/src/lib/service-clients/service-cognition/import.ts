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
import {
  type AI_USAGE_LIMIT_ERROR,
  aiUsageErrorResponseHandler,
} from '../ai-usage-limit';
import type { NotionImportReport } from './generated/schemas';

export type { NotionImportReport } from './generated/schemas';

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

import type { ImportKind, ImportSource } from './generated/schemas';

export type { ImportKind, ImportSource } from './generated/schemas';

export type ImportEntityStatus =
  | 'staged'
  | 'importing'
  | 'imported'
  | 'discarded';

export type ImportInitiator = 'onboarding' | 'chat' | 'archive' | 'manual';

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
  member_count?: number | null;
  archived?: boolean;
  members_resolved?: boolean;
};

/** One row of the import ledger. */
export type ImportEntity = {
  id: string;
  /** Owner; teammates' team-imported rows carry the teammate's id. */
  user_id: string;
  team_id?: string | null;
  source: ImportSource;
  kind: ImportKind;
  foreign_id: string;
  /** The row this item was imported under, when it was part of a tree. */
  parent_id?: string | null;
  /** The agent session review that approved importing it, if any. */
  review_id?: string | null;
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

/** Discovery-run state for one source. */
export type ImportRun = {
  source: ImportSource;
  status: ImportRunStatus;
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
  /** Report on the selected reviewed workspace source. */
  async getWorkspaceReport(source: 'notion' | 'linear' | 'jira') {
    return await importFetch<NotionImportReport>(
      `/import/workspaces/${source}`,
      { method: 'GET' }
    );
  },
  /** Stop this source only, preserving completed entities. */
  async cancelWorkspace(source: 'notion' | 'linear' | 'jira') {
    return await importFetch<NotionImportReport>(
      `/import/workspaces/${source}/cancel`,
      { method: 'POST' }
    );
  },
  /** Discovery runs plus visible ledger rows for the authenticated user. */
  async getState() {
    return await importFetch<ImportState>('/import/state', { method: 'GET' });
  },

  /** Accept staged rows (starts import jobs) and/or discard staged rows. */
  async runImport(args: { import_ids: string[]; discard_ids: string[] }) {
    return await fetchWithToken<RunImportOutcome, typeof AI_USAGE_LIMIT_ERROR>(
      `${dcsHost}/import/run`,
      {
        method: 'POST',
        body: JSON.stringify(args),
        errorResponseHandler: aiUsageErrorResponseHandler,
      }
    );
  },

  /** Discover candidates for manual selection. */
  async discover(source: ImportSource) {
    return await importFetch(`/import/runs/${source}/discover`, {
      method: 'POST',
    });
  },

  /** Where the Notion workspace import stands. */
  async getNotionReport() {
    return await importFetch<NotionImportReport>('/import/notion', {
      method: 'GET',
    });
  },

  /** Stop planning or writing the Notion workspace import. */
  async cancelNotion() {
    return await importFetch<NotionImportReport>('/import/notion/cancel', {
      method: 'POST',
    });
  },
};
