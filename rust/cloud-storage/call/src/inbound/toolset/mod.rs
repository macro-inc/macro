//! Toolset inbound adapter for calls.

mod list_call_records;
mod read_call_record;

#[cfg(test)]
mod test;

use crate::domain::ports::{CallRecordQueryService, CallService};
use ai::tool::AsyncToolCollection;
use entity_access::domain::ports::EntityAccessService;
use std::sync::Arc;

use list_call_records::ListCallRecords;
use read_call_record::ReadCallRecord;

/// Service context for call AI tools.
pub struct CallToolContext<CSvc, QSvc, ESvc>
where
    CSvc: CallService,
    QSvc: CallRecordQueryService,
    ESvc: EntityAccessService,
{
    /// The call service — used to read a single call record with access checks.
    pub service: Arc<CSvc>,
    /// The read-only query service — used to list the caller's call records.
    pub query_service: Arc<QSvc>,
    /// The entity access service — used to generate access receipts.
    pub entity_access_service: Arc<ESvc>,
}

impl<CSvc, QSvc, ESvc> Clone for CallToolContext<CSvc, QSvc, ESvc>
where
    CSvc: CallService,
    QSvc: CallRecordQueryService,
    ESvc: EntityAccessService,
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            query_service: self.query_service.clone(),
            entity_access_service: self.entity_access_service.clone(),
        }
    }
}

impl<CSvc, QSvc, ESvc> CallToolContext<CSvc, QSvc, ESvc>
where
    CSvc: CallService,
    QSvc: CallRecordQueryService,
    ESvc: EntityAccessService,
{
    /// Create a new call tool context.
    pub fn new(service: CSvc, query_service: QSvc, entity_access_service: ESvc) -> Self {
        Self {
            service: Arc::new(service),
            query_service: Arc::new(query_service),
            entity_access_service: Arc::new(entity_access_service),
        }
    }
}

/// Create a call toolset.
pub fn call_toolset<CSvc, QSvc, ESvc>() -> AsyncToolCollection<CallToolContext<CSvc, QSvc, ESvc>>
where
    CSvc: CallService,
    QSvc: CallRecordQueryService,
    ESvc: EntityAccessService,
{
    AsyncToolCollection::new()
        .add_tool::<ListCallRecords, CallToolContext<CSvc, QSvc, ESvc>>()
        .add_tool::<ReadCallRecord, CallToolContext<CSvc, QSvc, ESvc>>()
}
