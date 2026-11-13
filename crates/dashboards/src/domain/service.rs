//! The dashboard rules: who may read and write, what a valid view is, and
//! how a save becomes a version.

#[cfg(test)]
mod test;

use dynamic_ui::{PaneId, View, Widget, decode_view};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use serde_json::Value;

use super::models::{
    Dashboard, DashboardError, DashboardId, DashboardSummary, DashboardVersion,
    DashboardVersionSummary, LIST_PAGE, MAX_VIEW_BYTES, NewDashboard, NewVersion, StoredDashboard,
    VERSION_PAGE, Version,
};
use super::ports::{DashboardAccess, DashboardGate, DashboardRepo, DashboardService};

/// How many times a pane patch without an expected version rereads the
/// dashboard after losing a race to another save.
const PATCH_ATTEMPTS: u8 = 3;

/// The dashboard service over its storage, access rules and flag.
pub struct DashboardServiceImpl<R, A, G> {
    repo: R,
    access: A,
    gate: G,
}

impl<R, A, G> DashboardServiceImpl<R, A, G> {
    /// Compose the service.
    pub fn new(repo: R, access: A, gate: G) -> Self {
        Self { repo, access, gate }
    }
}

fn internal<E: std::error::Error + Send + Sync + 'static>(error: E) -> DashboardError {
    DashboardError::Internal(rootcause::Report::new(error).into_dynamic())
}

/// Decode and check a view to save: within the size limit, matching the
/// schema, and with no pane id used twice. Problems name a place, never
/// what the view holds.
fn checked_view(view: &Value) -> Result<View, DashboardError> {
    record_view_size(view);
    checked_view_quietly(view)
}

/// Record a view's size on the current span, which declares `view_bytes`.
fn record_view_size(view: &Value) {
    if let Ok(bytes) = serde_json::to_vec(view) {
        tracing::Span::current().record("view_bytes", bytes.len());
    }
}

/// [`checked_view`] without recording, for a view checked more than once in
/// one span.
fn checked_view_quietly(view: &Value) -> Result<View, DashboardError> {
    let size = serde_json::to_vec(view).map_err(internal)?.len();

    if size > MAX_VIEW_BYTES {
        return Err(DashboardError::Invalid(format!(
            "The view is {size} bytes, over the {MAX_VIEW_BYTES}-byte limit. Use fewer or smaller widgets."
        )));
    }

    let view = decode_view(view).map_err(|problem| {
        DashboardError::Invalid(format!(
            "The view does not match the view schema: {problem}."
        ))
    })?;

    if let Some(pane) = view.duplicate_pane_id() {
        return Err(DashboardError::Invalid(format!(
            "Two widgets have the pane id \"{pane}\"; pane ids must be unique."
        )));
    }

    Ok(view)
}

/// Decode one widget for a pane patch, through the view decoder so its
/// problems read the same way.
fn checked_widget(widget: Value) -> Result<Widget, DashboardError> {
    let view = serde_json::json!({ "widgets": [widget] });
    let mut decoded = decode_view(&view).map_err(|problem| {
        DashboardError::Invalid(format!(
            "The widget does not match the view schema: {}.",
            problem.replacen("view.widgets[0]", "widget", 1)
        ))
    })?;

    decoded
        .widgets
        .pop()
        .ok_or_else(|| DashboardError::Invalid("The widget is missing.".to_owned()))
}

