//! `/voices`: the agent voices a team admin picks from, and their samples.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::header,
    response::{IntoResponse, Response},
    routing::get,
};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use feature_flags::FeatureFlags;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use model_error_response::ErrorResponse;
use team_agents::domain::models::TeamAgentError;
use team_agents::domain::voice::{Voice, VoiceModel, VoiceProvider, Voices};

/// How long a browser may reuse a sample; a voice's sample never changes.
const SAMPLE_CACHE_CONTROL: &str = "private, max-age=86400";

/// Router state.
pub(crate) struct VoiceState<Provider, Flags, Access, Auth> {
    pub(crate) voices: Arc<Voices<Provider, Flags>>,
    pub(crate) access: Arc<Access>,
    pub(crate) authorization: MacroAuthorizationState<Auth>,
}

impl<Provider, Flags, Access, Auth> Clone for VoiceState<Provider, Flags, Access, Auth> {
    fn clone(&self) -> Self {
        Self {
            voices: self.voices.clone(),
            access: self.access.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Provider, Flags, Access, Auth> FromRef<VoiceState<Provider, Flags, Access, Auth>>
    for Arc<Access>
{
    fn from_ref(state: &VoiceState<Provider, Flags, Access, Auth>) -> Self {
        state.access.clone()
    }
}

impl<Provider, Flags, Access, Auth> FromRef<VoiceState<Provider, Flags, Access, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &VoiceState<Provider, Flags, Access, Auth>) -> Self {
        state.authorization.clone()
    }
}

/// - `GET /voices`: the catalog.
/// - `GET /voices/{model}/sample`: WAV of the voice saying a fixed line.
pub(crate) fn router<Provider, Flags, Access, Auth>(
    state: VoiceState<Provider, Flags, Access, Auth>,
) -> Router
where
    Provider: VoiceProvider,
    Flags: FeatureFlags + 'static,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Router::new()
        .route("/voices", get(catalog::<Provider, Flags, Access, Auth>))
        .route(
            "/voices/{model}/sample",
            get(sample::<Provider, Flags, Access, Auth>),
        )
        .with_state(state)
}

/// The voices an agent teammate can speak with on calls. Team admins only.
#[utoipa::path(
    get,
    tag = "voices",
    operation_id = "get_agent_voices",
    path = "/voices",
    responses(
        (status = 200, body = Vec<Voice>),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 502, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err)]
pub(crate) async fn catalog<Provider, Flags, Access, Auth>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Access, Auth>,
    State(state): State<VoiceState<Provider, Flags, Access, Auth>>,
) -> Result<Json<Vec<Voice>>, TeamAgentError>
where
    Provider: VoiceProvider,
    Flags: FeatureFlags + 'static,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state.voices.catalog(access.entity_access_receipt).await?,
    ))
}

/// A catalog voice saying a fixed line, as WAV. Team admins only; the first
/// play of each voice is billed to the admin's team.
#[utoipa::path(
    get,
    tag = "voices",
    operation_id = "get_agent_voice_sample",
    path = "/voices/{model}/sample",
    params(("model" = String, Path, description = "An Aura-2 model, such as aura-2-thalia-en")),
    responses(
        (status = 200, description = "WAV audio", content_type = "audio/wav", body = Vec<u8>),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 502, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err)]
pub(crate) async fn sample<Provider, Flags, Access, Auth>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Access, Auth>,
    State(state): State<VoiceState<Provider, Flags, Access, Auth>>,
    Path(model): Path<String>,
) -> Result<Response, TeamAgentError>
where
    Provider: VoiceProvider,
    Flags: FeatureFlags + 'static,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let model = VoiceModel::parse(model).map_err(|_| TeamAgentError::UnknownVoice)?;
    let audio = state
        .voices
        .sample(access.entity_access_receipt, &model)
        .await?;
    Ok((
        [
            (header::CONTENT_TYPE, "audio/wav"),
            (header::CACHE_CONTROL, SAMPLE_CACHE_CONTROL),
        ],
        audio,
    )
        .into_response())
}
