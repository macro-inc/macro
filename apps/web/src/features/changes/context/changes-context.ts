/**
 * The capabilities the Changes pane needs from its host, and the contract
 * its views consume.
 *
 * Host adapters supply source reads and explicit actions. changes.tsx builds
 * the shared controller; tests supply fakes. The contract has no production
 * service dependencies or implicit host fallback.
 */

import type { Accessor } from 'solid-js';
import type { ChangesSummary } from '../core/changeset';
import type { DiffStyle, PaneLayout } from '../core/layout';

export type QueryStatus = 'idle' | 'pending' | 'error' | 'success';

/** A patch read for one changeset id, started and stopped by the caller. */
export type PatchRead = {
  text: Accessor<string | undefined>;
  status: Accessor<QueryStatus>;
  retry: () => void;
};

/** How the pane reads and refreshes a pull request snapshot. */
export type ChangesSource = {
  /** The latest summary; undefined until the first read lands. */
  summary: Accessor<ChangesSummary | undefined>;
  summaryStatus: Accessor<QueryStatus>;
  /**
   * Read the patch behind a changeset. Runs only while `enabled` is true, so
   * a closed pane never pulls the diff.
   */
  patch: (
    changesetId: Accessor<string | undefined>,
    enabled: Accessor<boolean>
  ) => PatchRead;
  /** Ask for a fresh capture. Resolves once the request is accepted. */
  refresh: () => Promise<void>;
};

/** Optional review-note handoff supplied by an agent host. */
export type ChangesAgent = {
  send: (markdown: string) => void;
  canSend: Accessor<boolean>;
};

/** Host capabilities, independent of whether the host is a session or PR. */
export type ChangesHost = {
  /** Stable identity for local review state; use a namespaced id for PR entities. */
  scopeKey: Accessor<string | undefined>;
  /** Omit for a read-only viewer without agent note controls. */
  agent?: ChangesAgent;
  /**
   * Whether the source can ever hold changes. Omit for hosts that always
   * can (a PR entity); a session host reports false for a chat-only
   * harness or a session with no linked pull request, which hides every
   * Changes control instead of showing an empty pane.
   */
  canHaveChanges?: Accessor<boolean>;
  /** GitHub API totals; undefined while unavailable, with no estimated fallback. */
  pullRequestChangeCounts?: Accessor<
    { additions: number; deletions: number } | undefined
  >;
  /** The PR title from the host's existing query, when known. */
  pullRequestTitle?: Accessor<string | undefined>;
  /** The pull request represented by the source. */
  pullRequestUrl: Accessor<string | undefined>;
  openExternal: (url: string) => void;
  copyText: (text: string) => Promise<boolean>;
  notify: (message: string, tone: 'success' | 'failure') => void;
};

/** Which layout the pane is in, and how its diffs are drawn. */
export type PaneViewState = {
  layout: Accessor<PaneLayout>;
  setLayout: (layout: PaneLayout) => void;
  diffStyle: Accessor<DiffStyle>;
  setDiffStyle: (style: DiffStyle) => void;
};

export type ChangesContext = {
  source: ChangesSource;
  host: ChangesHost;
};
