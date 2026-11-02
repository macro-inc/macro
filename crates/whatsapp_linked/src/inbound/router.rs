//! Thin HTTP adapter for the caller's WhatsApp account, pairing and chat
//! list: authenticated owners flow to [`WhatsAppService`]. DSS mounts
//! [`whatsapp_router`] at `/whatsapp`; added chats are served by
//! `external_chat`'s `/external-chats` routes.

use crate::domain::{models::*, service::WhatsAppService};
use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    routing::{get, post},
};
use external_chat::inbound::router::{ApiError, authority, no_store};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// Capabilities supplied by DSS.
pub struct WhatsAppRouterState<Auth> {
    /// Use cases.
    pub service: Arc<WhatsAppService>,
    /// Standard authentication provider.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<Auth> Clone for WhatsAppRouterState<Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Auth> FromRef<WhatsAppRouterState<Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &WhatsAppRouterState<Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Explicit pairing intent; replacement is a separate deliberate action.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = WhatsAppConnect)]
pub struct Connect {
    /// Replace the retained identity with a different WhatsApp account.
    #[serde(default)]
    pub replace: bool,
}

/// The consent generation the owner deliberately disconnects.
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = WhatsAppDisconnectRequest)]
pub struct DisconnectRequest {
    /// Fences retries against a later reconnect or replacement.
    pub authorization_generation: i64,
}

/// A phone number to start a direct chat with.
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = WhatsAppLookupRequest)]
pub struct LookupRequest {
    /// E.164: `+`, the country code and the number, without spacing.
    pub phone_number: String,
}

/// The caller's WhatsApp account, pairing and chat list, under `/whatsapp`.
pub fn whatsapp_router<Auth, S>(state: WhatsAppRouterState<Auth>) -> Router<S>
where
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    no_store(
        Router::new()
            .route("/account", get(account::<Auth>))
            .route("/connect", post(connect::<Auth>))
            .route("/disconnect", post(disconnect::<Auth>))
            .route("/pairing/{id}", get(pairing::<Auth>).delete(cancel::<Auth>))
            .route("/pairing/{id}/passkey", post(passkey::<Auth>))
            .route("/chats", get(chats::<Auth>))
            .route("/lookups", post(start_lookup::<Auth>))
            .route("/lookups/{id}", get(lookup::<Auth>))
            .route("/history-import", post(import_history::<Auth>)),
    )
    .with_state(state)
}

