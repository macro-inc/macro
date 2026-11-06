//! Repository-owned voice selection, edited through the management API.

use serde::{Deserialize, Serialize};

/// Content of `config/voice.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoiceConfig {
    /// Provider model selected by the creator or a team administrator.
    pub model: String,
}
