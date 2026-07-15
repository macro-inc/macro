use std::collections::HashSet;

use thiserror::Error;

/// Identity claims presented by an internally authenticated caller.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct InternalIdentityClaims {
    /// The acting user's Macro identifier, when the caller acts on a user's behalf.
    pub user_id: Option<String>,
    /// The acting user's FusionAuth identifier.
    pub fusion_user_id: Option<String>,
    /// The acting user's organization.
    pub organization_id: Option<i32>,
}

/// Configuration enabling internal service-to-service authorization.
#[derive(Clone)]
pub struct InternalAuthConfig {
    /// The shared secret internal callers must present.
    pub api_key: String,
    /// Identity assumed for internal callers that supply no acting user.
    pub default_user_id: Option<String>,
}

/// An identity whose credential has already passed cryptographic validation.
///
/// Validation adapters construct this value without exposing token claim types
/// to the authorization service.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedIdentity {
    /// The user's Macro identifier.
    pub user_id: String,
    /// The user's FusionAuth or root identifier.
    pub fusion_user_id: String,
    /// The organization the user belongs to, when present.
    pub organization_id: Option<i32>,
    /// Permissions established while validating or enriching the identity.
    pub permissions: Option<HashSet<String>>,
}

/// Errors returned when a credential cannot authorize a user.
///
/// The variants deliberately omit validation implementation details so callers
/// can handle authorization failures without exposing sensitive information.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum MacroAuthorizationError {
    /// The supplied credential was valid but has expired.
    #[error("credentials expired")]
    CredentialsExpired,
    /// The supplied credential is otherwise invalid.
    #[error("invalid credentials")]
    InvalidCredentials,
}
