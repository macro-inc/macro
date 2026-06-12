use crate::api::settings::Settings;
use crate::service;
use crate::service::backfill::BackfillJobStatus;
use chrono::{DateTime, Utc};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// Coarse sync state for an inbox, used to render a one-line hint in the
/// multi-inbox settings list. Derived from the link's `is_sync_active` flag and
/// its most recent backfill job.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SyncStatus {
    /// A backfill is queued or running.
    Syncing,
    /// The inbox finished backfilling and is actively syncing.
    UpToDate,
    /// The most recent backfill failed; the user can re-sync to recover.
    Error,
    /// Syncing has been turned off for this inbox.
    Inactive,
}

impl SyncStatus {
    /// Derives the sync status from the link's active flag and the status of its
    /// most recent backfill job (if any).
    pub fn derive(is_sync_active: bool, latest_job_status: Option<BackfillJobStatus>) -> Self {
        if !is_sync_active {
            return SyncStatus::Inactive;
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
    pub signature: Option<String>,
    pub settings: Settings,
    pub is_primary: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Link {
    pub fn new(
        source: service::link::Link,
        signature: Option<String>,
        settings: Settings,
        sync_status: SyncStatus,
        photo_url: Option<String>,
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
            signature,
            settings,
            is_primary: source.is_primary,
            created_at: source.created_at,
            updated_at: source.updated_at,
        }
    }
}
