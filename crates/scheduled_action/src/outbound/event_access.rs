//! Translate the owning entity-access service's typed receipts, not permission
//! tables or event actors, into the routine domain's narrow capability port.
//! GitHub deliveries are the owner's when they hold a claim to the delivering
//! installation, as the GitHub domain decides it.

use entity_access::domain::{
    models::{AccessError, EntityType, ViewAccessLevel, ViewOnly},
    ports::EntityAccessService,
};
use github::domain::ports::GithubInstallationClaims;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

use crate::domain::{
    event_runs::{CurrentOwnerAccess, EventAccessCapability},
    event_trigger::{EventEntityType, EventReference, EventSource},
};

#[cfg(test)]
mod test;

pub struct EventAccessAdapter<S, G> {
    service: S,
    github: G,
}

impl<S, G> EventAccessAdapter<S, G> {
    pub fn new(service: S, github: G) -> Self {
        Self { service, github }
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

impl<S: EntityAccessService, G: GithubInstallationClaims> CurrentOwnerAccess
    for EventAccessAdapter<S, G>
{
    async fn authorize(
        &self,
        owner: &MacroUserIdStr<'static>,
        event: &EventReference,
    ) -> Result<Option<EventAccessCapability>, Report> {
        let entity_id = match event.source() {
            EventSource::Entity { entity_id, .. } => entity_id.to_string(),
            EventSource::Github(delivery) => {
                let claimed = self
                    .github
                    .has_claim(owner, delivery.installation_id)
                    .await
                    .map_err(|error| Report::new(error).into_dynamic())?;
                return Ok(claimed.then(|| EventAccessCapability::GithubInstallation {
                    owner: owner.clone(),
                    installation_id: delivery.installation_id,
                }));
            }
        };
        let id = &entity_id;
        let result = match event.entity_type() {
            EventEntityType::Document => self
                .service
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    owner,
                    None,
                    id,
                    EntityType::Document,
                )
                .await
                .map(EventAccessCapability::Document),
            EventEntityType::Channel => self
                .service
                .generate_entity_access_receipt::<ViewOnly>(owner, None, id, EntityType::Channel)
                .await
                .map(EventAccessCapability::Channel),
            EventEntityType::EmailThread => self
                .service
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    owner,
                    None,
                    id,
                    EntityType::EmailThread,
                )
                .await
                .map(EventAccessCapability::EmailThread),
            EventEntityType::Call => self
                .service
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    owner,
                    None,
                    id,
                    EntityType::Call,
                )
                .await
                .map(EventAccessCapability::Call),
            EventEntityType::GithubInstallation => {
                return Err(rootcause::report!(
                    "an entity event named an external source"
                ));
            }
        };
        access_result(result)
    }
}
