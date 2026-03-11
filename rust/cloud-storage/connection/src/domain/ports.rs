//! Port definitions for the connection domain.
//!
//! These traits define the contracts that adapters must implement.

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};

use crate::domain::models::{ConnectionError, InvalidationEvent};

/// Repository for handling github oauth related actions.
pub trait ConnectionGateway: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// Bulk sends an invalidation event
    fn bulk_send_invalidation_event<'a, T: std::fmt::Debug + serde::Serialize + Send>(
        &self,
        users: &[MacroUserId<Lowercase<'a>>],
        invalidation_event: InvalidationEvent<'a, T>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Service interface for connection operations
pub trait ConnectionService: Send + Sync + 'static {
    /// Sends an invalidation event
    fn send_invalidation_event<'a, T: std::fmt::Debug + serde::Serialize + Send>(
        &self,
        invalidation_event: InvalidationEvent<'a, T>,
    ) -> impl Future<Output = Result<(), ConnectionError>> + Send;
}
