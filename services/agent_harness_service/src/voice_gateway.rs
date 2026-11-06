//! Team-member voice catalog and fixed-line sample routes.

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use feature_flags::FeatureFlags;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use std::sync::Arc;
use team_agents::domain::voice::{Voice, VoiceProvider, Voices};

pub(crate) struct VoiceState<P, Flags, Eas, Auth> {
    pub service: Arc<Voices<P, Flags>>,
    pub access: Arc<Eas>,
    pub auth: MacroAuthorizationState<Auth>,
}

impl<P, Flags, Eas, Auth> Clone for VoiceState<P, Flags, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access: self.access.clone(),
            auth: self.auth.clone(),
        }
    }
}
impl<P, Flags, Eas, Auth> FromRef<VoiceState<P, Flags, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &VoiceState<P, Flags, Eas, Auth>) -> Self {
        state.access.clone()
    }
}
impl<P, Flags, Eas, Auth> FromRef<VoiceState<P, Flags, Eas, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &VoiceState<P, Flags, Eas, Auth>) -> Self {
        state.auth.clone()
    }
}

pub(crate) fn router<
    P: VoiceProvider,
    Flags: FeatureFlags + Send + Sync + 'static,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    state: VoiceState<P, Flags, Eas, Auth>,
) -> Router {
    Router::new()
        .route("/voices", get(catalog::<P, Flags, Eas, Auth>))
        .route("/voices/{model}/sample", get(sample::<P, Flags, Eas, Auth>))
        .with_state(state)
}

/// Provider voice metadata for the Invite agent form and agent settings.
#[utoipa::path(get, tag = "voices", operation_id = "get_agent_voices", path = "/voices", responses((status = 200, body = Vec<Voice>), (status = 403), (status = 502)))]
pub(crate) async fn catalog<
    P: VoiceProvider,
    Flags: FeatureFlags + Send + Sync + 'static,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<VoiceState<P, Flags, Eas, Auth>>,
) -> Response {
    match state.service.catalog(access.entity_access_receipt).await {
        Ok(voices) => Json(voices).into_response(),
        Err(
            team_agents::domain::models::TeamAgentError::NotEnabled
            | team_agents::domain::models::TeamAgentError::Forbidden,
        ) => StatusCode::FORBIDDEN.into_response(),
        Err(_) => StatusCode::BAD_GATEWAY.into_response(),
    }
}

/// Cached audio generated through Macro using a fixed preview line.
#[utoipa::path(get, tag = "voices", operation_id = "get_agent_voice_sample", path = "/voices/{model}/sample", params(("model" = String, Path)), responses((status = 200, description = "WAV audio sample", content_type = "audio/wav", body = Vec<u8>), (status = 400), (status = 403), (status = 502)))]
pub(crate) async fn sample<
    P: VoiceProvider,
    Flags: FeatureFlags + Send + Sync + 'static,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<VoiceState<P, Flags, Eas, Auth>>,
    Path(model): Path<String>,
) -> Response {
    match state
        .service
        .sample(access.entity_access_receipt, &model)
        .await
    {
        Ok(audio) => (
            [
                (header::CONTENT_TYPE, "audio/wav"),
                (header::CACHE_CONTROL, "private, max-age=86400"),
            ],
            audio,
        )
            .into_response(),
        Err(team_agents::domain::models::TeamAgentError::BadRequest(_)) => {
            StatusCode::BAD_REQUEST.into_response()
        }
        Err(
            team_agents::domain::models::TeamAgentError::NotEnabled
            | team_agents::domain::models::TeamAgentError::Forbidden,
        ) => StatusCode::FORBIDDEN.into_response(),
        Err(_) => StatusCode::BAD_GATEWAY.into_response(),
    }
}
