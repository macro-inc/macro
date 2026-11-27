//! Local Brain Email read routes over the human mailbox reader.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    Json, Router,
    extract::{FromRef, Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header::CACHE_CONTROL},
    middleware,
    response::{IntoResponse, Response},
    routing::get,
};
use chrono::{DateTime, Utc};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::user_team_receipt,
};
use feature_flags::FeatureFlags;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
    MacroUserAuthentication, UserOnly, is_program_run,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::domain::{
    mailbox_read::{
        InboxCursor, InboxFilter, InboxMessage, MailboxAddress, MailboxReadSource, MailboxReader,
        MailboxUnavailable, MailboxViewer, ThreadMessage,
    },
    ports::AgentAccounts,
};

const CURSOR_TTL: Duration = Duration::from_secs(300);
const CURSOR_LIMIT: usize = 256;

/// State for the local human-only mailbox routes.
pub struct BrainMailboxRouterState<Source, Accounts, Flags, Access, Auth> {
    reader: Arc<MailboxReader<Source, Accounts, Flags>>,
    access: Arc<Access>,
    authorization: MacroAuthorizationState<Auth>,
    cursors: Arc<Mutex<HashMap<Uuid, (Instant, InboxCursor)>>>,
}

impl<Source, Accounts, Flags, Access, Auth>
    BrainMailboxRouterState<Source, Accounts, Flags, Access, Auth>
{
    /// Set up the router and its bounded, process-local cursor registry.
    pub fn new(
        reader: MailboxReader<Source, Accounts, Flags>,
        access: Arc<Access>,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            reader: Arc::new(reader),
            access,
            authorization: authorization.require_verified_user(),
            cursors: Arc::default(),
        }
    }

    fn cursor(&self, token: Uuid) -> Result<InboxCursor, BrainMailboxError> {
        let cursors = self.cursors.lock().map_err(|_| BrainMailboxError)?;
        cursors
            .get(&token)
            .filter(|(issued, _)| issued.elapsed() < CURSOR_TTL)
            .map(|(_, cursor)| cursor.clone())
            .ok_or(BrainMailboxError)
    }

    fn issue_cursor(&self, cursor: InboxCursor) -> Result<Uuid, BrainMailboxError> {
        let mut cursors = self.cursors.lock().map_err(|_| BrainMailboxError)?;
        cursors.retain(|_, (issued, _)| issued.elapsed() < CURSOR_TTL);
        if cursors.len() >= CURSOR_LIMIT {
            return Err(BrainMailboxError);
        }
        let token = Uuid::new_v4();
        cursors.insert(token, (Instant::now(), cursor));
        Ok(token)
    }
}

impl<Source, Accounts, Flags, Access, Auth> Clone
    for BrainMailboxRouterState<Source, Accounts, Flags, Access, Auth>
{
    fn clone(&self) -> Self {
        Self {
            reader: self.reader.clone(),
            access: self.access.clone(),
            authorization: self.authorization.clone(),
            cursors: self.cursors.clone(),
        }
    }
}

impl<Source, Accounts, Flags, Access, Auth>
    FromRef<BrainMailboxRouterState<Source, Accounts, Flags, Access, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &BrainMailboxRouterState<Source, Accounts, Flags, Access, Auth>) -> Self {
        state.authorization.clone()
    }
}

impl<Source, Accounts, Flags, Access, Auth>
    BrainMailboxRouterState<Source, Accounts, Flags, Access, Auth>
where
    Access: EntityAccessService,
{
    async fn viewer(
        &self,
        user: &MacroUserAuthentication,
        headers: &HeaderMap,
        team: Uuid,
    ) -> Result<MailboxViewer, BrainMailboxError> {
        if !user.is_human_session() || is_program_run(user.attribution(), headers) {
            return Err(BrainMailboxError);
        }
        let receipt =
            user_team_receipt::<AdminTeamRole, _>(self.access.as_ref(), user.macro_user_id.clone())
                .await
                .map_err(|_| BrainMailboxError)?
                .filter(|receipt| receipt.entity().entity_id == team.to_string())
                .ok_or(BrainMailboxError)?;
        Ok(MailboxViewer::new(user, receipt)?)
    }
}

/// Selected teammate.
#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Path)]
pub struct BrainMailboxPath {
    user_id: String,
}

impl BrainMailboxPath {
    fn agent(self) -> Result<MacroUserIdStr<'static>, BrainMailboxError> {
        MacroUserIdStr::parse_from_str(&self.user_id)
            .map(CowLike::into_owned)
            .map_err(|_| BrainMailboxError)
    }
}

