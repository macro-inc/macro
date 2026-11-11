use thiserror::Error;

/// Enterprise use-case result.
pub type Result<T, E = EnterpriseError> = std::result::Result<T, E>;

/// Typed policy failures and required capability gaps.
#[derive(Debug, Error)]
pub enum EnterpriseError {
    /// No production broker exchange exists. The adapter never attempts a network call.
    #[error("broker_exchange_gap")]
    BrokerExchangeGap,
    /// The binding conflicts with a different verified identity.
    #[error("the Rox identity binding conflicts with an existing binding")]
    BindingConflict,
    /// The member has been disabled by a team administrator.
    #[error("member is disabled")]
    MemberDisabled,
    /// The requested preset is unknown, cloud-hosted, or absent from the team's list.
    #[error("runtime preset is not allowed")]
    RuntimePresetDenied,
    /// The target user does not belong to the receipt's team.
    #[error("user is not a member of this team")]
    NotTeamMember,
    /// No local user row supplies the member's FusionAuth identity.
    #[error("user not found")]
    UnknownUser,
    /// The receipt does not identify a valid team.
    #[error("invalid team access receipt")]
    InvalidTeam,
    /// A stored preset is outside the closed local-runtime vocabulary.
    #[error("unknown stored runtime preset: {0}")]
    UnknownStoredPreset(String),
    /// An identity or allowlist failed syntax validation.
    #[error("invalid enterprise input: {0}")]
    InvalidInput(&'static str),
    /// Authorization failed while reading the typed admin capability.
    #[error(transparent)]
    Access(#[from] entity_access::domain::models::AccessError),
    /// An adapter failed without hiding the underlying cause.
    #[error(transparent)]
    Storage(#[from] anyhow::Error),
}
