//! Thin transport adapter for the owner-checked session delete that team
//! deletion calls once per session it removes.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService};
use macro_uuid::Uuid;
use model_owner::Owner;
use serde::Deserialize;
use shared_entity_registry::OwnedPurgeOutcome;

use super::AgentSessionControlState;
use crate::domain::model::AgentSessionId;
use crate::domain::ports::AgentSessionNotificationRecipient;

#[derive(Debug, Deserialize)]
pub(super) struct OwnerQuery {
    owner: Owner,
}

/// Internal owner removal: never grants delete authority to a user, bot, or
/// harness token. 204 once the session is gone, including when it already
/// was. 409 when another owner holds it, and nothing was deleted. 500 when
/// teardown failed; the purge converges, so the caller retries.
#[tracing::instrument(skip_all, fields(%session_id, owner.kind = ?owner.owner_type()))]
pub(super) async fn purge_owned_session_handler<R, Access, Auth>(
    State(state): State<AgentSessionControlState<R, Access, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Path(session_id): Path<Uuid>,
    Query(OwnerQuery { owner }): Query<OwnerQuery>,
) -> StatusCode
where
    R: AgentSessionNotificationRecipient,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let id = AgentSessionId::new_from_uuid(session_id);
    match state.recipient.purge_owned_session(id, &owner).await {
        Ok(OwnedPurgeOutcome::Purged) => StatusCode::NO_CONTENT,
        Ok(OwnedPurgeOutcome::OwnedElsewhere) => StatusCode::CONFLICT,
        Err(error) => {
            tracing::error!(error = ?error, "unable to purge the owned agent session");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}