/// Direct link to a selected agent's thread.
#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Path)]
pub struct BrainMailboxThreadPath {
    user_id: String,
    thread_id: Uuid,
}

/// Team selected by the viewer.
#[derive(Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct BrainMailboxTeam {
    team_id: Uuid,
}

/// Inbox search parameters and an opaque continuation.
#[derive(Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct BrainMailboxQuery {
    team_id: Uuid,
    subject: Option<String>,
    from: Option<String>,
    cursor: Option<String>,
    limit: Option<u8>,
}

/// Address is present only for an exact active mailbox binding.
#[derive(Serialize, ToSchema)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum BrainMailboxAddress {
    /// Canonical provisioned address.
    Provisioned {
        /// Exact mailbox address.
        address: String,
    },
    /// The mailbox is still being provisioned.
    InProgress,
    /// The selected agent has no verified active address.
    Unavailable,
}

/// Viewer-safe fields for an inbox row.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BrainMailboxMessage {
    id: Uuid,
    thread_id: Uuid,
    from: String,
    subject: String,
    received_at: DateTime<Utc>,
}

impl From<InboxMessage> for BrainMailboxMessage {
    fn from(message: InboxMessage) -> Self {
        Self {
            id: message.id,
            thread_id: message.thread_id,
            from: message.from,
            subject: message.subject,
            received_at: message.received_at,
        }
    }
}

/// A page of authorized inbound mail.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BrainMailboxPage {
    items: Vec<BrainMailboxMessage>,
    next_cursor: Option<String>,
}

/// One checked thread message and its plain-text body, when present.
#[derive(Serialize, ToSchema)]
pub struct BrainMailboxThreadMessage {
    summary: BrainMailboxMessage,
    text: Option<String>,
}

impl From<ThreadMessage> for BrainMailboxThreadMessage {
    fn from(message: ThreadMessage) -> Self {
        Self {
            summary: message.summary.into(),
            text: message.text,
        }
    }
}

/// Independently authorized thread.
#[derive(Serialize, ToSchema)]
pub struct BrainMailboxThread {
    messages: Vec<BrainMailboxThreadMessage>,
}

/// Unavailable without exposing whether a mailbox, cursor or thread exists.
#[derive(Debug, thiserror::Error)]
#[error("mailbox unavailable")]
pub struct BrainMailboxError;

impl From<MailboxUnavailable> for BrainMailboxError {
    fn from(_: MailboxUnavailable) -> Self {
        Self
    }
}

impl IntoResponse for BrainMailboxError {
    fn into_response(self) -> Response {
        (
            StatusCode::NOT_FOUND,
            Json(BrainMailboxErrorBody {
                message: "mailbox unavailable",
            }),
        )
            .into_response()
    }
}

/// Generic error without mailbox metadata.
#[derive(Serialize, ToSchema)]
pub struct BrainMailboxErrorBody {
    message: &'static str,
}

/// Mount the viewer routes under the auth service's team agents prefix.
pub fn brain_mailbox_router<Source, Accounts, Flags, Access, Auth, Outer>(
    state: BrainMailboxRouterState<Source, Accounts, Flags, Access, Auth>,
) -> Router<Outer>
where
    Source: MailboxReadSource + 'static,
    Accounts: AgentAccounts,
    Flags: FeatureFlags + 'static,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Router::new()
        .route(
            "/{user_id}/email/address",
            get(brain_mailbox_address::<Source, Accounts, Flags, Access, Auth>),
        )
        .route(
            "/{user_id}/email/inbox",
            get(brain_mailbox_inbox::<Source, Accounts, Flags, Access, Auth>),
        )
        .route(
            "/{user_id}/email/threads/{thread_id}",
            get(brain_mailbox_thread::<Source, Accounts, Flags, Access, Auth>),
        )
        .layer(middleware::map_response(|mut response: Response| async {
            response
                .headers_mut()
                .insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
            response
        }))
        .with_state(state)
}

