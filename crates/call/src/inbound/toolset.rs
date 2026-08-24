//! Toolset inbound adapter for calls.

mod read_call_record;

#[cfg(test)]
mod test;

use crate::domain::ports::CallService;
use ai_toolset::AsyncToolCollection;
use entity_access::domain::ports::EntityAccessService;
use std::sync::Arc;

use read_call_record::ReadCallRecord;

/// Service context for call AI tools.
pub struct CallToolContext<CSvc, ESvc>
where
    CSvc: CallService,
    ESvc: EntityAccessService,
{
    /// The call service — used to read a single call record with access checks.
    pub service: Arc<CSvc>,
    /// The entity access service — used to generate access receipts.
    pub entity_access_service: Arc<ESvc>,
}

impl<CSvc, ESvc> Clone for CallToolContext<CSvc, ESvc>
where
    CSvc: CallService,
    ESvc: EntityAccessService,
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
        }
    }
}

impl<CSvc, ESvc> CallToolContext<CSvc, ESvc>
where
    CSvc: CallService,
    ESvc: EntityAccessService,
{
    /// Create a new call tool context.
    pub fn new(service: CSvc, entity_access_service: ESvc) -> Self {
        Self {
            service: Arc::new(service),
            entity_access_service: Arc::new(entity_access_service),
        }
    }
}

/// Create a call toolset.
pub fn call_toolset<CSvc, ESvc>() -> AsyncToolCollection<CallToolContext<CSvc, ESvc>>
where
    CSvc: CallService,
    ESvc: EntityAccessService,
{
    AsyncToolCollection::new().add_tool::<ReadCallRecord, CallToolContext<CSvc, ESvc>>()
}
