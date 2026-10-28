use worker::{Error, Result};

use super::{WebSocketMetadata, Wsm};
use crate::{
    ai_peer::is_ai_peer, constants::USER_PEER_D1_BINDING, d1::insert_missing_user_mappings,
};

impl WebSocketMetadata {
    pub(super) fn active_peer_ids(&self, include_ai: bool) -> Vec<u64> {
        if !include_ai && self.actor.is_some() {
            return Vec::new();
        }
        self.peer_ids
            .iter()
            .copied()
            .filter(|peer| include_ai || !is_ai_peer(*peer))
            .collect()
    }
}

impl Wsm<'_> {
    /// Map peers that wrote through this socket without registering first (a
    /// client's peer id can change, and offline edits replay under an old one).
    /// Unlike registration this keeps existing mappings and leaves the
    /// socket's own peers, and so presence, unchanged.
    pub async fn add_writing_peerids(&mut self, peerids: &[u64], document_id: &str) -> Result<()> {
        self.maybe_update_ws_meta_map().await?;
        let ws_id = self.get_ws_id()?.to_string();
        let user_id = {
            let wmm = self.dss.ws_meta_map.lock("Wsm::add_writing_peerids get");
            let meta = wmm.get(&ws_id).ok_or(Error::from("missing ws metadata"))?;
            let Some(user_id) = meta.user_id.clone() else {
                return Ok(());
            };
            user_id
        };
        let new_peers: Vec<u64> = {
            let mapped = self
                .dss
                .mapped_writing_peers
                .lock("Wsm::add_writing_peerids mapped");
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
        insert_missing_user_mappings(&db, document_id, &user_id, &new_peers).await?;
        // Remembered only once stored, so a failed write is retried with the
        // client's resent update.
        self.dss
            .mapped_writing_peers
            .lock("Wsm::add_writing_peerids extend")
            .extend(new_peers);
        Ok(())
    }
}

#[cfg(test)]
mod test;
