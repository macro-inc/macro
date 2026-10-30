//! Agent tools that ask an owner for more access, as the Share menu does. Nothing
//! here grants access: approval stays with the item's reviewers.
use crate::domain::{
    models::*,
    ports::{Clock, RequestRepository},
    service::AccessRequestService,
};
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::ports::EntityAccessService;
use models_permissions::share_permission::access_level::AccessLevel;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The request workflow the tools delegate to.
pub struct AccessRequestToolContext<R, A, C> {
    /// Request policy and persistence.
    pub service: Arc<AccessRequestService<R, A, C>>,
}
impl<R, A, C> Clone for AccessRequestToolContext<R, A, C> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

/// Request access and read a request's outcome.
pub fn access_request_toolset<R: RequestRepository, A: EntityAccessService, C: Clock>()
-> AsyncToolCollection<AccessRequestToolContext<R, A, C>> {
    AsyncToolCollection::new()
        .add_tool::<RequestEntityAccess, AccessRequestToolContext<R, A, C>>()
        .add_tool::<ReadEntityAccessRequest, AccessRequestToolContext<R, A, C>>()
}

/// Access a requester can ask for; ownership is never requestable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RequestedAccess {
    /// View the item.
    View,
    /// View and comment.
    Comment,
    /// Edit the item.
    Edit,
}
impl From<RequestedAccess> for AccessLevel {
    fn from(value: RequestedAccess) -> Self {
        match value {
            RequestedAccess::View => Self::View,
            RequestedAccess::Comment => Self::Comment,
            RequestedAccess::Edit => Self::Edit,
        }
    }
}

const ENTITY_TYPE: &str = "Kind of item: document (files, tasks, snippets and skills), initiative (a task project, shown as a Project in the app), project (a folder), chat, database, call, email_thread, agent_session or external_chat.";

/// Ask the item's owner for more access in the user's name.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "RequestEntityAccess",
    description = "Ask the owner of an item for more access in the user's name, as the Share menu's Request access does: the owner gets a normal access request from the user and decides. Use it only when the user asked you to request access or agreed after you offered, typically after a write failed because the user can only view the item; never request access on your own. It never grants access and does not retry the failed action. Tell the user the request is pending and who it went to, then check it with ReadEntityAccessRequest and retry the original action only once it is granted."
)]
pub struct RequestEntityAccess {
    /// Shared item kind.
    #[schemars(description = ENTITY_TYPE)]
    pub entity_type: ShareEntityType,
    /// Item identifier.
    #[schemars(description = "Id of the item.")]
    pub entity_id: Uuid,
    /// Requested access.
    #[schemars(
        description = "Access to ask for; it must be above the user's current access. Usually edit."
    )]
    pub access: RequestedAccess,
}
impl ToolAnnotated for RequestEntityAccess {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::additive("Request access").with_idempotent();
}

/// A request waiting on the item's reviewers.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RequestEntityAccessResponse {
    /// Request state; pending until a reviewer decides.
    pub status: RequestStatus,
    /// Access asked for.
    pub requested_level: AccessLevel,
    /// User ids of the people who can approve it; empty when the user cannot yet
    /// see the item, whose owner then stays private.
    pub sent_to: Vec<String>,
    /// When the request was made.
    pub requested_at: DateTime<Utc>,
}

#[async_trait]
impl<R: RequestRepository, A: EntityAccessService, C: Clock>
    AsyncTool<AccessRequestToolContext<R, A, C>> for RequestEntityAccess
{
    type Output = RequestEntityAccessResponse;

    #[tracing::instrument(name = "access_requests.tool.request", skip_all, fields(entity_id = %self.entity_id, entity_type = ?self.entity_type, requested_level = ?self.access), err)]
    async fn call(
        &self,
        context: ServiceContext<AccessRequestToolContext<R, A, C>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let submitted = context
            .service
            .request(
                request.user_id,
                ShareEntity {
                    entity_type: self.entity_type,
                    entity_id: self.entity_id,
                },
                self.access.into(),
            )
            .await
            .map_err(failure)?;
        Ok(RequestEntityAccessResponse {
            status: submitted.request.status,
            requested_level: submitted.request.requested_level,
            sent_to: submitted
                .reviewers
                .into_iter()
                .map(|user| user.to_string())
                .collect(),
            requested_at: submitted.request.created_at,
        })
    }
}

/// Read the user's access and their latest request on an item.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadEntityAccessRequest",
    description = "Read the user's current access to an item and the outcome of their latest access request on it: pending, granted, denied or cancelled. Use it to check a request made with RequestEntityAccess before retrying the action that needed the access."
)]
pub struct ReadEntityAccessRequest {
    /// Shared item kind.
    #[schemars(description = ENTITY_TYPE)]
    pub entity_type: ShareEntityType,
    /// Item identifier.
    #[schemars(description = "Id of the item.")]
    pub entity_id: Uuid,
}
impl ToolAnnotated for ReadEntityAccessRequest {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read access request");
}

/// The user's access and their latest request.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadEntityAccessRequestResponse {
    /// The user's effective access, absent without any.
    pub current_access: Option<AccessLevel>,
    /// Access levels this item can be shared at.
    pub supported_levels: Vec<AccessLevel>,
    /// The recorded owner, absent when the user cannot see the item.
    pub owner: Option<String>,
    /// The user's latest request, absent when they never asked.
    pub request: Option<AccessRequestSummary>,
}

/// One request's outcome.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AccessRequestSummary {
    /// Current outcome.
    pub status: RequestStatus,
    /// Access asked for.
    pub requested_level: AccessLevel,
    /// Access a reviewer granted.
    pub granted_level: Option<AccessLevel>,
    /// Last change.
    pub updated_at: DateTime<Utc>,
    /// Earliest time another request may be made.
    pub retry_after: Option<DateTime<Utc>>,
}

#[async_trait]
impl<R: RequestRepository, A: EntityAccessService, C: Clock>
    AsyncTool<AccessRequestToolContext<R, A, C>> for ReadEntityAccessRequest
{
    type Output = ReadEntityAccessRequestResponse;

    #[tracing::instrument(name = "access_requests.tool.read", skip_all, fields(entity_id = %self.entity_id, entity_type = ?self.entity_type), err)]
    async fn call(
        &self,
        context: ServiceContext<AccessRequestToolContext<R, A, C>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let state = context
            .service
            .state(
                request.user_id,
                ShareEntity {
                    entity_type: self.entity_type,
                    entity_id: self.entity_id,
                },
                0,
            )
            .await
            .map_err(failure)?;
        Ok(ReadEntityAccessRequestResponse {
            current_access: state.access_level,
            supported_levels: state.supported_levels,
            owner: state.owner,
            request: state.mine.map(|mine| AccessRequestSummary {
                status: mine.status,
                requested_level: mine.requested_level,
                granted_level: mine.granted_level,
                updated_at: mine.updated_at,
                retry_after: mine.retry_after,
            }),
        })
    }
}

fn failure(error: RequestError) -> ToolCallError {
    let description = match &error {
        RequestError::Forbidden => "Access can't be requested on this item: the user already owns or reviews it, or nobody can approve requests for it".into(),
        RequestError::NotFound => "The item was not found".into(),
        RequestError::InvalidLevel => "That access is unavailable for this item or not above the user's current access; read the request state for the available levels".into(),
        RequestError::Conflict | RequestError::Cooldown(_) | RequestError::Internal(_) => {
            error.to_string()
        }
    };
    ToolCallError {
        description,
        internal_error: error.into(),
    }
}
