//! Database-only operator tooling. No application request or authorization path.
//!
//! Every run projects the legacy `crm_thread` / `crm_comment` rows onto the
//! shared message tables in one transaction. A comment keeps its id as its
//! message id, and a thread's root is its first comment by creation time, so
//! reruns agree on identity without a mapping table. Rows whose projection
//! already matches are left alone, and a store row that changed after it was
//! imported is never reverted by an older legacy row.

use std::fmt;

use sqlx::{Connection, PgConnection, Postgres, Transaction};

#[cfg(test)]
mod test;

/// Distinct from the document comment importer's lock.
const LOCK_ID: i64 = 732_847_302;

/// What a run found and wrote.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(super) struct Report {
    /// Legacy data the store cannot represent; any makes a run abort.
    pub blockers: Blockers,
    /// Legacy comments with no message yet, before this run.
    pub pending_comments: i64,
    /// Legacy comments that differ from their imported message and are at
    /// least as new, before this run.
    pub stale_comments: i64,
    /// Legacy threads with no comments, which have nothing to import.
    pub empty_threads: i64,
    /// Messages this run inserted.
    pub messages_inserted: u64,
    /// Messages this run updated from newer legacy rows.
    pub messages_updated: u64,
    /// Thread rows this run inserted or updated.
    pub threads_written: u64,
    /// Import invariants after the run; all zero on success.
    pub invariants: Invariants,
}

/// Legacy fields with no place in the message store.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(super) struct Blockers {
    /// Threads or comments carrying client metadata.
    pub metadata: i64,
    /// Comments whose sender differs from their owner.
    pub foreign_senders: i64,
    /// Comments with an explicit display order.
    pub explicit_order: i64,
    /// Comment ids already used by a message this importer did not write.
    pub id_collisions: i64,
}

impl Blockers {
    fn any(&self) -> bool {
        self.metadata + self.foreign_senders + self.explicit_order + self.id_collisions > 0
    }
}

/// Checks that must all be zero once a run commits.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(super) struct Invariants {
    /// Legacy comments in a non-empty thread with no message.
    pub missing_messages: i64,
    /// Imported messages on another parent or thread than their legacy comment.
    pub misplaced_messages: i64,
    /// Imported roots with no thread row.
    pub roots_without_threads: i64,
    /// Imported messages whose content, sender, creation or deletion differs
    /// from a legacy comment that is at least as new.
    pub content_mismatches: i64,
}

impl Invariants {
    fn any(&self) -> bool {
        self.missing_messages
            + self.misplaced_messages
            + self.roots_without_threads
            + self.content_mismatches
            > 0
    }
}

impl fmt::Display for Report {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let b = &self.blockers;
        let i = &self.invariants;
        writeln!(
            f,
            "blockers: metadata={} foreign_senders={} explicit_order={} id_collisions={}",
            b.metadata, b.foreign_senders, b.explicit_order, b.id_collisions
        )?;
        writeln!(
            f,
            "pending: comments={} stale={} empty_threads={}",
            self.pending_comments, self.stale_comments, self.empty_threads
        )?;
        writeln!(
            f,
            "written: messages_inserted={} messages_updated={} threads_written={}",
            self.messages_inserted, self.messages_updated, self.threads_written
        )?;
        write!(
            f,
            "invariants: missing_messages={} misplaced_messages={} roots_without_threads={} content_mismatches={}",
            i.missing_messages, i.misplaced_messages, i.roots_without_threads, i.content_mismatches
        )
    }
}

/// Report blockers, pending work and invariants without writing.
pub(super) async fn check(connection: &mut PgConnection) -> Result<Report, rootcause::Report> {
    let mut tx = connection.begin().await?;
    let mut report = preflight(&mut tx).await?;
    report.invariants = invariants(&mut tx).await?;
    tx.rollback().await?;
    Ok(report)
}

/// Import everything pending in one transaction. Nothing is written when a
/// blocker is found or an invariant fails afterwards.
pub(super) async fn run(connection: &mut PgConnection) -> Result<Report, rootcause::Report> {
    let mut tx = connection.begin().await?;
    let acquired = sqlx::query_scalar!(
        r#"SELECT pg_try_advisory_xact_lock($1) AS "acquired!""#,
        LOCK_ID
    )
    .fetch_one(&mut *tx)
    .await?;
    if !acquired {
        rootcause::bail!("another CRM comment import is running");
    }
    lock_legacy_tables(&mut tx).await?;
    let mut report = preflight(&mut tx).await?;
    if report.blockers.any() {
        tx.rollback().await?;
        rootcause::bail!("preflight blocked the import:\n{report}");
    }
    let (inserted, updated) = upsert_messages(&mut tx).await?;
    report.messages_inserted = inserted;
    report.messages_updated = updated;
    report.threads_written = upsert_threads(&mut tx).await?;
    report.invariants = invariants(&mut tx).await?;
    if report.invariants.any() {
        tx.rollback().await?;
        rootcause::bail!("import invariants failed, nothing was written:\n{report}");
    }
    tx.commit().await?;
    Ok(report)
}

