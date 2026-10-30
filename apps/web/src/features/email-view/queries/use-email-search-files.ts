import { arrayEquals } from '@core/util/compareUtils';
import { type EmailEntity, isEmailEntity } from '@entity';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { buildEmailQuery, type EmailQueryContext } from './email-query';
import {
  buildEmailSearchFileRows,
  collectEmailSearchFiles,
  type EmailSearchFilesItem,
} from './email-search-files';

/** Files come from the most relevant results; a compact section needs no more. */
export const EMAIL_SEARCH_FILE_THREAD_LIMIT = 25;

export type EmailSearchFiles = {
  rows: Accessor<EmailSearchFilesItem[]>;
  toggleExpanded: () => void;
};

/**
 * Search results carry no attachments, so the top matched threads are read
 * again from Soup by ID. The lookup starts once results arrive and never
 * holds them back; a pending or failed lookup simply lists no files.
 */
export function useEmailSearchFiles(input: {
  threads: Accessor<readonly EmailEntity[]>;
  query: Accessor<string>;
  context: Accessor<EmailQueryContext>;
}): EmailSearchFiles {
  const topThreads = () =>
    input.threads().slice(0, EMAIL_SEARCH_FILE_THREAD_LIMIT);
  // Result updates that keep the same threads must not restart the lookup.
  const threadIds = createMemo(
    () => topThreads().map((thread) => thread.id),
    [],
    { equals: arrayEquals }
  );

  // The search already decided which threads belong to the tab; the lookup
  // only reads their attachments, so it asks in the All view.
  const lookup = useSoupAstItemsQuery(
    () => buildEmailQuery({ ...input.context(), tab: 'all' }, threadIds()),
    () => ({ enabled: threadIds().length > 0, keepPreviousData: false })
  );

  const files = createMemo(() => {
    if (threadIds().length === 0) return [];
    if (lookup.isPending || lookup.isPlaceholderData) return [];
    const details = new Map(
      (lookup.data?.entities ?? [])
        .filter(isEmailEntity)
        .map((entity) => [entity.id, entity])
    );
    return collectEmailSearchFiles(topThreads(), details, input.query());
  });

  // Expansion belongs to one search; new search text starts collapsed.
  const [expandedQuery, setExpandedQuery] = createSignal<string>();
  const expanded = () => expandedQuery() === input.query();

  return {
    rows: () => buildEmailSearchFileRows(files(), expanded()),
    toggleExpanded: () =>
      setExpandedQuery(expanded() ? undefined : input.query()),
  };
}
