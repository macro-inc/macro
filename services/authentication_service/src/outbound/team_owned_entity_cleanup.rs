//! Team deletion's view of the bot roster, the entity registry, and the
//! services that own each entity kind.

#[cfg(test)]
mod test;

use std::{sync::Arc, time::Duration};

use bot_id::BotId;
use bots::domain::ports::TeamBotRoster;
use document_storage_service_client::DocumentStorageServiceClient;
use entity_registry::{EntityRecord, EntityRegistryService, Owner, RegisteredEntityType};
use macro_authorization::INTERNAL_API_KEY_HEADER;
use rootcause::{Report, compat::ReportAsError, prelude::*};
use teams::domain::owned_entity_cleanup::{OwnedEntityCleanup, OwnedEntityRef, TeamDeletionOwner};
use uuid::Uuid;

/// [`OwnedEntityCleanup`] over the bot roster and the entity registry.
#[derive(Clone)]
pub struct TeamOwnedEntityCleanupAdapter<B, R> {
    bots: B,
    registry: R,
    documents: Arc<DocumentStorageServiceClient>,
    client: reqwest::Client,
    internal_key: String,
    harness_url: String,
    scheduled_action_url: String,
}

impl<B, R> TeamOwnedEntityCleanupAdapter<B, R> {
    /// Construct a bounded HTTP client. Redirects must not turn a failed
    /// internal DELETE into an unrelated successful response.
    ///
    /// `internal_key` is the fleet-wide internal service key that the agent
    /// harness and scheduled-action services validate.
    pub fn new(
        bots: B,
        registry: R,
        documents: Arc<DocumentStorageServiceClient>,
        internal_key: String,
        harness_url: String,
        scheduled_action_url: String,
    ) -> Result<Self, Report> {
        Ok(Self {
            bots,
            registry,
            documents,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(300))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            internal_key,
            harness_url,
            scheduled_action_url,
        })
    }

    async fn purge_through_route(
        &self,
        base: &str,
        resource: &str,
        id: Uuid,
        owner: &Owner,
    ) -> Result<(), Report<RoutePurgeError>> {
        let response = self
            .client
            .delete(format!(
                "{}/{resource}/internal/{id}",
                base.trim_end_matches('/')
            ))
            .query(&[("owner", owner.principal_id())])
            .header(INTERNAL_API_KEY_HEADER, &self.internal_key)
            .send()
            .await
            .context(RoutePurgeError::Unreachable)?;
        match route_purge_outcome(response.status()) {
            Ok(()) => Ok(()),
            Err(error) => {
                let body = response.text().await.unwrap_or_default();
                Err(report!(error).attach(body))
            }
        }
    }
}

impl<B, R> OwnedEntityCleanup for TeamOwnedEntityCleanupAdapter<B, R>
where
    B: TeamBotRoster + Clone,
    R: EntityRegistryService,
{
    type Err = ReportAsError;

    #[tracing::instrument(skip(self), err)]
    async fn team_bots(&self, team_id: Uuid) -> Result<Vec<BotId>, Self::Err> {
        self.bots
            .team_bot_ids(team_id)
            .await
            .map_err(ReportAsError::from)
    }

    #[tracing::instrument(skip(self), err)]
    async fn owned_by(&self, owner: &TeamDeletionOwner) -> Result<Vec<OwnedEntityRef>, Self::Err> {
        let records = self
            .registry
            .list_all_owned_by(&owner.as_owner())
            .await
            .map_err(Report::into_dynamic)?;
        records
            .into_iter()
            .map(owned_entity_ref)
            .collect::<Result<_, _>>()
            .map_err(ReportAsError::from)
    }

    #[tracing::instrument(skip(self), err)]
    async fn purge(&self, entity: &OwnedEntityRef) -> Result<(), Self::Err> {
        let owner = entity.owner.as_owner();
        match entity.entity_type {
            RegisteredEntityType::Document
            | RegisteredEntityType::Chat
            | RegisteredEntityType::Project => self
                .documents
                .purge_owned_entity(entity.entity_type, entity.id, &owner)
                .await
                .map_err(Report::into_dynamic)?,
            RegisteredEntityType::AgentSession => self
                .purge_through_route(&self.harness_url, "agent-sessions", entity.id, &owner)
                .await
                .map_err(Report::into_dynamic)?,
            RegisteredEntityType::ScheduledAction => self
                .purge_through_route(
                    &self.scheduled_action_url,
                    "scheduled-actions",
                    entity.id,
                    &owner,
                )
                .await
                .map_err(Report::into_dynamic)?,
        }
        Ok(())
    }
}

/// A registry row as an entity team deletion may purge. A listing for a team
/// or a bot that returns a user's entity is a bad read, and purging it would
/// delete a person's content, so it is an error.
fn owned_entity_ref(record: EntityRecord) -> Result<OwnedEntityRef, Report> {
    let owner = match record.owner {
        Owner::Team(team_id) => TeamDeletionOwner::Team(team_id),
        Owner::Bot(bot_id) => TeamDeletionOwner::Bot(bot_id),
        Owner::User(_) => {
            return Err(
                report!("the entity registry listed a user's entity for a team or bot")
                    .attach(format!("entity: {}", record.id)),
            );
        }
    };
    Ok(OwnedEntityRef {
        id: record.id,
        entity_type: record.entity_type,
        owner,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
enum RoutePurgeError {
    #[error("the entity has another owner")]
    OwnedElsewhere,
    #[error("unable to reach the owning service")]
    Unreachable,
    #[error("the owning service answered {status}")]
    UnexpectedResponse { status: u16 },
}

/// Only 204 is a purge, of the entity or of nothing because it was already
/// gone. A 404 means the route is missing on that deployment, so it fails like
/// any other unexpected answer.
fn route_purge_outcome(status: reqwest::StatusCode) -> Result<(), RoutePurgeError> {
    match status {
        reqwest::StatusCode::NO_CONTENT => Ok(()),
        reqwest::StatusCode::CONFLICT => Err(RoutePurgeError::OwnedElsewhere),
        status => Err(RoutePurgeError::UnexpectedResponse {
            status: status.as_u16(),
        }),
    }
}
