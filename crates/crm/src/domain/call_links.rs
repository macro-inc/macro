//! Links archived calls to the CRM records of the people on them.

use std::future::Future;

use call::domain::{models::CallPeople, ports::CallRecordQueryService};
use rootcause::Report;
use uuid::Uuid;

/// Writes a call record's Companies and Contacts properties.
pub trait CallRecordLinkStore: Send + Sync + 'static {
    /// Associate `call_record_id` with the CRM records matching `people`.
    /// Values already set on the record are kept, so repeating a link is
    /// harmless.
    fn link_call_record(
        &self,
        call_record_id: Uuid,
        people: &CallPeople,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Links archived call records to the CRM companies and contacts of the
/// people on them.
pub struct CallRecordLinker<Q, L> {
    calls: Q,
    links: L,
}

impl<Q: CallRecordQueryService, L: CallRecordLinkStore> CallRecordLinker<Q, L> {
    /// Create a linker reading call people from `calls` and writing links
    /// to `links`.
    pub fn new(calls: Q, links: L) -> Self {
        Self { calls, links }
    }

    /// Link one archived call record. Safe to repeat for the same record.
    pub async fn link_archived_call(&self, call_record_id: Uuid) -> Result<(), Report> {
        let people = self
            .calls
            .get_call_record_people(call_record_id)
            .await
            .map_err(|error| rootcause::report!(error))?;
        self.links.link_call_record(call_record_id, &people).await
    }
}
