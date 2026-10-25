use super::WebSocketMetadata;
use crate::ai_peer::is_ai_peer;

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

#[cfg(test)]
mod test;
