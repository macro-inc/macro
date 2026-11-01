use crate::{constants::SYSTEM_AUTHOR_ID, timeit};
use tracing::{error, trace};
use wasm_bindgen::JsValue;
use worker::D1Database;

/// Records who a peer edits as: the user whose token registered it, and the
/// signed agent actor when the edit came from an agent acting for that user.
/// The first owner keeps the peer, so a later registration of the same id can't
/// re-attribute its edits; only a peer the system author holds (one an
/// initialized snapshot wrote) is claimed by the user who registers it.
pub async fn insert_user_mapping(
    db: D1Database,
    user_id: &str,
    actor: Option<&str>,
    peer_id: u64,
    document_id: &str,
) -> worker::Result<()> {
    let elapsed = timeit!({
        let dbres = db.prepare(
            "INSERT INTO peer_user_map (document_id, peer_id, user_id, actor) VALUES (?, ?, ?, ?) \
             ON CONFLICT(document_id, peer_id) DO UPDATE SET \
                user_id = excluded.user_id, \
                actor = excluded.actor \
             WHERE peer_user_map.user_id = ?;",
        )
        .bind(&[
            document_id.into(),
            peer_id.to_string().into(),
            user_id.into(),
            actor.map_or(JsValue::NULL, JsValue::from),
            SYSTEM_AUTHOR_ID.into(),
        ])?
        .run()
        .await?;
        if let Some(e) = dbres.error() {
            error!(
                error = e,
                user_id = user_id,
                user_id = user_id,
                document_id = document_id,
                "Error within D1"
            );
            return Err(worker::Error::from(e));
        }
        dbres
    })
    .1;
    trace!(
        user_id = user_id,
        user_id = user_id,
        document_id = document_id,
        duration_ms = elapsed.as_millis(),
        "insert_peer_user_document_mapping"
    );
    Ok(())
}

/// Map peers that wrote operations to `user_id` (and the agent `actor` they
/// wrote as), keeping any mapping a peer already has: a peer that registered
/// explicitly stays with its owner.
pub async fn insert_missing_user_mappings(
    db: &D1Database,
    document_id: &str,
    user_id: &str,
    actor: Option<&str>,
    peer_ids: &[u64],
) -> worker::Result<()> {
    for chunk in peer_ids.chunks(BATCH_CHUNK_SIZE) {
        let statements = chunk
            .iter()
            .map(|peer_id| {
                db.prepare(
                    "INSERT OR IGNORE INTO peer_user_map (document_id, peer_id, user_id, actor) VALUES (?, ?, ?, ?);",
                )
                .bind(&[
                    document_id.into(),
                    peer_id.to_string().into(),
                    user_id.into(),
                    actor.map_or(JsValue::NULL, JsValue::from),
                ])
            })
            .collect::<worker::Result<Vec<_>>>()?;
        db.batch(statements).await?;
    }
    Ok(())
}

/// Give a copied document the source document's peer mappings. Existing
/// mappings on the target are kept.
pub async fn copy_user_mappings(
    db: &D1Database,
    source_document_id: &str,
    target_document_id: &str,
) -> worker::Result<()> {
    db.prepare(
        "INSERT OR IGNORE INTO peer_user_map (document_id, peer_id, user_id, actor) \
         SELECT ?, peer_id, user_id, actor FROM peer_user_map WHERE document_id = ?;",
    )
    .bind(&[target_document_id.into(), source_document_id.into()])?
    .run()
    .await?;
    Ok(())
}

pub async fn get_user_id_from_peer_id(
    db: D1Database,
    document_id: &str,
    peer_id: &u64,
) -> worker::Result<String> {
    let statement = db.prepare(
        "
            SELECT user_id
            FROM peer_user_map
            WHERE document_id = ? AND peer_id = ?;
        ",
    );
    let Some(user_id) = statement
        .bind(&[document_id.into(), (*peer_id).to_string().into()])?
        .first(Some("user_id"))
        .await?
    else {
        return Err(worker::Error::from("no user found for peer id"));
    };

    Ok(user_id)
}

