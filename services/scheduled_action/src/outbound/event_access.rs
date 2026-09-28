//! Translate the owning entity-access service's typed receipts, not permission
//! tables or event actors, into the routine domain's narrow capability port.

use entity_access::domain::{
    models::{AccessError, EntityType, ViewAccessLevel, ViewOnly},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

use crate::domain::{
    event_runs::{CurrentOwnerAccess, EventAccessCapability},
    event_trigger::{EventEntityType, EventReference},
};

#[cfg(test)]
mod test;

pub struct EventAccessAdapter<S> {
    service: S,
}

impl<S> EventAccessAdapter<S> {
    pub fn new(service: S) -> Self {
        Self { service }
    }
}

fn access_result<T>(result: Result<T, AccessError>) -> Result<Option<T>, Report> {
    match result {
        Ok(receipt) => Ok(Some(receipt)),
        Err(
            AccessError::Unauthorized
            | AccessError::UnauthorizedWithMessage(_)
            | AccessError::NotFound(_),
        ) => Ok(None),
        // Never turn infrastructure or adapter-contract errors into denial.
        Err(error) => Err(Report::new(error).into_dynamic()),
    }
}

impl<S: EntityAccessService> CurrentOwnerAccess for EventAccessAdapter<S> {
    async fn authorize(
        &self,
        owner: &MacroUserIdStr<'static>,
        event: &EventReference,
    ) -> Result<Option<EventAccessCapability>, Report> {
        let id = event.entity_id().to_string();
        let result = match event.entity_type() {
            EventEntityType::Document => self
                .service
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    owner,
                    None,
                    &id,
                    EntityType::Document,
                )
                .await
                .map(EventAccessCapability::Document),
            EventEntityType::Channel => self
                .service
                .generate_entity_access_receipt::<ViewOnly>(owner, None, &id, EntityType::Channel)
                .await
                .map(EventAccessCapability::Channel),
        };
        access_result(result)
    }
}
