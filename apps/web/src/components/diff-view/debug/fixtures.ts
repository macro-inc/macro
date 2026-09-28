/**
 * Example changes for the diff view's debug gallery, and for other
 * galleries that mount the view.
 */

import type { DiffFile } from '../model/diff-file';

/** A patch across the web app, two crates, and a migration. */
export const SAMPLE_PATCH = `diff --git a/apps/web/src/components/app/sidebar-next/queries/use-sidebar-unread.ts b/apps/web/src/components/app/sidebar-next/queries/use-sidebar-unread.ts
index 1111111..2222222 100644
--- a/apps/web/src/components/app/sidebar-next/queries/use-sidebar-unread.ts
+++ b/apps/web/src/components/app/sidebar-next/queries/use-sidebar-unread.ts
@@ -7,7 +7,8 @@
 import { createMemo } from 'solid-js';
 
 import { useAgentSessionsQuery } from '@queries/agent/sessions';
-import type { AgentSessionSummary } from '@service-agent-fold/generated/types';
+import { hasUnreadActivity } from '@block-agent/state/unread';
+import type { AgentSessionSummary } from '@service-agent-fold/generated/types';
 
 import type { SidebarItemId } from '../nav-items';
 
@@ -19,12 +20,15 @@ const DOTTED: readonly SidebarItemId[] = ['inbox', 'channels', 'agents'];
 export function useSidebarUnread(): (id: SidebarItemId) => boolean {
   const sessions = useAgentSessionsQuery();
 
-  // Activity after the read marker lights the dot.
-  const agentsUnread = createMemo(() =>
-    (sessions.data ?? []).some(
-      (session: AgentSessionSummary) => session.lastEventAt > session.lastReadAt
-    )
-  );
+  // Archiving takes a session off the inbox, so its activity stops being
+  // news. The rail has to ask the same question the agents list asks,
+  // through the same predicate.
+  const agentsUnread = createMemo(() =>
+    (sessions.data ?? []).some((session: AgentSessionSummary) =>
+      hasUnreadActivity(session)
+    )
+  );
 
   return (id) => (id === 'agents' ? agentsUnread() : false);
 }
diff --git a/apps/web/src/features/block-agent/state/unread.ts b/apps/web/src/features/block-agent/state/unread.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/apps/web/src/features/block-agent/state/unread.ts
@@ -0,0 +1,14 @@
+import type { AgentSessionSummary } from '@service-agent-fold/generated/types';
+
+/** An archived session is off the inbox, so its activity is not news. */
+export function isArchived(session: AgentSessionSummary): boolean {
+  return session.archivedAt != null;
+}
+
+export function hasUnreadActivity(session: AgentSessionSummary): boolean {
+  if (isArchived(session)) return false;
+  const lastEventAt = session.lastEventAt;
+  if (lastEventAt == null) return false;
+  return lastEventAt > (session.lastReadAt ?? 0);
+}
+
diff --git a/crates/macro_agent_sessions/src/service.rs b/crates/macro_agent_sessions/src/service.rs
index 4444444..5555555 100644
--- a/crates/macro_agent_sessions/src/service.rs
+++ b/crates/macro_agent_sessions/src/service.rs
@@ -85,8 +85,14 @@ impl SessionService {
     #[instrument(skip(self), fields(session_id = %id))]
     pub async fn archive(&self, id: AgentSessionId) -> Result<(), ArchiveError> {
-        self.repo.set_archived(id, Utc::now()).await?;
-        Ok(())
+        let now = Utc::now();
+        let mut tx = self.repo.begin().await?;
+
+        self.repo.set_archived(&mut tx, id, now).await?;
+        self.repo.mark_read(&mut tx, id, now).await?;
+
+        tx.commit().await?;
+        Ok(())
     }
 
     #[instrument(skip(self), fields(owner = %owner))]
diff --git a/crates/macro_agent_sessions/src/legacy_unread.rs b/crates/macro_agent_sessions/src/legacy_unread.rs
deleted file mode 100644
index 6666666..0000000
--- a/crates/macro_agent_sessions/src/legacy_unread.rs
+++ /dev/null
@@ -1,3 +0,0 @@
-pub fn unread(last_event_at: i64, last_read_at: i64) -> bool {
-    last_event_at > last_read_at
-}
diff --git a/crates/macro_db_client/migrations/20260914042311_agent_session_archived_index.sql b/crates/macro_db_client/migrations/20260914042311_agent_session_archived_index.sql
new file mode 100644
index 0000000..7777777
--- /dev/null
+++ b/crates/macro_db_client/migrations/20260914042311_agent_session_archived_index.sql
@@ -0,0 +1,5 @@
+-- Archived sessions drop out of the unread count. Without a partial index
+-- the filter falls back to a sequential scan on long workspace histories.
+CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_sessions_unread_active_idx
+    ON agent_sessions (owner_id, last_event_at DESC)
+    WHERE archived_at IS NULL;
`;

