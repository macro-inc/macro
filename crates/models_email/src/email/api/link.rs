use crate::api::settings::Settings;
use crate::service;
use crate::service::backfill::BackfillJobStatus;
use chrono::{DateTime, Utc};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Coarse sync state for an inbox, used to render a one-line hint in the
/// multi-inbox settings list. Derived from the link's `is_sync_active` flag, its
/// reauth health, and its most recent backfill job.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SyncStatus {
    /// A backfill is queued or running.
    Syncing,
    /// The inbox finished backfilling and is actively syncing.
    UpToDate,
    /// The most recent backfill failed; the user can re-sync to recover.
    Error,
    /// The link's Google grant has stopped working; the user must reconnect.
    NeedsReauth,
    /// Syncing has been turned off for this inbox.
    Inactive,
}

impl SyncStatus {
    /// Derives the sync status from the link's active flag, its reauth health,
    /// and the status of its most recent backfill job (if any). A dead grant
    /// takes precedence over backfill state because no sync can proceed until
    /// the user reconnects.
    pub fn derive(
        is_sync_active: bool,
        needs_reauth: bool,
        latest_job_status: Option<BackfillJobStatus>,
    ) -> Self {
        if !is_sync_active {
            return SyncStatus::Inactive;
        }

        if needs_reauth {
            return SyncStatus::NeedsReauth;
        }

        match latest_job_status {
            Some(BackfillJobStatus::Init | BackfillJobStatus::InProgress) => SyncStatus::Syncing,
            Some(BackfillJobStatus::Failed | BackfillJobStatus::Cancelled) => SyncStatus::Error,
            Some(BackfillJobStatus::Complete) | None => SyncStatus::UpToDate,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "UPPERCASE")]
pub enum UserProvider {
    Gmail,
}

impl UserProvider {
    pub fn as_str(&self) -> &'static str {
        match self {
            UserProvider::Gmail => "GMAIL",
        }
    }
}

impl std::fmt::Display for UserProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl From<crate::email::service::link::UserProvider> for UserProvider {
    fn from(provider: crate::email::service::link::UserProvider) -> Self {
        match provider {
            crate::email::service::link::UserProvider::Gmail => UserProvider::Gmail,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Link {
    pub id: Uuid,
    #[schema(value_type = String)]
    pub macro_id: MacroUserIdStr<'static>,
    pub fusionauth_user_id: String,
    #[schema(value_type = String)]
    pub email_address: EmailStr<'static>,
    /// The inbox's own profile photo (its self-contact's SFS photo), if synced.
    pub photo_url: Option<String>,
    pub provider: UserProvider,
    pub is_sync_active: bool,
    pub sync_status: SyncStatus,
    /// Whether the link's Google grant needs to be reconnected. Drives the
    /// per-inbox reconnect prompt independently of the sync-status badge.
    pub needs_reauth: bool,
    /// Whether the link's Google grant is missing the calendar scope. True for
    /// inboxes connected before the calendar capability existed (and for
    /// grants where the user declined it); drives the per-inbox calendar
    /// upgrade prompt. Re-running the connect flow records the new grant.
    pub needs_calendar_permission: bool,
    /// Whether the user turned calendar off for this inbox, which also removed
    /// its calendar data. `needs_calendar_permission` is true either way, so
    /// this is what separates "never granted" from "deliberately off" —
    /// unprompted calendar nags must stay quiet for the latter.
    pub calendar_disabled: bool,
    /// Whether Macro holds calendar data for this inbox. Drives the turn-off
    /// control on its own, so removing that data never depends on the recorded
    /// scopes still matching the set Macro requests today — a set that changes
    /// as the integration narrows, stranding data behind a capability check
    /// that no longer recognizes an older grant.
    pub has_calendar_data: bool,
    pub settings: Settings,
    pub is_primary: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Link {
    pub fn new(
        source: service::link::Link,
        settings: Settings,
        sync_status: SyncStatus,
        photo_url: Option<String>,
        needs_calendar_permission: bool,
        calendar_disabled: bool,
        has_calendar_data: bool,
    ) -> Self {
        Link {
            id: source.id,
            macro_id: source.macro_id,
            fusionauth_user_id: source.fusionauth_user_id,
            email_address: source.email_address,
            photo_url,
            provider: UserProvider::from(source.provider),
            is_sync_active: source.is_sync_active,
            sync_status,
            needs_reauth: source.needs_reauth,
            needs_calendar_permission,
            calendar_disabled,
            has_calendar_data,
            settings,
            is_primary: source.is_primary,
            created_at: source.created_at,
            updated_at: source.updated_at,
        }
    }
}
