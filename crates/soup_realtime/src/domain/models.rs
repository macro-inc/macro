//! Versioned realtime Soup output models.

use macro_user_id::user_id::MacroUserIdStr;
use models_soup::item::SoupItem;
use serde::{Deserialize, Serialize};

/// One full, user-scoped Soup item published for realtime delivery.
#[derive(Debug, Serialize, Deserialize)]
pub struct SoupRealtimeMessage {
    /// Version of this message contract.
    pub schema_version: u8,
    /// User for whom the Soup item was hydrated.
    pub user_id: MacroUserIdStr<'static>,
    /// Complete Soup item, including fields scoped to `user_id`.
    pub item: SoupItem<()>,
}

impl SoupRealtimeMessage {
    /// Current schema version for realtime Soup messages.
    pub const SCHEMA_VERSION: u8 = 1;

    /// Creates a version-one message for a user-scoped Soup item.
    pub fn new(user_id: MacroUserIdStr<'static>, item: SoupItem<()>) -> Self {
        Self {
            schema_version: Self::SCHEMA_VERSION,
            user_id,
            item,
        }
    }
}
