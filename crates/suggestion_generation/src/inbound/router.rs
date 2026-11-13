//! The generation routes: onboarding starts a person's generation, the web app
//! records app loads, reads the person's generations and asks for fresh
//! suggestions.

use std::sync::Arc;

use axum::extract::{FromRef, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use serde::Deserialize;
use suggestions::domain::model::GenerationTrigger;
use utoipa::IntoParams;

use scheduled_action::domain::suggestions::model::RoutineSuggestions;

use crate::domain::generation::GenerationOverview;
use crate::domain::model::{
    GenerationError, GenerationStarted, RegenerationCooldown, RegenerationRefusal,
    RegenerationRunning, StartOutcome,
};

#[cfg(test)]
mod test;

/// Starts generations; implemented by the generation service.
pub trait StartGeneration: Send + Sync + 'static {
    /// Start the person's onboarding generation.
    fn start_onboarding(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'static>,
        timezone: chrono_tz::Tz,
    ) -> impl Future<Output = Result<bool, GenerationError>> + Send;

    /// Start the fresh suggestions the person asked for.
    fn regenerate(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'static>,
        timezone: chrono_tz::Tz,
    ) -> impl Future<Output = Result<(), GenerationError>> + Send;

    /// The person's generations now.
    fn overview(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<GenerationOverview, GenerationError>> + Send;

    /// The person loaded the app in `timezone`.
    fn seen(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'static>,
        timezone: chrono_tz::Tz,
    ) -> impl Future<Output = Result<(), GenerationError>> + Send;

    /// The person's routine suggestions, as the retired generate route
    /// answered with them.
    fn routine_suggestions(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<RoutineSuggestions, GenerationError>> + Send;
}

/// What the route shares.
pub struct GenerationRouterState<S, Auth> {
    /// The generation service.
    pub service: Arc<S>,
    /// Who is calling.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for GenerationRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> FromRef<GenerationRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &GenerationRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// The generation routes.
pub fn generation_router<S, Auth, St>(state: GenerationRouterState<S, Auth>) -> Router<St>
where
    S: StartGeneration,
    Auth: MacroAuthorizationService,
    St: Send + Sync,
{
    Router::new()
        .route("/suggestions/generate", post(start_generation::<S, Auth>))
        .route("/suggestions/seen", post(seen::<S, Auth>))
        .route("/suggestions/generation", get(overview::<S, Auth>))
        .route("/suggestions/regenerate", post(regenerate::<S, Auth>))
        // Web and app bundles from before the unified generation still
        // call this. Remove once none does.
        .route(
            "/scheduled-actions/suggestions/generate",
            post(legacy_generate::<S, Auth>),
        )
        .with_state(state)
}

/// The person's time zone.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct GenerateQuery {
    /// IANA time zone, e.g. `America/New_York`.
    #[param(value_type = String)]
    pub timezone: chrono_tz::Tz,
}

/// A generation call's failure, as an HTTP answer.
pub struct GenerationApiError(GenerationError);

impl IntoResponse for GenerationApiError {
    fn into_response(self) -> axum::response::Response {
        match self.0 {
            error @ GenerationError::NotFound => {
                (StatusCode::NOT_FOUND, error.to_string()).into_response()
            }
            GenerationError::Running => (
                StatusCode::CONFLICT,
                Json(RegenerationRunning {
                    reason: RegenerationRefusal::Running,
                }),
            )
                .into_response(),
            GenerationError::Cooldown { available_at } => {
                let wait = (available_at - chrono::Utc::now()).num_seconds().max(1);
                (
                    StatusCode::TOO_MANY_REQUESTS,
                    [(axum::http::header::RETRY_AFTER, wait.to_string())],
                    Json(RegenerationCooldown { available_at }),
                )
                    .into_response()
            }
            GenerationError::Internal(report) => {
                tracing::error!(error = ?report, "a generation call failed");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
            }
        }
    }
}

#[utoipa::path(
    post,
    path = "/suggestions/generate",
    tag = "suggestions",
    operation_id = "start_suggestion_generation",
    params(GenerateQuery),
    responses(
        (status = 200, body = GenerationStarted, description = "The caller's onboarding generation started in the background: their suggestions and routine suggestions, as each is on for them. Later calls start nothing"),
        (status = 401, body = String),
        (status = 404, body = String, description = "Neither suggestions nor routine suggestions are on for the caller"),
        (status = 500, body = String),
    )
)]
/// Start the caller's onboarding generation, once their inbox is connected.
pub async fn start_generation<S, Auth>(
    State(state): State<GenerationRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Query(query): Query<GenerateQuery>,
) -> Result<Json<GenerationStarted>, GenerationApiError>
where
    S: StartGeneration,
    Auth: MacroAuthorizationService,
{
    let started = state
        .service
        .start_onboarding(&user.authorization.macro_user_id, query.timezone)
        .await
        .map_err(GenerationApiError)?;
    Ok(Json(GenerationStarted { started }))
}

