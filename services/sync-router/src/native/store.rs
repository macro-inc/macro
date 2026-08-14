//! Postgres persistence for the native sync machines: the `sync_document`,
//! `sync_document_op`, `sync_peer_user`, and `sync_blame` tables from the
//! `sync_service_native_tables` migration.

use sqlx::PgPool;
use sync_machine::model::BlameEvent;

/// See the module docs. Cheap to clone (pool handle).
#[derive(Clone)]
pub struct PgSyncStore {
    pool: PgPool,
}

struct SnapshotRow {
    snapshot: Vec<u8>,
    snapshot_seq: i64,
}

struct OpRow {
    seq: i64,
    payload: Vec<u8>,
}

impl PgSyncStore {
    /// Wrap a pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Everything stored for a document: the snapshot (if any), the sequence
    /// it covers, and the still-uncompacted op tail in ascending order.
    pub async fn load(
        &self,
        doc: &str,
    ) -> Result<(Option<Vec<u8>>, u64, Vec<(u64, Vec<u8>)>), sqlx::Error> {
        let snapshot_row = sqlx::query_as!(
            SnapshotRow,
            r#"SELECT snapshot, snapshot_seq FROM sync_document WHERE document_id = $1"#,
            doc,
        )
        .fetch_optional(&self.pool)
        .await?;
        let (snapshot, snapshot_seq) = match snapshot_row {
            Some(row) => (Some(row.snapshot), row.snapshot_seq as u64),
            None => (None, 0),
        };

        let ops = sqlx::query_as!(
            OpRow,
            r#"SELECT seq, payload FROM sync_document_op
               WHERE document_id = $1 AND seq > $2 ORDER BY seq"#,
            doc,
            snapshot_seq as i64,
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|row| (row.seq as u64, row.payload))
        .collect();

        Ok((snapshot, snapshot_seq, ops))
    }

    /// Durably append ops. Idempotent per (document, seq) so a retry after a
    /// partially-committed batch cannot fail or duplicate.
    pub async fn append_ops(&self, doc: &str, ops: &[(u64, Vec<u8>)]) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        for (seq, payload) in ops {
            sqlx::query!(
                r#"INSERT INTO sync_document_op (document_id, seq, payload)
                   VALUES ($1, $2, $3) ON CONFLICT (document_id, seq) DO NOTHING"#,
                doc,
                *seq as i64,
                payload,
            )
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await
    }

    /// Store a snapshot covering ops through `through_seq` and truncate the
    /// covered op rows, atomically.
    pub async fn store_snapshot(
        &self,
        doc: &str,
        snapshot: &[u8],
        through_seq: u64,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query!(
            r#"INSERT INTO sync_document (document_id, snapshot, snapshot_seq)
               VALUES ($1, $2, $3)
               ON CONFLICT (document_id) DO UPDATE SET
                  snapshot = EXCLUDED.snapshot,
                  snapshot_seq = EXCLUDED.snapshot_seq,
                  updated_at = now()"#,
            doc,
            snapshot,
            through_seq as i64,
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query!(
            r#"DELETE FROM sync_document_op WHERE document_id = $1 AND seq <= $2"#,
            doc,
            through_seq as i64,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await
    }

    /// Upsert a CRDT peer → user binding.
    pub async fn record_peer_mapping(
        &self,
        doc: &str,
        peer_id: u64,
        user_id: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"INSERT INTO sync_peer_user (document_id, peer_id, user_id)
               VALUES ($1, $2, $3)
               ON CONFLICT (document_id, peer_id) DO UPDATE SET user_id = EXCLUDED.user_id"#,
            doc,
            peer_id as i64,
            user_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Upsert last-editor rows for the touched Lexical nodes.
    pub async fn record_blame(&self, doc: &str, events: &[BlameEvent]) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        for event in events {
            sqlx::query!(
                r#"INSERT INTO sync_blame (document_id, lexical_node_id, peer_id, edited_at)
                   VALUES ($1, $2, $3, now())
                   ON CONFLICT (document_id, lexical_node_id) DO UPDATE SET
                      peer_id = EXCLUDED.peer_id, edited_at = now()"#,
                doc,
                event.node_id,
                event.peer_id as i64,
            )
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await
    }
}
