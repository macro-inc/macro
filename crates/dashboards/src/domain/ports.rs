//! What the dashboard service needs from the outside, and what it offers.

use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;

use super::models::{
    Dashboard, DashboardError, DashboardId, DashboardSummary, DashboardVersion,
    DashboardVersionSummary, NewDashboard, NewVersion, StoredDashboard, Version,
};

/// Dashboard storage.
pub trait DashboardRepo: Send + Sync + 'static {
    /// Storage failure.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Write the dashboard, its first version and its owner's grant at once.
    fn create(
        &self,
        dashboard: &NewDashboard,
    ) -> impl Future<Output = Result<StoredDashboard, Self::Err>> + Send;

    /// The dashboard at its current version.
    fn get(
        &self,
        id: DashboardId,
    ) -> impl Future<Output = Result<Option<StoredDashboard>, Self::Err>> + Send;

    /// The dashboards `owner` owns, most recently saved first, at most `limit`.
    fn list_owned(
        &self,
        owner: &MacroUserIdStr<'_>,
        limit: u32,
    ) -> impl Future<Output = Result<Vec<DashboardSummary>, Self::Err>> + Send;

    /// Save a version on top of `version.replaces`. `None` when that is no
    /// longer the current version or the dashboard is gone.
    fn save_version(
        &self,
        version: &NewVersion,
    ) -> impl Future<Output = Result<Option<StoredDashboard>, Self::Err>> + Send;

    /// The newest versions, at most `limit`.
    fn versions(
        &self,
        id: DashboardId,
        limit: u32,
    ) -> impl Future<Output = Result<Vec<DashboardVersionSummary>, Self::Err>> + Send;

    /// One version with its view.
    fn version(
        &self,
        id: DashboardId,
        version: Version,
    ) -> impl Future<Output = Result<Option<DashboardVersion>, Self::Err>> + Send;

    /// Delete the dashboard, its versions, its grants and any home pointing at
    /// it. False when it was already gone.
    fn delete(&self, id: DashboardId) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Point `user`'s home dashboard at `id`.
    fn set_home(
        &self,
        user: &MacroUserIdStr<'_>,
        id: DashboardId,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Clear `user`'s home dashboard.
    fn clear_home(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// `user`'s home dashboard, when they set one.
    fn home(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<DashboardId>, Self::Err>> + Send;
}

/// Who may do what to a dashboard, from the shared entity access rules.
pub trait DashboardAccess: Send + Sync + 'static {
    /// Access check failure.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The caller's access, `None` for none.
    fn access_level(
        &self,
        user: &MacroUserIdStr<'_>,
        id: DashboardId,
    ) -> impl Future<Output = Result<Option<AccessLevel>, Self::Err>> + Send;
}

/// Whether dashboards are on for a caller.
pub trait DashboardGate: Send + Sync + 'static {
    /// True when the `enable-agent-dashboards` flag is on for `user`; a flag
    /// that fails to load reads as off.
    fn enabled_for(&self, user: &MacroUserIdStr<'_>) -> impl Future<Output = bool> + Send;
}

/// The dashboard use cases. Every method answers [`DashboardError::NotFound`]
/// when dashboards are off for the caller.
pub trait DashboardService: Send + Sync + 'static {
    /// Save `view` as a new dashboard the caller owns.
    fn create(
        &self,
        actor: &MacroUserIdStr<'static>,
        view: serde_json::Value,
    ) -> impl Future<Output = Result<Dashboard, DashboardError>> + Send;

    /// The dashboards the caller owns.
    fn list(
        &self,
        actor: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<DashboardSummary>, DashboardError>> + Send;

    /// A dashboard the caller can read.
    fn get(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: DashboardId,
    ) -> impl Future<Output = Result<Dashboard, DashboardError>> + Send;

    /// Replace the view as a new version. With `expected`, refuse when that is
    /// no longer the current version.
    fn update(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: DashboardId,
        view: serde_json::Value,
        expected: Option<Version>,
    ) -> impl Future<Output = Result<Dashboard, DashboardError>> + Send;

    /// Replace the pane with id `pane` by `widget`, as a new version.
    fn patch_pane(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: DashboardId,
        pane: String,
        widget: serde_json::Value,
        expected: Option<Version>,
    ) -> impl Future<Output = Result<Dashboard, DashboardError>> + Send;

    /// The newest versions.
    fn versions(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: DashboardId,
    ) -> impl Future<Output = Result<Vec<DashboardVersionSummary>, DashboardError>> + Send;

    /// One version with its view.
    fn version(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: DashboardId,
        version: Version,
    ) -> impl Future<Output = Result<DashboardVersion, DashboardError>> + Send;

    /// Save an earlier version's view as the newest version.
    fn revert(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: DashboardId,
        version: Version,
    ) -> impl Future<Output = Result<Dashboard, DashboardError>> + Send;

    /// Delete the dashboard; owners only.
    fn delete(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: DashboardId,
    ) -> impl Future<Output = Result<(), DashboardError>> + Send;

    /// Make a dashboard the caller can edit the caller's home dashboard.
    fn set_home(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: DashboardId,
    ) -> impl Future<Output = Result<(), DashboardError>> + Send;

    /// Clear the caller's home dashboard.
    fn clear_home(
        &self,
        actor: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<(), DashboardError>> + Send;

    /// `user`'s home dashboard, when the caller can read it.
    fn home(
        &self,
        actor: &MacroUserIdStr<'static>,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Dashboard, DashboardError>> + Send;
}
