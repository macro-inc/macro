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
import type { PullRequestDraft } from '../core/pull-request';

export type QueryStatus = 'idle' | 'pending' | 'error' | 'success';

/** A patch read for one changeset id, started and stopped by the caller. */
export type PatchRead = {
  text: Accessor<string | undefined>;
  status: Accessor<QueryStatus>;
  retry: () => void;
};

/** How the pane reads and asks for the session's changes. */
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
  /** Draft a pull request title and body from the current changeset. */
  draftPullRequest: () => Promise<PullRequestDraft>;
};

/** What the surrounding session lends the pane. */
export type ChangesHost = {
  sessionId: Accessor<string | undefined>;
  /** Post markdown to the agent as the current user. */
  sendToAgent: (markdown: string) => void;
  /** Whether a prompt can be posted right now. */
  canSend: Accessor<boolean>;
  /** The agent is mid-turn. */
  working: Accessor<boolean>;
  /** The session's linked pull request, when one exists. */
  pullRequestUrl: Accessor<string | undefined>;
  openExternal: (url: string) => void;
  copyText: (text: string) => Promise<boolean>;
  notify: (message: string, tone: 'success' | 'failure') => void;
};

export type AgentChangesContext = {
  source: ChangesSource;
  host: ChangesHost;
};
