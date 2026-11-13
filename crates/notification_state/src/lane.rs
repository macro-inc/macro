//! The lane a recipient's notification is routed into before delivery.

#[cfg(test)]
mod test;

/// Where a notification was routed for its recipient, decided once at ingress.
///
/// Readers of a user's notifications ask for one lane. `Signal` is the default
/// everywhere, so a reader that says nothing never sees noise.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum NotificationLane {
    /// Delivered normally: pushed, digested and counted as unread.
    #[default]
    Signal,
    /// Stored and shown in the Noise view, but never pushed, digested or
    /// counted as unread.
    Noise,
}

impl NotificationLane {
    /// The canonical name used in JSON and PostgreSQL.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Signal => "signal",
            Self::Noise => "noise",
        }
    }
}

impl std::fmt::Display for NotificationLane {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
