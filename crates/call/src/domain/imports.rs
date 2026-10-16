//! Trusted integration entry point. Import ownership comes from the connected
//! Macro user, never from provider attendees; imports confer no attendee access.
use super::records::{CallEntityRecord, CallParticipant, CallSource, CallTranscript};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::Serialize;
use uuid::Uuid;

/// A complete provider snapshot. Native room state is deliberately absent.
pub struct ImportedCall {
    /// Authenticated import provenance and revision.
    pub source: CallSource,
    /// Provider title.
    pub title: Option<String>,
    /// Observed conversation start; calendar schedule is source metadata.
    pub started_at: Option<DateTime<Utc>>,
    /// Observed conversation end.
    pub ended_at: Option<DateTime<Utc>>,
    /// Provider attendees, without inferred Macro identities or attendance.
    pub participants: Vec<CallParticipant>,
    /// Available transcript, independent of recordings.
    pub transcript: Option<CallTranscript>,
}

/// Compact owner-scoped discovery for imported call records.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedCallPreview {
    /// Macro call entity ID.
    pub id: Uuid,
    /// Display title.
    pub title: Option<String>,
    /// Observed call time, if available.
    pub started_at: Option<DateTime<Utc>>,
    /// Time this record entered Macro.
    pub created_at: DateTime<Utc>,
}

/// Owning persistence boundary for imported call entities and resources.
#[async_trait]
pub trait ImportedCallRepository: Send + Sync {
    /// Atomically insert or update by the complete source identity and revision.
    async fn upsert(&self, call: ImportedCall) -> Result<Uuid, rootcause::Report>;
    /// List recent records owned by this user, bounded by the service.
    async fn list_owned(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<ImportedCallPreview>, rootcause::Report>;
    /// Read only when the user owns the imported call.
    async fn read_owned(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<Option<CallEntityRecord>, rootcause::Report>;
}

/// Domain service used by trusted integrations and authenticated owner reads.
#[async_trait]
pub trait CallImportService: Send + Sync {
    /// Persist an imported snapshot with private owner-only initial access.
    async fn ingest(&self, call: ImportedCall) -> Result<Uuid, rootcause::Report>;
    /// List the caller's imported calls.
    async fn list(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<ImportedCallPreview>, rootcause::Report>;
    /// Read the caller's imported call; other owners' records are invisible.
    async fn read(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<Option<CallEntityRecord>, rootcause::Report>;
}

/// Validates provider snapshots before passing them to persistence.
pub struct CallImportServiceImpl<R>(pub R);

#[async_trait]
impl<R: ImportedCallRepository> CallImportService for CallImportServiceImpl<R> {
    async fn ingest(&self, call: ImportedCall) -> Result<Uuid, rootcause::Report> {
        if call.source.namespace.trim().is_empty() || call.source.object_type.trim().is_empty() {
            return Err(rootcause::report!(
                "an import requires a scoped source identity"
            ));
        }
        if matches!((call.started_at, call.ended_at), (Some(start), Some(end)) if end < start) {
            return Err(rootcause::report!("reversed imported call timing"));
        }
        self.0.upsert(call).await
    }
    async fn list(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<ImportedCallPreview>, rootcause::Report> {
        self.0.list_owned(user).await
    }
    async fn read(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<Option<CallEntityRecord>, rootcause::Report> {
        self.0.read_owned(user, id).await
    }
}