impl<Repo, Sessions, Routines, SuggestionFeed, Flags> StartGeneration
    for crate::domain::service::GenerationService<Repo, Sessions, Routines, SuggestionFeed, Flags>
where
    Repo: crate::domain::ports::GenerationRepo,
    Sessions: agent_session::domain::routines::RoutineSessions,
    Routines: scheduled_action::domain::suggestions::ports::RoutineSuggestionApi,
    SuggestionFeed: suggestions::domain::ports::SuggestionApi,
    Flags: feature_flags::FeatureFlags + 'static,
{
    async fn start_onboarding(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'static>,
        timezone: chrono_tz::Tz,
    ) -> Result<bool, GenerationError> {
        let outcome = self
            .start(user, GenerationTrigger::Onboarding, timezone)
            .await?;
        Ok(outcome == StartOutcome::Started)
    }

    async fn regenerate(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'static>,
        timezone: chrono_tz::Tz,
    ) -> Result<(), GenerationError> {
        self.regenerate(user, timezone).await
    }

    async fn overview(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> Result<GenerationOverview, GenerationError> {
        self.overview(user).await
    }

    async fn seen(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'static>,
        timezone: chrono_tz::Tz,
    ) -> Result<(), GenerationError> {
        self.seen(user, timezone).await
    }

    async fn routine_suggestions(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> Result<RoutineSuggestions, GenerationError> {
        self.routine_suggestions(user).await
    }
}

#[utoipa::path(
    post,
    path = "/suggestions/seen",
    tag = "suggestions",
    operation_id = "record_suggestions_seen",
    params(GenerateQuery),
    responses(
        (status = 204, description = "Recorded: with suggestions on and a paid plan, the caller counts as active for nightly generations in their time zone; otherwise nothing changes"),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
/// The caller loaded the app in their time zone.
pub async fn seen<S, Auth>(
    State(state): State<GenerationRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Query(query): Query<GenerateQuery>,
) -> Result<StatusCode, GenerationApiError>
where
    S: StartGeneration,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .seen(&user.authorization.macro_user_id, query.timezone)
        .await
        .map_err(GenerationApiError)?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/suggestions/generation",
    tag = "suggestions",
    operation_id = "get_suggestion_generation",
    responses(
        (status = 200, body = GenerationOverview, description = "The caller's generations now: whether one is running (poll while it is), how the last one ended, and when they may next ask for fresh suggestions"),
        (status = 401, body = String),
        (status = 404, body = String, description = "Suggestions are off for the caller"),
        (status = 500, body = String),
    )
)]
/// The caller's suggestion generations now.
pub async fn overview<S, Auth>(
    State(state): State<GenerationRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<GenerationOverview>, GenerationApiError>
where
    S: StartGeneration,
    Auth: MacroAuthorizationService,
{
    let overview = state
        .service
        .overview(&user.authorization.macro_user_id)
        .await
        .map_err(GenerationApiError)?;
    Ok(Json(overview))
}

#[utoipa::path(
    post,
    path = "/suggestions/regenerate",
    tag = "suggestions",
    operation_id = "regenerate_suggestions",
    params(GenerateQuery),
    responses(
        (status = 202, body = GenerationStarted, description = "Fresh suggestions started in the background: the caller's whole workspace researched again and their feed brought up to date, with routine suggestions when the week's are due. Poll `GET /suggestions/generation` until it is idle"),
        (status = 401, body = String),
        (status = 404, body = String, description = "Suggestions are off for the caller"),
        (status = 409, body = RegenerationRunning, description = "One of the caller's generations is running"),
        (status = 429, body = RegenerationCooldown, description = "The caller asked within the hour; `Retry-After` says in how many seconds they may ask again"),
        (status = 500, body = String),
    )
)]
/// Start fresh suggestions for the caller: at most once an hour, and not
/// while one of their generations runs.
pub async fn regenerate<S, Auth>(
    State(state): State<GenerationRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Query(query): Query<GenerateQuery>,
) -> Result<(StatusCode, Json<GenerationStarted>), GenerationApiError>
where
    S: StartGeneration,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .regenerate(&user.authorization.macro_user_id, query.timezone)
        .await
        .map_err(GenerationApiError)?;
    Ok((StatusCode::ACCEPTED, Json(GenerationStarted { started: true })))
}

/// The retired `POST /scheduled-actions/suggestions/generate`: start the
/// caller's onboarding generation and answer with their routine
/// suggestions, as that route did. Not in the API spec.
pub async fn legacy_generate<S, Auth>(
    State(state): State<GenerationRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Query(query): Query<GenerateQuery>,
) -> Result<Json<RoutineSuggestions>, GenerationApiError>
where
    S: StartGeneration,
    Auth: MacroAuthorizationService,
{
    let user = &user.authorization.macro_user_id;
    state
        .service
        .start_onboarding(user, query.timezone)
        .await
        .map_err(GenerationApiError)?;
    let suggestions = state
        .service
        .routine_suggestions(user)
        .await
        .map_err(GenerationApiError)?;
    Ok(Json(suggestions))
}