/** The files behind `SAMPLE_PATCH`, plus a binary file and a bare rename. */
export const SAMPLE_FILES: DiffFile[] = [
  {
    path: 'apps/web/src/components/app/sidebar-next/queries/use-sidebar-unread.ts',
    kind: 'modified',
    additions: 10,
    deletions: 7,
    binary: false,
    patchOmitted: false,
  },
  {
    path: 'apps/web/src/features/block-agent/state/unread.ts',
    kind: 'added',
    additions: 14,
    deletions: 0,
    binary: false,
    patchOmitted: false,
  },
  {
    path: 'crates/macro_agent_sessions/src/service.rs',
    kind: 'modified',
    additions: 8,
    deletions: 2,
    binary: false,
    patchOmitted: false,
  },
  {
    path: 'crates/macro_agent_sessions/src/legacy_unread.rs',
    kind: 'deleted',
    additions: 0,
    deletions: 3,
    binary: false,
    patchOmitted: false,
  },
  {
    path: 'crates/macro_db_client/migrations/20260914042311_agent_session_archived_index.sql',
    kind: 'added',
    additions: 5,
    deletions: 0,
    binary: false,
    patchOmitted: false,
  },
  {
    path: 'docs/agents/unread.md',
    previousPath: 'docs/unread.md',
    kind: 'renamed',
    additions: 0,
    deletions: 0,
    binary: false,
    patchOmitted: false,
  },
  {
    path: 'static_assets/logo.png',
    kind: 'modified',
    additions: 0,
    deletions: 0,
    binary: true,
    patchOmitted: false,
  },
];

const GENERATED_DIRECTORIES = [
  'apps/web/src/features/inbox/components',
  'apps/web/src/features/inbox/queries',
  'apps/web/src/lib/core/util',
  'crates/macro_inbox/src',
  'crates/macro_inbox/src/outbound',
  'packages/email-renderer/src',
];

/**
 * A changeset of `fileCount` modified files spread over a few directories,
 * each with one hunk, for trying the view at pull request sizes.
 */
export function generatedChanges(fileCount: number): {
  files: DiffFile[];
  patch: string;
} {
  const files: DiffFile[] = [];
  const parts: string[] = [];
  for (let index = 0; index < fileCount; index += 1) {
    const directory =
      GENERATED_DIRECTORIES[index % GENERATED_DIRECTORIES.length]!;
    const extension = directory.startsWith('crates') ? 'rs' : 'ts';
    const name = `generated_${String(index).padStart(3, '0')}.${extension}`;
    const path = `${directory}/${name}`;
    const lineCount = 8 + (index % 5) * 6;
    const body: string[] = [];
    let changed = 0;
    for (let line = 1; line <= lineCount; line += 1) {
      if (line % 4 === 0) {
        changed += 1;
        body.push(`-const value${line} = ${line};`);
        body.push(`+const value${line} = ${line * 2};`);
      } else {
        body.push(` const value${line} = ${line};`);
      }
    }
    parts.push(
      [
        `diff --git a/${path} b/${path}`,
        'index 1111111..2222222 100644',
        `--- a/${path}`,
        `+++ b/${path}`,
        `@@ -1,${lineCount} +1,${lineCount} @@`,
        ...body,
      ].join('\n')
    );
    files.push({
      path,
      kind: 'modified',
      additions: changed,
      deletions: changed,
      binary: false,
      patchOmitted: false,
    });
  }
  return { files, patch: `${parts.join('\n')}\n` };
}
