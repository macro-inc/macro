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