pub use crate::domain::models::PeerWithUserId;

pub async fn get_peers_for_document_id(
    db: D1Database,
    document_id: &str,
) -> worker::Result<Vec<PeerWithUserId>> {
    let statement = db.prepare(
        "
            SELECT peer_id, user_id, actor
            FROM peer_user_map
            WHERE document_id = ?;
        ",
    );

    let result = statement.bind(&[document_id.into()])?.all().await?;

    let peers = result.results::<PeerWithUserId>()?;

    Ok(peers)
}

/// A single pending "last edited by" event, buffered until the
/// next alarm tick flushes everything
#[derive(Debug, Clone)]
pub struct BlameEvent {
    pub document_id: String,
    pub node_id: String,
    pub peer_id: u64,
    pub timestamp_ms: i64,
}

/// Maximum statements per D1 `batch()` call. D1 has a per-batch statement
/// limit; chunking keeps us comfortably under it.
const BATCH_CHUNK_SIZE: usize = 100;

/// Bulk-upsert a list of buffered blame events. Uses D1's `batch()` so all
/// events in a chunk commit in a single round-trip.
pub async fn insert_blame_many(env: &worker::Env, events: &[BlameEvent]) -> worker::Result<()> {
    if events.is_empty() {
        return Ok(());
    }
    tracing::info!(count = events.len(), "insert_blame_many");

    for chunk in events.chunks(BATCH_CHUNK_SIZE) {
        let db = env.d1(crate::constants::USER_PEER_D1_BINDING)?;
        let stmts: Vec<_> = chunk
            .iter()
            .map(|e| {
                db.prepare(
                    "INSERT INTO blame (document_id, node_id, peer_id, timestamp_ms) \
                     VALUES (?, ?, ?, ?) \
                     ON CONFLICT(document_id, node_id) DO UPDATE SET \
                        peer_id = excluded.peer_id, \
                        timestamp_ms = excluded.timestamp_ms;",
                )
                .bind(&[
                    e.document_id.as_str().into(),
                    e.node_id.as_str().into(),
                    e.peer_id.to_string().into(),
                    // d1 js doesn't support bigint
                    (e.timestamp_ms as f64).into(),
                ])
            })
            .collect::<worker::Result<Vec<_>>>()?;
        db.batch(stmts).await?;
    }
    Ok(())
}

/// Delete every peer mapping and blame row recorded for a document.
pub async fn delete_document_rows(db: D1Database, document_id: &str) -> worker::Result<()> {
    let statements = [
        "DELETE FROM peer_user_map WHERE document_id = ?;",
        "DELETE FROM blame WHERE document_id = ?;",
    ]
    .into_iter()
    .map(|sql| db.prepare(sql).bind(&[document_id.into()]))
    .collect::<worker::Result<Vec<_>>>()?;
    db.batch(statements).await?;
    Ok(())
}

pub use crate::domain::models::BlameRow;

/// JOIN blame with peer_user_map to get last-edit info plus resolved user_id.
pub async fn get_blame_for_node(
    db: D1Database,
    document_id: &str,
    node_id: &str,
) -> worker::Result<Option<BlameRow>> {
    let statement = db.prepare(
        "
            SELECT b.peer_id AS peer_id,
                   p.user_id AS user_id,
                   p.actor AS actor,
                   b.timestamp_ms AS timestamp_ms
            FROM blame b
            LEFT JOIN peer_user_map p
                   ON p.document_id = b.document_id
                  AND p.peer_id = b.peer_id
            WHERE b.document_id = ? AND b.node_id = ?
            LIMIT 1;
        ",
    );
    let result = statement
        .bind(&[document_id.into(), node_id.into()])?
        .all()
        .await?;
    let mut rows = result.results::<BlameRow>()?;
    let row = rows.pop();
    tracing::info!(
        document_id = document_id,
        node_id = node_id,
        found = row.is_some(),
        "get_blame_for_node"
    );
    Ok(row)
}
