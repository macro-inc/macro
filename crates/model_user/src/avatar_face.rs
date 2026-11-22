use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A versioned recipe rendered by `@macro-inc/agent-faces`. The server validates
/// its envelope; the renderer owns the available parts and option counts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AvatarFace {
    /// Renderer version. Only version 1 can currently be saved.
    pub v: u8,
    /// Stable seed, between 1 and 64 characters.
    pub seed: String,
    /// Pinned parts and their zero-based option indexes.
    pub pins: BTreeMap<String, u32>,
}

impl AvatarFace {
    /// Whether this recipe uses a supported version, a bounded nonempty seed,
    /// and no more than 1 KiB of serialized JSON.
    pub fn is_valid(&self) -> bool {
        self.v == 1
            && !self.seed.trim().is_empty()
            && self.seed.chars().count() <= 64
            && serde_json::to_vec(self).is_ok_and(|json| json.len() <= 1024)
    }
}