impl<R, A, G> DashboardServiceImpl<R, A, G>
where
    R: DashboardRepo,
    A: DashboardAccess,
    G: DashboardGate,
{
    async fn require_enabled(&self, actor: &MacroUserIdStr<'_>) -> Result<(), DashboardError> {
        if self.gate.enabled_for(actor).await {
            Ok(())
        } else {
            Err(DashboardError::NotFound)
        }
    }

    /// The dashboard and the caller's access, when they have at least
    /// `required`. A caller who can't read it learns nothing of it.
    async fn authorize(
        &self,
        actor: &MacroUserIdStr<'_>,
        id: DashboardId,
        required: AccessLevel,
    ) -> Result<(StoredDashboard, AccessLevel), DashboardError> {
        self.require_enabled(actor).await?;

        let Some(level) = self
            .access
            .access_level(actor, id)
            .await
            .map_err(internal)?
        else {
            return Err(DashboardError::NotFound);
        };

        let Some(stored) = self.repo.get(id).await.map_err(internal)? else {
            return Err(DashboardError::NotFound);
        };

        if level < required {
            return Err(DashboardError::Forbidden(
                "You can read this dashboard but not change it.",
            ));
        }

        Ok((stored, level))
    }

    /// Save `view` on top of `replaces`, or answer the conflict.
    async fn save(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: DashboardId,
        replaces: Version,
        view: View,
        level: AccessLevel,
    ) -> Result<Dashboard, DashboardError> {
        let saved = self
            .repo
            .save_version(&NewVersion {
                id,
                replaces,
                author_id: actor.clone(),
                view,
            })
            .await
            .map_err(internal)?;

        let Some(saved) = saved else {
            return Err(DashboardError::Conflict(replaces.0));
        };

        tracing::Span::current().record("version", saved.version.0);
        Ok(Dashboard::read_as(saved, level))
    }
}

