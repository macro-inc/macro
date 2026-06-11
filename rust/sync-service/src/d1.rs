use crate::timeit;
use tracing::{error, trace};
use worker::D1Database;
pub async fn insert_user_mapping(
    db: D1Database,
    user_id: &str,
    peer_id: u64,
    document_id: &str,
) -> worker::Result<()> {
    let elapsed = timeit!({
        let dbres = db.prepare(
            "INSERT OR REPLACE INTO peer_user_map (document_id, peer_id, user_id) VALUES (?, ?, ?);",
        )
        .bind(&[
            document_id.into(),
            peer_id.to_string().into(),
            user_id.into(),
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

#[derive(serde::Deserialize, serde::Serialize)]
pub struct PeerWithUserId {
    pub peer_id: String,
    pub user_id: String,
}

pub async fn get_peers_for_document_id(
    db: D1Database,
    document_id: &str,
) -> worker::Result<Vec<PeerWithUserId>> {
    let statement = db.prepare(
        "
            SELECT peer_id, user_id
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
pub async fn insert_blame_many(
    env: &worker::Env,
    events: &[BlameEvent],
) -> worker::Result<()> {
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


#[derive(serde::Deserialize, serde::Serialize)]
pub struct BlameRow {
    pub peer_id: String,
    pub user_id: Option<String>,
    pub timestamp_ms: i64,
}

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
