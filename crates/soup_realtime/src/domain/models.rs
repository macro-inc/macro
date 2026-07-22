//! Versioned realtime Soup output models.

use macro_user_id::user_id::MacroUserIdStr;
use models_soup::item::SoupItem;
use serde::{Deserialize, Serialize};

/// One full Soup item published to a recipient for realtime delivery.
#[derive(Debug, Serialize, Deserialize)]
pub struct SoupRealtimeMessage {
    /// Version of this message contract.
    pub schema_version: u8,
    /// User to whom the Soup item is addressed.
    pub user_id: MacroUserIdStr<'static>,
    /// Complete Soup item with transient user-specific fields normalized.
    pub item: SoupItem<()>,
}

impl SoupRealtimeMessage {
    /// Current schema version for realtime Soup messages.
    pub const SCHEMA_VERSION: u8 = 1;

    /// Creates a version-one message addressed to a recipient.
    pub fn new(user_id: MacroUserIdStr<'static>, item: SoupItem<()>) -> Self {
        Self {
            schema_version: Self::SCHEMA_VERSION,
            user_id,
            item,
        }
    }
}
