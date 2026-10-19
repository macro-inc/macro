//! Provider facts used for category cleanup and rules owned by Macro.

use super::ProviderId;

/// One current message selected for bounded category cleanup.
pub struct CategoryMessage {
    /// Opaque provider resource identity.
    pub id: ProviderId,
    /// Complete current category assignments.
    pub categories: Vec<String>,
    /// Optimistic concurrency token for a merge update.
    pub version: Option<String>,
}

/// A rule is removable only when its recorded nonce and exact predicates match.
pub struct OwnedSenderRule {
    /// Opaque provider resource identity.
    pub id: ProviderId,
    /// Persisted Macro ownership nonce encoded in the rule name.
    pub correlation: uuid::Uuid,
    /// Exact sender address tested by the rule.
    pub sender: String,
    /// Whether Outlook currently applies the rule.
    pub enabled: bool,
}
