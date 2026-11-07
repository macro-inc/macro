use worker::{Error, Result};

use super::Wsm;
use crate::{constants::USER_PEER_D1_BINDING, d1::insert_missing_user_mappings};

impl Wsm<'_, '_> {
    /// Map peers that wrote through this socket without registering first (a
    /// client's peer id can change, and offline edits replay under an old one).
    /// Unlike registration this keeps existing mappings and leaves the
    /// socket's own peers, and so presence, unchanged.
    pub async fn add_writing_peerids(&mut self, peerids: &[u64], document_id: &str) -> Result<()> {
        self.maybe_update_ws_meta_map().await?;
        let ws_id = self.get_ws_id()?.to_string();
        let (user_id, actor) = {
            let wmm = &self.dss.connections;
            let meta = wmm.get(&ws_id).ok_or(Error::from("missing ws metadata"))?;
            let Some(user_id) = meta.user_id.clone() else {
                return Ok(());
            };
            (user_id, meta.actor.clone())
        };
        let new_peers: Vec<u64> = {
            let mapped = &self.dss.mapped_writing_peers;
            peerids
                .iter()
                .copied()
                .filter(|peer| !mapped.contains(peer))
                .collect()
        };
        if new_peers.is_empty() {
            return Ok(());
        }
        let db = self.dss.env.d1(USER_PEER_D1_BINDING)?;
        insert_missing_user_mappings(&db, document_id, &user_id, actor.as_deref(), &new_peers)
            .await?;
        // Remembered only once stored, so a failed write is retried with the
        // client's resent update.
        self.dss.mapped_writing_peers.extend(
            new_peers
                .into_iter()
                .map(sync_server_core::domain::types::PeerId),
        );
        Ok(())
    }
}