/// Legacy writes wait for the run instead of landing between the snapshot
/// and the invariants.
#[expect(
    clippy::disallowed_methods,
    reason = "utility statements carry no result shape for SQLx to check"
)]
async fn lock_legacy_tables(tx: &mut Transaction<'_, Postgres>) -> Result<(), sqlx::Error> {
    sqlx::query("SET LOCAL lock_timeout = '5s'")
        .execute(&mut **tx)
        .await?;
    sqlx::query("LOCK TABLE crm_thread, crm_comment IN SHARE ROW EXCLUSIVE MODE")
        .execute(&mut **tx)
        .await?;
    // The 5s timeout bounds only the table-lock wait.
    sqlx::query("SET LOCAL lock_timeout = 0")
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn preflight(tx: &mut Transaction<'_, Postgres>) -> Result<Report, rootcause::Report> {
    let row = sqlx::query!(
        r#"SELECT
            (SELECT count(*) FROM crm_thread WHERE metadata IS NOT NULL)
              + (SELECT count(*) FROM crm_comment WHERE metadata IS NOT NULL) AS "metadata!",
            (SELECT count(*) FROM crm_comment WHERE sender IS NOT NULL AND sender <> owner) AS "foreign_senders!",
            (SELECT count(*) FROM crm_comment WHERE "order" IS NOT NULL) AS "explicit_order!",
            (SELECT count(*) FROM crm_comment c JOIN comms_messages m ON m.id = c.id
              WHERE m.import_metadata->>'source' IS DISTINCT FROM 'crm_comment') AS "id_collisions!",
            (SELECT count(*) FROM crm_comment c
              WHERE NOT EXISTS (SELECT 1 FROM comms_messages m WHERE m.id = c.id)) AS "pending_comments!",
            (SELECT count(*) FROM crm_comment c
              JOIN crm_thread t ON t.id = c.thread_id
              JOIN comms_messages m ON m.id = c.id
              WHERE m.import_metadata->>'source' = 'crm_comment'
                AND m.updated_at <= c.updated_at
                AND (m.content, m.updated_at, m.deleted_at)
                    IS DISTINCT FROM
                    (c.text, c.updated_at, COALESCE(c.deleted_at, t.deleted_at) AT TIME ZONE 'UTC')) AS "stale_comments!",
            (SELECT count(*) FROM crm_thread t
              WHERE NOT EXISTS (SELECT 1 FROM crm_comment c WHERE c.thread_id = t.id)) AS "empty_threads!""#
    )
    .fetch_one(&mut **tx)
    .await?;
    Ok(Report {
        blockers: Blockers {
            metadata: row.metadata,
            foreign_senders: row.foreign_senders,
            explicit_order: row.explicit_order,
            id_collisions: row.id_collisions,
        },
        pending_comments: row.pending_comments,
        stale_comments: row.stale_comments,
        empty_threads: row.empty_threads,
        ..Default::default()
    })
}

/// Every legacy comment. A comment in a deleted thread reads as deleted. An
/// imported message changes only when the legacy row differs and is not older,
/// so an edit made through the new API is never reverted.
async fn upsert_messages(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<(u64, u64), rootcause::Report> {
    let rows = sqlx::query_scalar!(
        r#"INSERT INTO comms_messages (
               id, parent_entity_type, parent_entity_id, thread_id, sender_id, content,
               created_at, updated_at, edited_at, deleted_at, import_metadata
           )
           SELECT c.id,
               CASE WHEN t.contact_id IS NULL THEN 'crm_company' ELSE 'crm_contact' END,
               COALESCE(t.contact_id, t.company_id)::text,
               NULLIF(first_value(c.id) OVER (PARTITION BY c.thread_id ORDER BY c.created_at, c.id), c.id),
               c.owner, c.text, c.created_at, c.updated_at,
               CASE WHEN c.updated_at > c.created_at THEN c.updated_at AT TIME ZONE 'UTC' END,
               COALESCE(c.deleted_at, t.deleted_at) AT TIME ZONE 'UTC',
               jsonb_build_object('source', 'crm_comment', 'legacy_thread_id', c.thread_id)
           FROM crm_comment c
           JOIN crm_thread t ON t.id = c.thread_id
           ON CONFLICT (id) DO UPDATE SET
               content = EXCLUDED.content,
               updated_at = EXCLUDED.updated_at,
               edited_at = EXCLUDED.edited_at,
               deleted_at = EXCLUDED.deleted_at
           WHERE comms_messages.import_metadata->>'source' = 'crm_comment'
             AND comms_messages.updated_at <= EXCLUDED.updated_at
             AND (comms_messages.content, comms_messages.updated_at, comms_messages.edited_at,
                  comms_messages.deleted_at)
                 IS DISTINCT FROM
                 (EXCLUDED.content, EXCLUDED.updated_at, EXCLUDED.edited_at, EXCLUDED.deleted_at)
           RETURNING (xmax = 0) AS "inserted!""#
    )
    .fetch_all(&mut **tx)
    .await?;
    let inserted = rows.iter().filter(|inserted| **inserted).count() as u64;
    Ok((inserted, rows.len() as u64 - inserted))
}

/// One thread row per non-empty legacy thread, keyed by its root comment, with
/// the same newer-wins rule as messages. Inserting a root makes the store's
/// trigger initialize a bare thread row; the id-collision blocker guarantees any
/// such row on an imported root came from this run, so it is taken over.
async fn upsert_threads(tx: &mut Transaction<'_, Postgres>) -> Result<u64, rootcause::Report> {
    let written = sqlx::query!(
        r#"INSERT INTO comms_message_threads (
               root_id, parent_entity_type, parent_entity_id, user_id, resolved,
               import_metadata, created_at, updated_at, deleted_at
           )
           SELECT root.id,
               CASE WHEN t.contact_id IS NULL THEN 'crm_company' ELSE 'crm_contact' END,
               COALESCE(t.contact_id, t.company_id)::text,
               t.owner, t.resolved,
               jsonb_build_object('source', 'crm_thread', 'legacy_thread_id', t.id),
               t.created_at, t.updated_at, t.deleted_at
           FROM crm_thread t
           CROSS JOIN LATERAL (
               SELECT c.id FROM crm_comment c
               WHERE c.thread_id = t.id
               ORDER BY c.created_at, c.id
               LIMIT 1
           ) root
           ON CONFLICT (root_id) DO UPDATE SET
               user_id = EXCLUDED.user_id,
               resolved = EXCLUDED.resolved,
               import_metadata = EXCLUDED.import_metadata,
               created_at = EXCLUDED.created_at,
               updated_at = EXCLUDED.updated_at,
               deleted_at = EXCLUDED.deleted_at
           WHERE (comms_message_threads.import_metadata IS NULL
                  OR (comms_message_threads.import_metadata->>'source' = 'crm_thread'
                      AND comms_message_threads.updated_at <= EXCLUDED.updated_at))
             AND (comms_message_threads.import_metadata,
                  comms_message_threads.user_id, comms_message_threads.resolved,
                  comms_message_threads.created_at, comms_message_threads.updated_at,
                  comms_message_threads.deleted_at)
                 IS DISTINCT FROM
                 (EXCLUDED.import_metadata, EXCLUDED.user_id, EXCLUDED.resolved,
                  EXCLUDED.created_at, EXCLUDED.updated_at, EXCLUDED.deleted_at)"#
    )
    .execute(&mut **tx)
    .await?
    .rows_affected();
    Ok(written)
}

