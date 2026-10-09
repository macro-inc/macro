//! The owner-checked permanent delete that team deletion calls once per
//! entity it removes.
//!
//! DSS owns documents, chats, and projects. Agent sessions and scheduled
//! actions belong to the agent harness and scheduled-action services, so this
//! route refuses them instead of deleting rows those services own.

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
};
use entity_registry::{OwnedPurgeOutcome, Owner, PurgeOwnedEntity, RegisteredEntityType};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use uuid::Uuid;

use crate::api::context::AuthorizationService;

/// Path of the route under `/internal`.
pub(super) const ROUTE: &str = "/owned/{entity_type}/{entity_id}";

/// The owning services the route purges through, one per kind DSS owns.
pub(crate) struct OwnedPurgeState<D, C, P> {
    documents: Arc<D>,
    chats: Arc<C>,
    projects: Arc<P>,
}

impl<D, C, P> OwnedPurgeState<D, C, P> {
    pub(crate) fn new(documents: Arc<D>, chats: Arc<C>, projects: Arc<P>) -> Self {
        Self {
            documents,
            chats,
            projects,
        }
    }
}

impl<D, C, P> Clone for OwnedPurgeState<D, C, P> {
    fn clone(&self) -> Self {
        Self {
            documents: Arc::clone(&self.documents),
            chats: Arc::clone(&self.chats),
            projects: Arc::clone(&self.projects),
        }
    }
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct OwnerQuery {
    owner: Owner,
}

/// `DELETE /internal/owned/{entity_type}/{entity_id}?owner=<principal>`.
///
/// 204 once the entity is gone, including when it already was. 409 when it
/// exists under another owner, and nothing was deleted. 400 for a kind DSS
/// does not own. 500 when the owning service failed. The purge converges, so
/// the caller retries.
#[tracing::instrument(skip(state, _auth, owner), fields(owner.kind = ?owner.owner_type()))]
pub(super) async fn handler<D, C, P>(
    State(state): State<OwnedPurgeState<D, C, P>>,
    _auth: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Path((entity_type, entity_id)): Path<(RegisteredEntityType, Uuid)>,
    Query(OwnerQuery { owner }): Query<OwnerQuery>,
) -> StatusCode
where
    D: PurgeOwnedEntity + 'static,
    C: PurgeOwnedEntity + 'static,
    P: PurgeOwnedEntity + 'static,
{
    let purged = match entity_type {
        RegisteredEntityType::Document => state.documents.purge_owned(entity_id, &owner).await,
        RegisteredEntityType::Chat => state.chats.purge_owned(entity_id, &owner).await,
        RegisteredEntityType::Project => state.projects.purge_owned(entity_id, &owner).await,
        RegisteredEntityType::AgentSession | RegisteredEntityType::ScheduledAction => {
            tracing::warn!("another service owns this kind");
            return StatusCode::BAD_REQUEST;
        }
    };
    match purged {
        Ok(OwnedPurgeOutcome::Purged) => StatusCode::NO_CONTENT,
        Ok(OwnedPurgeOutcome::OwnedElsewhere) => StatusCode::CONFLICT,
        Err(error) => {
            tracing::error!(error = ?error, "unable to purge the owned entity");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}
