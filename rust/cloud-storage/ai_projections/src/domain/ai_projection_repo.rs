//! Outbound port for ai projection persistence.

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::model::{
    AiProjection, AiProjectionError, Expiry, RefreshCadence, UserAiProjection,
};

/// The AiProjectionRepository defines the persistence actions for ai projections.
pub trait AiProjectionRepository: Clone + Send + Sync + 'static {
    /// Gets an existing projection definition by id, or creates it if it does
    /// not exist. Existing definitions are returned unchanged.
    fn get_or_create_projection(
        &self,
        id: &str,
        prompt: &str,
        prompt_hash: &str,
        refresh_cadence: RefreshCadence,
        expiry: Expiry,
    ) -> impl Future<Output = Result<AiProjection, AiProjectionError>> + Send;

    /// Gets the requesting user's instance of a projection, or creates a cold
    /// instance if one does not exist for the given prompt version.
    fn get_or_create_user_projection(
        &self,
        ai_projection_id: &str,
        user_id: &MacroUserIdStr<'_>,
        prompt_hash: &str,
    ) -> impl Future<Output = Result<UserAiProjection, AiProjectionError>> + Send;

    /// Returns whether the user has the given permission id
    /// (e.g. `read:professional_features`).
    fn user_has_permission(
        &self,
        user_id: &MacroUserIdStr<'_>,
        permission: &str,
    ) -> impl Future<Output = Result<bool, AiProjectionError>> + Send;
}
