//! Port definitions for the system status domain.

use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::{CurrentSystemStatus, StatusUpdate, SystemStatus, SystemStatusError};

/// Storage for status updates.
pub trait SystemStatusRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Stores a new update, which becomes the current status.
    fn insert_update(
        &self,
        update: &StatusUpdate,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// The newest update, if any was ever stored.
    fn latest_update(&self)
    -> impl Future<Output = Result<Option<StatusUpdate>, Self::Err>> + Send;

    /// Up to `limit` updates, newest first.
    fn list_updates(
        &self,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<StatusUpdate>, Self::Err>> + Send;
}

/// Pushes the current status to every open app.
pub trait StatusBroadcaster: Send + Sync + 'static {
    /// The error type returned when the broadcast could not be sent.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Sends `status` to every connected client.
    fn broadcast(
        &self,
        status: &CurrentSystemStatus,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// The system status service.
pub trait SystemStatusService: Send + Sync + 'static {
    /// The status every user sees.
    fn current_status(
        &self,
    ) -> impl Future<Output = Result<CurrentSystemStatus, SystemStatusError>> + Send;

    /// Recent updates, newest first. Macro staff only.
    fn history(
        &self,
        caller: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<StatusUpdate>, SystemStatusError>> + Send;

    /// Sets the current status and pushes it to every open app. Macro staff
    /// only.
    fn set_status(
        &self,
        caller: &MacroUserIdStr<'_>,
        status: SystemStatus,
    ) -> impl Future<Output = Result<StatusUpdate, SystemStatusError>> + Send;
}
