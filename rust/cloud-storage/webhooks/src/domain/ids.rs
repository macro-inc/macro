//! Prefixed, time-sortable identifiers for webhook entities.
//!
//! IDs are stored as `TEXT` everywhere and are formatted as a short prefix
//! followed by a uuid v7 body (`wh_<uuid_v7>`, `whr_<uuid_v7>`). uuid v7 is
//! time-ordered, so the IDs sort by creation time the same way ULIDs would,
//! while reusing the codebase's standard [`macro_uuid::generate_uuid_v7`]
//! generator instead of introducing a new dependency.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Generates a new prefixed, time-sortable id body.
fn new_id_with_prefix(prefix: &str) -> String {
    format!("{prefix}{}", macro_uuid::generate_uuid_v7())
}

macro_rules! prefixed_id {
    ($(#[$meta:meta])* $name:ident, $prefix:literal) => {
        $(#[$meta])*
        ///
        /// Stored as `TEXT`; serialized transparently as its string value.
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            /// The string prefix all values of this id carry.
            pub const PREFIX: &'static str = $prefix;

            /// Generate a fresh, time-sortable id.
            pub fn generate() -> Self {
                Self(new_id_with_prefix($prefix))
            }

            /// Wrap an existing id string (e.g. one read from the database).
            pub fn from_string(value: String) -> Self {
                Self(value)
            }

            /// The underlying string value.
            pub fn as_str(&self) -> &str {
                &self.0
            }

            /// Consume the id, returning the owned string.
            pub fn into_string(self) -> String {
                self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self(value)
            }
        }

        impl AsRef<str> for $name {
            fn as_ref(&self) -> &str {
                &self.0
            }
        }
    };
}

prefixed_id!(
    /// Identifier for a [`crate::domain::model::Webhook`].
    WebhookId,
    "wh_"
);

prefixed_id!(
    /// Identifier for a [`crate::domain::model::WebhookRule`].
    WebhookRuleId,
    "whr_"
);

#[cfg(test)]
mod test;