impl<R, A, G> DashboardService for DashboardServiceImpl<R, A, G>
where
    R: DashboardRepo,
    A: DashboardAccess,
    G: DashboardGate,
{
    #[tracing::instrument(
        name = "dashboard.create",
        skip_all,
        fields(dashboard_id = tracing::field::Empty, view_bytes = tracing::field::Empty),
        err
    )]
    async fn create(
        &self,
        actor: &MacroUserIdStr<'static>,
        view: Value,
    ) -> Result<Dashboard, DashboardError> {
        self.require_enabled(actor).await?;

        let view = checked_view(&view)?;
        let id = DashboardId::generate();
        tracing::Span::current().record("dashboard_id", tracing::field::display(id));

        let stored = self
            .repo
            .create(&NewDashboard {
                id,
                owner_id: actor.clone(),
                view,
            })
            .await
            .map_err(internal)?;

        Ok(Dashboard::read_as(stored, AccessLevel::Owner))
    }

    #[tracing::instrument(name = "dashboard.list", skip_all, err)]
    async fn list(
        &self,
        actor: &MacroUserIdStr<'static>,
    ) -> Result<Vec<DashboardSummary>, DashboardError> {
        self.require_enabled(actor).await?;

        self.repo
            .list_owned(actor, LIST_PAGE)
            .await
            .map_err(internal)
    }

    #[tracing::instrument(name = "dashboard.get", skip_all, fields(dashboard_id = %id), err)]
    async fn get(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: DashboardId,
    ) -> Result<Dashboard, DashboardError> {
        let (stored, level) = self.authorize(actor, id, AccessLevel::View).await?;
        Ok(Dashboard::read_as(stored, level))
    }

    #[tracing::instrument(
        name = "dashboard.update",
        skip_all,
        fields(dashboard_id = %id, view_bytes = tracing::field::Empty, version = tracing::field::Empty),
        err
    )]
    async fn update(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: DashboardId,
        view: Value,
        expected: Option<Version>,
    ) -> Result<Dashboard, DashboardError> {
        let (stored, level) = self.authorize(actor, id, AccessLevel::Edit).await?;
        let view = checked_view(&view)?;
        let replaces = expected.unwrap_or(stored.version);

        self.save(actor, id, replaces, view, level).await
    }

    #[tracing::instrument(
        name = "dashboard.patch_pane",
        skip_all,
        fields(dashboard_id = %id, pane_id = %pane, version = tracing::field::Empty),
        err
    )]
    async fn patch_pane(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: DashboardId,
        pane: String,
        widget: Value,
        expected: Option<Version>,
    ) -> Result<Dashboard, DashboardError> {
        let pane = PaneId::try_new(pane)
            .map_err(|_| DashboardError::Invalid("A pane id is 1 to 64 characters.".to_owned()))?;
        let widget = checked_widget(widget)?;

        // With an expected version the caller asked to fail on a race. Without
        // one, a patch only names a pane, so it rereads and applies again.
        let attempts = if expected.is_some() {
            1
        } else {
            PATCH_ATTEMPTS
        };

        for attempt in 1..=attempts {
            let (stored, level) = self.authorize(actor, id, AccessLevel::Edit).await?;

            if let Some(expected) = expected
                && expected != stored.version
            {
                return Err(DashboardError::Conflict(expected.0));
            }

            let mut view = stored.view;
            if !view.replace_pane(&pane, widget.clone()) {
                return Err(DashboardError::Invalid(format!(
                    "No widget has the pane id \"{pane}\"."
                )));
            }

            let view = checked_view_quietly(&serde_json::to_value(&view).map_err(internal)?)?;

            match self.save(actor, id, stored.version, view, level).await {
                Err(DashboardError::Conflict(_)) if attempt < attempts => continue,
                result => return result,
            }
        }

        Err(DashboardError::Conflict(
            expected.map_or(0, |version| version.0),
        ))
    }

    #[tracing::instrument(name = "dashboard.versions", skip_all, fields(dashboard_id = %id), err)]
    async fn versions(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: DashboardId,
    ) -> Result<Vec<DashboardVersionSummary>, DashboardError> {
        self.authorize(actor, id, AccessLevel::View).await?;

        self.repo.versions(id, VERSION_PAGE).await.map_err(internal)
    }

    #[tracing::instrument(name = "dashboard.version", skip_all, fields(dashboard_id = %id, version = version.0), err)]
    async fn version(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: DashboardId,
        version: Version,
    ) -> Result<DashboardVersion, DashboardError> {
        self.authorize(actor, id, AccessLevel::View).await?;

        self.repo
            .version(id, version)
            .await
            .map_err(internal)?
            .ok_or(DashboardError::NotFound)
    }

    #[tracing::instrument(
        name = "dashboard.revert",
        skip_all,
        fields(dashboard_id = %id, reverted_to = version.0, version = tracing::field::Empty, view_bytes = tracing::field::Empty),
        err
    )]
    async fn revert(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: DashboardId,
        version: Version,
    ) -> Result<Dashboard, DashboardError> {
        let (stored, level) = self.authorize(actor, id, AccessLevel::Edit).await?;

        let Some(earlier) = self.repo.version(id, version).await.map_err(internal)? else {
            return Err(DashboardError::NotFound);
        };

        // An old version is checked again: the schema may have moved on.
        let view = checked_view(&earlier.view).map_err(|_| {
            DashboardError::Invalid(format!(
                "Version {} no longer matches the view schema; save a new view instead.",
                version.0
            ))
        })?;

        self.save(actor, id, stored.version, view, level).await
    }

    #[tracing::instrument(name = "dashboard.delete", skip_all, fields(dashboard_id = %id), err)]
    async fn delete(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: DashboardId,
    ) -> Result<(), DashboardError> {
        self.authorize(actor, id, AccessLevel::Owner).await?;

        if self.repo.delete(id).await.map_err(internal)? {
            Ok(())
        } else {
            Err(DashboardError::NotFound)
        }
    }

    #[tracing::instrument(name = "dashboard.set_home", skip_all, fields(dashboard_id = %id), err)]
    async fn set_home(
        &self,
        actor: &MacroUserIdStr<'static>,
        id: DashboardId,
    ) -> Result<(), DashboardError> {
        // A home people open on the account's page is one its account can
        // change, so nobody's home is a dashboard its account only reads.
        self.authorize(actor, id, AccessLevel::Edit).await?;

        self.repo.set_home(actor, id).await.map_err(internal)
    }

    #[tracing::instrument(name = "dashboard.clear_home", skip_all, err)]
    async fn clear_home(&self, actor: &MacroUserIdStr<'static>) -> Result<(), DashboardError> {
        self.require_enabled(actor).await?;

        self.repo.clear_home(actor).await.map_err(internal)
    }

    #[tracing::instrument(name = "dashboard.home", skip_all, fields(dashboard_id = tracing::field::Empty), err)]
    async fn home(
        &self,
        actor: &MacroUserIdStr<'static>,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Dashboard, DashboardError> {
        self.require_enabled(actor).await?;

        let Some(id) = self.repo.home(user).await.map_err(internal)? else {
            return Err(DashboardError::NotFound);
        };
        tracing::Span::current().record("dashboard_id", tracing::field::display(id));

        let (stored, level) = self.authorize(actor, id, AccessLevel::View).await?;
        Ok(Dashboard::read_as(stored, level))
    }
}
