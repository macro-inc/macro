use crate::timeit;
use std::collections::HashMap;
use tracing::{error, trace};
use worker::D1Database;

#[derive(serde::Deserialize, serde::Serialize, Clone)]
pub struct VersionPin {
    pub id: String,
    pub label: String,
    pub created_by: String,
    pub pinned_at_ms: i64,
}

pub async fn insert_pin(db: D1Database, pin: &VersionPin) -> worker::Result<()> {
    let resp = db
        .prepare(
            "INSERT INTO version_pins (id, label, created_by, pinned_at_ms) VALUES (?, ?, ?, ?);",
        )
        .bind(&[
            pin.id.as_str().into(),
            pin.label.as_str().into(),
            pin.created_by.as_str().into(),
            (pin.pinned_at_ms as f64).into(),
        ])?
        .run()
        .await?;
    if let Some(e) = resp.error() {
        error!(error = e, pin_id = pin.id, "Error inserting pin into D1");
        return Err(worker::Error::from(e));
    }
    Ok(())
}

pub async fn get_pins(db: D1Database) -> worker::Result<Vec<VersionPin>> {
    let result = db
        .prepare(
            "SELECT id, label, created_by, pinned_at_ms FROM version_pins ORDER BY pinned_at_ms ASC;",
        )
        .all()
        .await?;
    Ok(result.results::<VersionPin>()?)
}

pub async fn delete_pin(db: D1Database, pin_id: &str) -> worker::Result<bool> {
    let resp = db
        .prepare("DELETE FROM version_pins WHERE id = ?;")
        .bind(&[pin_id.into()])?
        .run()
        .await?;
    if let Some(e) = resp.error() {
        error!(error = e, pin_id, "Error deleting pin from D1");
        return Err(worker::Error::from(e));
    }
    let deleted = resp
        .meta()?
        .and_then(|m| m.changes)
        .map(|c| c > 0)
        .unwrap_or(false);
    Ok(deleted)
}
pub async fn insert_user_mapping(
    db: D1Database,
    user_id: &str,
    peer_id: u64,
    document_id: &str,
) -> worker::Result<()> {
    let elapsed = timeit!({
        let resp = db.prepare(
            "INSERT OR REPLACE INTO peer_user_map (document_id, peer_id, user_id) VALUES (?, ?, ?);",
        )
        .bind(&[
            document_id.into(),
            peer_id.to_string().into(),
            user_id.into(),
        ])?
        .run()
        .await?;
        if let Some(e) = resp.error() {
            error!(
                error = e,
                user_id = user_id,
                user_id = user_id,
                document_id = document_id,
                "Error within D1"
            );
            return Err(worker::Error::from(e));
        }
        resp
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
) -> worker::Result<HashMap<String, String>> {
    let statement = db.prepare(
        "
            SELECT peer_id, user_id
            FROM peer_user_map
            WHERE document_id = ?;
        ",
    );

    let result = statement.bind(&[document_id.into()])?.all().await?;

    let peers = result.results::<PeerWithUserId>()?;

    Ok(peers.into_iter().map(|p| (p.peer_id, p.user_id)).collect())
}