async fn invariants(tx: &mut Transaction<'_, Postgres>) -> Result<Invariants, rootcause::Report> {
    let row = sqlx::query!(
        r#"WITH legacy AS (
               SELECT c.id, c.text, c.owner, c.created_at, c.updated_at,
                   COALESCE(c.deleted_at, t.deleted_at) AT TIME ZONE 'UTC' AS deleted_at,
                   CASE WHEN t.contact_id IS NULL THEN 'crm_company' ELSE 'crm_contact' END AS parent_type,
                   COALESCE(t.contact_id, t.company_id)::text AS parent_id,
                   NULLIF(first_value(c.id) OVER (PARTITION BY c.thread_id ORDER BY c.created_at, c.id), c.id) AS root_id
               FROM crm_comment c
               JOIN crm_thread t ON t.id = c.thread_id
           )
           SELECT
               count(*) FILTER (WHERE m.id IS NULL) AS "missing_messages!",
               count(*) FILTER (
                   WHERE m.id IS NOT NULL
                     AND (m.parent_entity_type, m.parent_entity_id, m.thread_id)
                         IS DISTINCT FROM (l.parent_type, l.parent_id, l.root_id)
               ) AS "misplaced_messages!",
               count(*) FILTER (
                   WHERE m.id IS NOT NULL AND l.root_id IS NULL
                     AND NOT EXISTS (SELECT 1 FROM comms_message_threads th WHERE th.root_id = m.id)
               ) AS "roots_without_threads!",
               count(*) FILTER (
                   WHERE m.updated_at <= l.updated_at
                     AND (m.content, m.sender_id, m.created_at, m.deleted_at)
                         IS DISTINCT FROM (l.text, l.owner, l.created_at, l.deleted_at)
               ) AS "content_mismatches!"
           FROM legacy l
           LEFT JOIN comms_messages m ON m.id = l.id"#
    )
    .fetch_one(&mut **tx)
    .await?;
    Ok(Invariants {
        missing_messages: row.missing_messages,
        misplaced_messages: row.misplaced_messages,
        roots_without_threads: row.roots_without_threads,
        content_mismatches: row.content_mismatches,
    })
}
