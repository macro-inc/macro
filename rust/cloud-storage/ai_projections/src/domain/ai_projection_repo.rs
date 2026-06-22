//! Outbound port for ai projection persistence.

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::model::{
    AiProjection, AiProjectionError, Expiry, RefreshCadence, TargetType, UserAiProjection,
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
        target_type: TargetType,
        refresh_cadence: RefreshCadence,
        expiry: Expiry,
    ) -> impl Future<Output = Result<AiProjection, AiProjectionError>> + Send;

    /// Gets the target's instance of a projection, or creates a cold instance
    /// if one does not exist for the given prompt version.
    fn get_or_create_target_projection(
        &self,
        ai_projection_id: &str,
        target_id: &str,
        prompt_hash: &str,
    ) -> impl Future<Output = Result<UserAiProjection, AiProjectionError>> + Send;

    /// Returns whether the user has the given permission id
    /// (e.g. `read:professional_features`).
    fn user_has_permission(
        &self,
        user_id: &MacroUserIdStr<'_>,
        permission: &str,
    ) -> impl Future<Output = Result<bool, AiProjectionError>> + Send;

    /// Returns the ids of the teams the user belongs to.
    fn get_user_team_ids(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<uuid::Uuid>, AiProjectionError>> + Send;
}