/// The caller's own account.
#[utoipa::path(get, path = "/whatsapp/account", operation_id = "whatsapp_account", responses((status = 200, body = AccountView)))]
pub async fn account<Auth: MacroAuthorizationService>(
    State(state): State<WhatsAppRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<AccountView>, ApiError> {
    Ok(Json(AccountView {
        account: state
            .service
            .account(&auth.authorization.macro_user_id)
            .await?,
    }))
}

/// Start or resume the caller's pairing transaction.
#[utoipa::path(post, path = "/whatsapp/connect", operation_id = "whatsapp_connect", request_body = Connect, responses((status = 200, body = Pairing)))]
pub async fn connect<Auth: MacroAuthorizationService>(
    State(state): State<WhatsAppRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Json(body): Json<Connect>,
) -> Result<Json<Pairing>, ApiError> {
    Ok(Json(
        state
            .service
            .connect(
                &auth.authorization.macro_user_id,
                body.replace,
                authority(&auth.authorization),
            )
            .await?,
    ))
}

/// Poll the caller's pairing transaction, including its current QR code.
#[utoipa::path(get, path = "/whatsapp/pairing/{id}", operation_id = "whatsapp_pairing", params(("id" = Uuid, Path)), responses((status = 200, body = PairState)))]
pub async fn pairing<Auth: MacroAuthorizationService>(
    State(state): State<WhatsAppRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
) -> Result<Json<PairState>, ApiError> {
    Ok(Json(
        state
            .service
            .pair_state(
                &auth.authorization.macro_user_id,
                id,
                authority(&auth.authorization),
            )
            .await?,
    ))
}

/// Cancel the caller's pairing transaction.
#[utoipa::path(delete, path = "/whatsapp/pairing/{id}", operation_id = "whatsapp_cancel_pairing", params(("id" = Uuid, Path)), responses((status = 204)))]
pub async fn cancel<Auth: MacroAuthorizationService>(
    State(state): State<WhatsAppRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .cancel(
            &auth.authorization.macro_user_id,
            id,
            authority(&auth.authorization),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Forward the owner's WebAuthn assertion to the pairing replica.
#[utoipa::path(post, path = "/whatsapp/pairing/{id}/passkey", operation_id = "whatsapp_passkey", params(("id" = Uuid, Path)), request_body = Object, responses((status = 204)))]
pub async fn passkey<Auth: MacroAuthorizationService>(
    State(state): State<WhatsAppRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .passkey(
            &auth.authorization.macro_user_id,
            id,
            &body,
            authority(&auth.authorization),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// End the caller's observation consent.
#[utoipa::path(post, path = "/whatsapp/disconnect", operation_id = "whatsapp_disconnect", request_body = DisconnectRequest, responses((status = 200, body = Disconnect)))]
pub async fn disconnect<Auth: MacroAuthorizationService>(
    State(state): State<WhatsAppRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Json(body): Json<DisconnectRequest>,
) -> Result<Json<Disconnect>, ApiError> {
    Ok(Json(
        state
            .service
            .disconnect(
                &auth.authorization.macro_user_id,
                body.authorization_generation,
                authority(&auth.authorization),
            )
            .await?,
    ))
}

/// The caller's WhatsApp chat list (groups and direct chats), newest
/// activity first, with what can be added to Macro.
#[utoipa::path(get, path = "/whatsapp/chats", operation_id = "whatsapp_chats", responses((status = 200, body = ChatList)))]
pub async fn chats<Auth: MacroAuthorizationService>(
    State(state): State<WhatsAppRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<ChatList>, ApiError> {
    Ok(Json(
        state
            .service
            .chats(&auth.authorization.macro_user_id)
            .await?,
    ))
}

/// Ask whether a phone number has a WhatsApp account, to start a direct chat
/// with it; poll the lookup until it is no longer `pending`. Found numbers
/// join the chat list, so `POST /external-chats` adds them.
#[utoipa::path(post, path = "/whatsapp/lookups", operation_id = "whatsapp_start_lookup", request_body = LookupRequest, responses((status = 200, body = Lookup)))]
pub async fn start_lookup<Auth: MacroAuthorizationService>(
    State(state): State<WhatsAppRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Json(body): Json<LookupRequest>,
) -> Result<Json<Lookup>, ApiError> {
    Ok(Json(
        state
            .service
            .lookup(
                &auth.authorization.macro_user_id,
                &body.phone_number,
                authority(&auth.authorization),
            )
            .await?,
    ))
}

/// Import earlier messages of the caller's chats that wait for their phone
/// (`backfill.state` `waiting_for_phone`). WhatsApp must be open on the phone.
#[utoipa::path(post, path = "/whatsapp/history-import", operation_id = "whatsapp_import_history", responses((status = 200, body = HistoryImport)))]
pub async fn import_history<Auth: MacroAuthorizationService>(
    State(state): State<WhatsAppRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<HistoryImport>, ApiError> {
    Ok(Json(
        state
            .service
            .import_history(
                &auth.authorization.macro_user_id,
                authority(&auth.authorization),
            )
            .await?,
    ))
}

/// Poll the caller's phone-number lookup.
#[utoipa::path(get, path = "/whatsapp/lookups/{id}", operation_id = "whatsapp_lookup", params(("id" = Uuid, Path)), responses((status = 200, body = Lookup)))]
pub async fn lookup<Auth: MacroAuthorizationService>(
    State(state): State<WhatsAppRouterState<Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
) -> Result<Json<Lookup>, ApiError> {
    Ok(Json(
        state
            .service
            .lookup_state(
                &auth.authorization.macro_user_id,
                id,
                authority(&auth.authorization),
            )
            .await?,
    ))
}

#[cfg(test)]
mod test;
