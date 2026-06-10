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

/// Record "last edited by" for a batch of Lexical nodes touched by a single
/// update. Stamps all rows with the current time.
pub async fn record_blame(
    env: &worker::Env,
    document_id: &str,
    peer_id: u64,
    node_ids: &[String],
) -> worker::Result<()> {
    let now_ms = web_time::SystemTime::now()
        .duration_since(web_time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    tracing::info!(
        document_id = document_id,
        peer_id = peer_id,
        count = node_ids.len(),
        node_ids = ?node_ids,
        "record_blame"
    );
    for node_id in node_ids {
        let db = env.d1(crate::constants::USER_PEER_D1_BINDING)?;
        if let Err(e) = upsert_blame(db, document_id, node_id, peer_id, now_ms).await {
            tracing::error!(error = ?e, node_id = node_id, "upsert_blame failed");
            return Err(e);
        }
    }
    Ok(())
}

/// Upsert a single (document_id, node_id) -> (peer_id, timestamp_ms) row.
pub async fn upsert_blame(
    db: D1Database,
    document_id: &str,
    node_id: &str,
    peer_id: u64,
    timestamp_ms: i64,
) -> worker::Result<()> {
    let result = db
        .prepare(
            "INSERT INTO blame (document_id, node_id, peer_id, timestamp_ms) \
             VALUES (?, ?, ?, ?) \
             ON CONFLICT(document_id, node_id) DO UPDATE SET \
                peer_id = excluded.peer_id, \
                timestamp_ms = excluded.timestamp_ms;",
        )
        .bind(&[
            document_id.into(),
            node_id.into(),
            peer_id.to_string().into(),
            // d1 js doesn't support bigint
            (timestamp_ms as f64).into(),
        ])?
        .run()
        .await?;
    if let Some(e) = result.error() {
        error!(error = e, "upsert_blame D1 error");
        return Err(worker::Error::from(e));
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
