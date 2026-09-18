/**
 * The capabilities the Changes pane needs from its host, and the contract
 * its views consume.
 *
 * Production wiring (`../agent-changes.tsx`) builds these from the real
 * queries and the agent-session block; tests hand in fakes. Nothing under
 * `queries/`, `primitives/`, `components/`, or `views/` imports app
 * singletons directly.
 */

import type { Accessor } from 'solid-js';
import type { SessionChanges } from '../core/changeset';

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
  summary: Accessor<SessionChanges | undefined>;
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
  /** The pull request represented by the source. */
  pullRequestUrl: Accessor<string | undefined>;
  openExternal: (url: string) => void;
  copyText: (text: string) => Promise<boolean>;
  notify: (message: string, tone: 'success' | 'failure') => void;
};

export type AgentChangesContext = {
  source: ChangesSource;
  host: ChangesHost;
};
