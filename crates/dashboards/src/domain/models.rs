//! Dashboards, their versions and errors.

use chrono::{DateTime, Utc};
use dynamic_ui::View;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// The backend and web flag that gates every dashboard route.
pub const ENABLE_AGENT_DASHBOARDS: &str = "enable-agent-dashboards";

/// Largest saved view, serialized. A dashboard holds layout and queries,
/// never copied data, so one this large is a runaway.
pub const MAX_VIEW_BYTES: usize = 64 * 1024;

/// How many versions a history read returns, newest first.
pub const VERSION_PAGE: u32 = 100;

/// How many dashboards a list returns, most recently saved first.
pub const LIST_PAGE: u32 = 200;

/// A dashboard's id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(transparent)]
pub struct DashboardId(pub Uuid);

impl DashboardId {
    /// A new, time-ordered id.
    pub fn generate() -> Self {
        Self(macro_uuid::generate_uuid_v7())
    }
}

impl std::fmt::Display for DashboardId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// A saved version number; the first save is 1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
#[serde(transparent)]
pub struct Version(pub u32);

impl Version {
    /// The first version, written at create.
    pub const FIRST: Self = Self(1);

    /// The version after this one.
    pub fn next(self) -> Self {
        Self(self.0 + 1)
    }
}

/// Who owns a dashboard and its current version, read without its view so
/// an access check never depends on the view decoding.
#[derive(Debug, Clone, PartialEq)]
pub struct DashboardHead {
    /// Its id.
    pub id: DashboardId,
    /// Who created it, and so owns it.
    pub owner_id: MacroUserIdStr<'static>,
    /// The current version.
    pub version: Version,
}

/// A dashboard as it is stored, before the caller's access is known.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredDashboard {
    /// Its id.
    pub id: DashboardId,
    /// Who created it, and so owns it.
    pub owner_id: MacroUserIdStr<'static>,
    /// The current view's title.
    pub title: Option<String>,
    /// The current version.
    pub version: Version,
    /// The current view, undecoded: a view saved under an older or newer
    /// schema may not decode, and that must not lock its owner out.
    pub view: serde_json::Value,
    /// When it was created.
    pub created_at: DateTime<Utc>,
    /// When its current version was saved.
    pub updated_at: DateTime<Utc>,
}

/// A dashboard as one caller reads it.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    /// Its id.
    pub id: DashboardId,
    /// Who owns it (`macro|...`).
    #[schema(value_type = String)]
    pub owner_id: MacroUserIdStr<'static>,
    /// The view's title, when it has one.
    pub title: Option<String>,
    /// The current version; every save makes a new one.
    pub version: Version,
    /// The dynamic-UI view, decoded and checked when it was saved.
    #[schema(value_type = Object)]
    pub view: View,
    /// The caller's access.
    pub access_level: AccessLevel,
    /// When it was created.
    pub created_at: DateTime<Utc>,
    /// When its current version was saved.
    pub updated_at: DateTime<Utc>,
}

impl Dashboard {
    /// The stored dashboard, whose view decodes to `view`, as a caller with
    /// `access_level` reads it.
    pub fn read_as(stored: StoredDashboard, view: View, access_level: AccessLevel) -> Self {
        Self {
            id: stored.id,
            owner_id: stored.owner_id,
            title: stored.title,
            version: stored.version,
            view,
            access_level,
            created_at: stored.created_at,
            updated_at: stored.updated_at,
        }
    }
}

/// A dashboard in a list.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    /// Its id.
    pub id: DashboardId,
    /// Who owns it (`macro|...`).
    #[schema(value_type = String)]
    pub owner_id: MacroUserIdStr<'static>,
    /// The current view's title.
    pub title: Option<String>,
    /// The current version.
    pub version: Version,
    /// When its current version was saved.
    pub updated_at: DateTime<Utc>,
}

/// One saved version, without its view.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DashboardVersionSummary {
    /// The version.
    pub version: Version,
    /// Who saved it (`macro|...`).
    #[schema(value_type = String)]
    pub author_id: MacroUserIdStr<'static>,
    /// When it was saved.
    pub created_at: DateTime<Utc>,
}

/// One saved version with the view it saved.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DashboardVersion {
    /// The version.
    pub version: Version,
    /// Who saved it (`macro|...`).
    #[schema(value_type = String)]
    pub author_id: MacroUserIdStr<'static>,
    /// When it was saved.
    pub created_at: DateTime<Utc>,
    /// The view as that save left it, undecoded: an old version may not
    /// match today's schema.
    #[schema(value_type = Object)]
    pub view: serde_json::Value,
}

/// A dashboard to write as its first version.
#[derive(Debug, Clone, PartialEq)]
pub struct NewDashboard {
    /// Its id.
    pub id: DashboardId,
    /// Its owner, who is also the first version's author.
    pub owner_id: MacroUserIdStr<'static>,
    /// The view.
    pub view: View,
}

/// A save on top of the current version.
#[derive(Debug, Clone, PartialEq)]
pub struct NewVersion {
    /// The dashboard.
    pub id: DashboardId,
    /// The version the save replaces; it fails when that is no longer current.
    pub replaces: Version,
    /// Who saved it.
    pub author_id: MacroUserIdStr<'static>,
    /// The view.
    pub view: View,
}

/// What went wrong with a dashboard request.
#[derive(Debug, thiserror::Error)]
pub enum DashboardError {
    /// The dashboard doesn't exist, the caller can't read it, or dashboards
    /// are off for the caller.
    #[error("dashboard not found")]
    NotFound,
    /// The caller can read it but not do this.
    #[error("{0}")]
    Forbidden(&'static str),
    /// The view, pane or version given doesn't work.
    #[error("{0}")]
    Invalid(String),
    /// The current version's view no longer matches the view schema. The
    /// owner can still save a new view, revert or delete it.
    #[error(
        "version {0} of this dashboard no longer matches the view schema; save a new view, revert to an earlier version, or delete it"
    )]
    Unreadable(u32),
    /// Someone saved a newer version first.
    #[error("the dashboard changed since version {0}; read it again and retry")]
    Conflict(u32),
    /// Any other failure.
    #[error("internal dashboard error: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for DashboardError {
    fn from(report: rootcause::Report) -> Self {
        Self::Internal(report)
    }
}