/// Read the configured address under the viewer's current human authorization.
#[utoipa::path(
    get,
    path = "/team_agents/{user_id}/email/address",
    operation_id = "get_brain_mailbox_address",
    tag = "team-agents",
    params(BrainMailboxPath, BrainMailboxTeam),
    responses(
        (status = 200, body = BrainMailboxAddress),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 403, body = model_error_response::ErrorResponse),
        (status = 404, body = BrainMailboxErrorBody)
    )
)]
#[tracing::instrument(skip_all, err, name = "team_agents.brain_mailbox.address")]
pub async fn brain_mailbox_address<Source, Accounts, Flags, Access, Auth>(
    session: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
    State(state): State<BrainMailboxRouterState<Source, Accounts, Flags, Access, Auth>>,
    Path(path): Path<BrainMailboxPath>,
    Query(team): Query<BrainMailboxTeam>,
) -> Result<Json<BrainMailboxAddress>, BrainMailboxError>
where
    Source: MailboxReadSource,
    Accounts: AgentAccounts,
    Flags: FeatureFlags,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let viewer = state
        .viewer(&session.authorization, &headers, team.team_id)
        .await?;
    Ok(Json(
        match state.reader.address(&viewer, &path.agent()?).await? {
            MailboxAddress::Provisioned(address) => BrainMailboxAddress::Provisioned { address },
            MailboxAddress::InProgress => BrainMailboxAddress::InProgress,
            MailboxAddress::Unavailable => BrainMailboxAddress::Unavailable,
        },
    ))
}

/// List authorized inbound messages in the selected teammate's mailbox.
#[utoipa::path(
    get,
    path = "/team_agents/{user_id}/email/inbox",
    operation_id = "get_brain_mailbox_inbox",
    tag = "team-agents",
    params(BrainMailboxPath, BrainMailboxQuery),
    responses(
        (status = 200, body = BrainMailboxPage),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 403, body = model_error_response::ErrorResponse),
        (status = 404, body = BrainMailboxErrorBody)
    )
)]
#[tracing::instrument(skip_all, err, name = "team_agents.brain_mailbox.inbox")]
pub async fn brain_mailbox_inbox<Source, Accounts, Flags, Access, Auth>(
    session: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
    State(state): State<BrainMailboxRouterState<Source, Accounts, Flags, Access, Auth>>,
    Path(path): Path<BrainMailboxPath>,
    Query(query): Query<BrainMailboxQuery>,
) -> Result<Json<BrainMailboxPage>, BrainMailboxError>
where
    Source: MailboxReadSource,
    Accounts: AgentAccounts,
    Flags: FeatureFlags,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let viewer = state
        .viewer(&session.authorization, &headers, query.team_id)
        .await?;
    let cursor = query
        .cursor
        .as_deref()
        .map(|token| {
            let token = Uuid::parse_str(token).map_err(|_| BrainMailboxError)?;
            state.cursor(token)
        })
        .transpose()?;
    let page = state
        .reader
        .list(
            &viewer,
            &path.agent()?,
            InboxFilter::new(query.subject.as_deref(), query.from.as_deref()),
            cursor.as_ref(),
            query.limit.unwrap_or(20),
        )
        .await?;
    let next_cursor = page
        .next
        .map(|cursor| state.issue_cursor(cursor))
        .transpose()?;
    Ok(Json(BrainMailboxPage {
        items: page.items.into_iter().map(Into::into).collect(),
        next_cursor: next_cursor.map(|token| token.to_string()),
    }))
}

/// Open one independently authorized thread in the selected mailbox.
#[utoipa::path(
    get,
    path = "/team_agents/{user_id}/email/threads/{thread_id}",
    operation_id = "get_brain_mailbox_thread",
    tag = "team-agents",
    params(BrainMailboxThreadPath, BrainMailboxTeam),
    responses(
        (status = 200, body = BrainMailboxThread),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 403, body = model_error_response::ErrorResponse),
        (status = 404, body = BrainMailboxErrorBody)
    )
)]
#[tracing::instrument(skip_all, err, name = "team_agents.brain_mailbox.thread")]
pub async fn brain_mailbox_thread<Source, Accounts, Flags, Access, Auth>(
    session: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
    State(state): State<BrainMailboxRouterState<Source, Accounts, Flags, Access, Auth>>,
    Path(path): Path<BrainMailboxThreadPath>,
    Query(team): Query<BrainMailboxTeam>,
) -> Result<Json<BrainMailboxThread>, BrainMailboxError>
where
    Source: MailboxReadSource,
    Accounts: AgentAccounts,
    Flags: FeatureFlags,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let viewer = state
        .viewer(&session.authorization, &headers, team.team_id)
        .await?;
    let agent = BrainMailboxPath {
        user_id: path.user_id,
    }
    .agent()?;
    let messages = state.reader.thread(&viewer, &agent, path.thread_id).await?;
    Ok(Json(BrainMailboxThread {
        messages: messages.into_iter().map(Into::into).collect(),
    }))
}
