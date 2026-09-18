/**
 * In-memory implementations of the pane's capabilities, so view and
 * primitive tests run the real feature code against controllable data.
 */

import { createSignal } from 'solid-js';
import type {
  AgentChangesContext,
  ChangesAgent,
  ChangesHost,
  ChangesSource,
  PatchRead,
  QueryStatus,
} from '../context/agent-changes-context';
import type { Changeset, SessionChanges } from '../core/changeset';

export const MOCK_PATCH = `diff --git a/apps/web/src/a.ts b/apps/web/src/a.ts
index 1111111..2222222 100644
--- a/apps/web/src/a.ts
+++ b/apps/web/src/a.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 export { a, b };
diff --git a/crates/x/src/lib.rs b/crates/x/src/lib.rs
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/crates/x/src/lib.rs
@@ -0,0 +1,2 @@
+pub fn x() {}
+pub fn y() {}
`;

export function mockChangeset(overrides: Partial<Changeset> = {}): Changeset {
  return {
    id: 'cs-1',
    repository: 'https://github.com/macro-inc/macro',
    base: { name: 'main' },
    head: { name: 'agent/unread-archived-sessions' },
    files: [
      {
        path: 'apps/web/src/a.ts',
        kind: 'modified',
        additions: 1,
        deletions: 1,
        binary: false,
        patchOmitted: false,
      },
      {
        path: 'crates/x/src/lib.rs',
        kind: 'added',
        additions: 2,
        deletions: 0,
        binary: false,
        patchOmitted: false,
      },
    ],
    additions: 3,
    deletions: 1,
    patchBytes: MOCK_PATCH.length,
    truncated: false,
    capturedAt: '2026-09-15T00:00:00Z',
    ...overrides,
  };
}

export type MockAgentChangesContext = AgentChangesContext & {
  host: ChangesHost & { agent: ChangesAgent };
  setSummary: (summary: SessionChanges | undefined) => void;
  setPatch: (patch: string | undefined) => void;
  setPullRequestUrl: (url: string | undefined) => void;
  sent: string[];
  opened: string[];
  notified: { message: string; tone: 'success' | 'failure' }[];
  refreshes: () => number;
};

export function createMockAgentChangesContext(
  options: {
    summary?: SessionChanges;
    patch?: string;
    canSend?: boolean;
    sessionId?: string;
  } = {}
): MockAgentChangesContext {
  const [summary, setSummary] = createSignal<SessionChanges | undefined>(
    options.summary
  );
  const [patch, setPatch] = createSignal<string | undefined>(options.patch);
  const [pullRequestUrl, setPullRequestUrl] = createSignal<string>();
  const sent: string[] = [];
  const opened: string[] = [];
  const notified: { message: string; tone: 'success' | 'failure' }[] = [];
  let refreshes = 0;

  const source: ChangesSource = {
    summary,
    summaryStatus: () => (summary() ? 'success' : 'pending'),
    patch: (changesetId, enabled): PatchRead => ({
      text: () => (enabled() && changesetId() ? patch() : undefined),
      status: (): QueryStatus =>
        !enabled() ? 'idle' : patch() === undefined ? 'pending' : 'success',
      retry: () => {},
    }),
    refresh: async () => {
      refreshes += 1;
    },
  };
  const host: ChangesHost & { agent: ChangesAgent } = {
    scopeKey: () => options.sessionId ?? 'session-1',
    agent: {
      send: (markdown) => void sent.push(markdown),
      canSend: () => options.canSend ?? true,
    },
    pullRequestUrl,
    openExternal: (url) => void opened.push(url),
    copyText: async () => true,
    notify: (message, tone) => void notified.push({ message, tone }),
  };
  return {
    source,
    host,
    setSummary,
    setPatch,
    setPullRequestUrl,
    sent,
    opened,
    notified,
    refreshes: () => refreshes,
  };
}
