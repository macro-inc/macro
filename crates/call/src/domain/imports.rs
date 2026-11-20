//! Trusted integration entry point. Import ownership comes from the connected
//! Macro user, never from provider attendees; imports confer no attendee access.
#[cfg(test)]
mod test;

use super::events::{CallMacroEvent, CallRecordImportedMetadata};
use super::records::{
    CallEntityRecord, CallParticipant, CallProvider, CallSource, CallTranscript, ExternalCallId,
};
use super::service::publish_call_event;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use macro_event_broker::MacroEventBroker;
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

/// An imported call as its provider describes it, for mirroring elsewhere.
#[derive(Debug, Clone)]
pub struct ImportedCallRecord {
    /// Macro call entity ID.
    pub id: Uuid,
    /// Display title, including a title edited in Macro.
    pub title: Option<String>,
    /// Observed call start, if available.
    pub started_at: Option<DateTime<Utc>>,
    /// Observed call end, if available.
    pub ended_at: Option<DateTime<Utc>>,
    /// Named attendees, alphabetical; providers' attendee order isn't stored.
    pub attendees: Vec<String>,
    /// Opaque provider identifier.
    pub external_id: ExternalCallId,
    /// Source permalink, if supplied.
    pub external_url: Option<String>,
    /// Provider-written summary, if any.
    pub summary: Option<String>,
    /// Provider revision time.
    pub external_updated_at: Option<DateTime<Utc>>,
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
    /// Every call this user imported from the provider, latest start first.
    async fn list_source_records(
        &self,
        user: &MacroUserIdStr<'static>,
        provider: CallProvider,
    ) -> Result<Vec<ImportedCallRecord>, rootcause::Report>;
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
    /// Every call the caller imported from the provider, unbounded, latest start first.
    async fn list_source_records(
        &self,
        user: &MacroUserIdStr<'static>,
        provider: CallProvider,
    ) -> Result<Vec<ImportedCallRecord>, rootcause::Report>;
    /// Read the caller's imported call; other owners' records are invisible.
    async fn read(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<Option<CallEntityRecord>, rootcause::Report>;
}

/// Validates provider snapshots before passing them to persistence, then
/// announces each stored record on `macro.calls`.
pub struct CallImportServiceImpl<R, B>(pub R, pub B);

#[async_trait]
impl<R: ImportedCallRepository, B: MacroEventBroker> CallImportService
    for CallImportServiceImpl<R, B>
{
    async fn ingest(&self, call: ImportedCall) -> Result<Uuid, rootcause::Report> {
        if call.source.namespace.trim().is_empty()
            || call.source.object_type.trim().is_empty()
            || call.source.external_id.as_ref().is_empty()
        {
            return Err(rootcause::report!(
                "an import requires a scoped source identity"
            ));
        }
        if matches!((call.started_at, call.ended_at), (Some(start), Some(end)) if end < start) {
            return Err(rootcause::report!("reversed imported call timing"));
        }
        let owner = call.source.user_id.clone();
        let call_id = self.0.upsert(call).await?;
        publish_call_event(
            &self.1,
            &CallMacroEvent::record_imported(CallRecordImportedMetadata { call_id, owner }),
        );
        Ok(call_id)
    }
    async fn list(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<ImportedCallPreview>, rootcause::Report> {
        self.0.list_owned(user).await
    }
    async fn list_source_records(
        &self,
        user: &MacroUserIdStr<'static>,
        provider: CallProvider,
    ) -> Result<Vec<ImportedCallRecord>, rootcause::Report> {
        self.0.list_source_records(user, provider).await
    }
    async fn read(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<Option<CallEntityRecord>, rootcause::Report> {
        self.0.read_owned(user, id).await
    }
}
