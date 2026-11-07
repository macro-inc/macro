//! Toolset inbound adapter for calls.

mod delete_call_record;
mod read_call_record;
mod update_call_record;

#[cfg(test)]
mod test;

use crate::domain::{models::CallError, ports::CallService};
use ai_toolset::{AsyncToolCollection, ToolCallError};
use entity_access::domain::{models::AccessError, ports::EntityAccessService};
use entity_mutation::DeleteEntityPermanently;
use std::sync::Arc;

use delete_call_record::DeleteCallRecord;
use read_call_record::ReadCallRecord;
use update_call_record::UpdateCallRecord;

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

/// Map a failure to mint a call receipt onto an actionable tool error.
fn call_access_error(err: AccessError) -> ToolCallError {
    let description = match err {
        AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
            "you need edit access to the call"
        }
        AccessError::NotFound(_) => "call not found",
        AccessError::BadRequest(_) => "invalid call id",
        AccessError::Unavailable(_) | AccessError::Internal(_) => {
            "failed to verify access to the call"
        }
    };
    ToolCallError {
        description: description.to_string(),
        internal_error: err.into(),
    }
}

/// Map a call domain failure onto an actionable tool error.
fn call_error(action: &'static str) -> impl FnOnce(CallError) -> ToolCallError {
    move |err| {
        let description = match &err {
            CallError::InvalidRequest(message)
            | CallError::Forbidden(message)
            | CallError::Conflict(message) => message.clone(),
            CallError::NotFound(_) => "call not found".to_string(),
            _ => format!("failed to {action}"),
        };
        ToolCallError {
            description,
            internal_error: err.into(),
        }
    }
}

/// Create a call toolset.
pub fn call_toolset<CSvc, ESvc>() -> AsyncToolCollection<CallToolContext<CSvc, ESvc>>
where
    CSvc: CallService + DeleteEntityPermanently,
    ESvc: EntityAccessService,
{
    AsyncToolCollection::new()
        .add_tool::<ReadCallRecord, CallToolContext<CSvc, ESvc>>()
        .add_tool::<UpdateCallRecord, CallToolContext<CSvc, ESvc>>()
        .add_tool::<DeleteCallRecord, CallToolContext<CSvc, ESvc>>()
}
