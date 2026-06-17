//! Axum router for AI projection materialization.

#![allow(clippy::upper_case_acronyms)]

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_user::{UserContext, axum_extractor::MacroUserExtractor};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::domain::{
    models::{
        MaterializeProjectionRequest as DomainMaterializeProjectionRequest,
        MaterializeProjectionResponse as DomainMaterializeProjectionResponse, ProjectionError,
        ProjectionExpiry as DomainProjectionExpiry, ProjectionStatus as DomainProjectionStatus,
        RefreshCadence as DomainRefreshCadence, Target as DomainTarget,
    },
    ports::AiProjectionService,
};

const PROFESSIONAL_FEATURES_PERMISSION: &str = "read:professional_features";
const INTERNAL_ERROR_MESSAGE: &str = "failed to materialize AI projection";

/// Axum router state for AI projection endpoints.
pub struct AIProjectionRouterState<Svc> {
    /// App-facing AI projection service.
    pub service: Arc<Svc>,
}

impl<Svc> AIProjectionRouterState<Svc> {
    /// Create AI projection router state from a service.
    pub fn new(service: Arc<Svc>) -> Self {
        Self { service }
    }
}

impl<Svc> Clone for AIProjectionRouterState<Svc> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
        }
    }
}

/// Build the AI projections Axum router.
pub fn ai_projections_router<Svc, S>(state: AIProjectionRouterState<Svc>) -> Router<S>
where
    Svc: AiProjectionService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/materialize",
            post(materialize_ai_projection_handler::<Svc>),
        )
        .with_state(state)
}

/// Target for an AI projection.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", tag = "type")]
#[schema(as = AiProjectionTarget)]
pub enum AIProjectionTarget {
    /// Projection scoped to a single user.
    User {
        /// Target user id.
        id: String,
    },
    /// Projection scoped to a team.
    Team {
        /// Target team id.
        id: String,
    },
}

impl From<AIProjectionTarget> for DomainTarget {
    fn from(target: AIProjectionTarget) -> Self {
        match target {
            AIProjectionTarget::User { id } => Self::User { id },
            AIProjectionTarget::Team { id } => Self::Team { id },
        }
    }
}

/// Refresh cadence for an active AI projection.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = AiProjectionRefreshCadence)]
pub enum AIProjectionRefreshCadence {
    /// Refresh approximately hourly.
    High,
    /// Refresh approximately every six hours.
    Medium,
    /// Refresh approximately daily.
    Low,
}

impl From<AIProjectionRefreshCadence> for DomainRefreshCadence {
    fn from(cadence: AIProjectionRefreshCadence) -> Self {
        match cadence {
            AIProjectionRefreshCadence::High => Self::High,
            AIProjectionRefreshCadence::Medium => Self::Medium,
            AIProjectionRefreshCadence::Low => Self::Low,
        }
    }
}

/// Inactivity expiry window for an AI projection.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = AiProjectionExpiry)]
pub enum AIProjectionExpiry {
    /// Expire after one day without access.
    Day,
    /// Expire after one week without access.
    Week,
    /// Expire after roughly one month without access.
    Month,
}

impl From<AIProjectionExpiry> for DomainProjectionExpiry {
    fn from(expiry: AIProjectionExpiry) -> Self {
        match expiry {
            AIProjectionExpiry::Day => Self::Day,
            AIProjectionExpiry::Week => Self::Week,
            AIProjectionExpiry::Month => Self::Month,
        }
    }
}

/// Backend status for a materialized AI projection.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = AiProjectionStatus)]
pub enum AIProjectionStatus {
    /// The projection has no cached output yet.
    Cold,
    /// The projection has fresh cached output.
    Ready,
    /// The projection has cached output while a refresh is due or running.
    Refreshing,
    /// The last generation attempt failed.
    Error,
}

impl From<DomainProjectionStatus> for AIProjectionStatus {
    fn from(status: DomainProjectionStatus) -> Self {
        match status {
            DomainProjectionStatus::Cold => Self::Cold,
            DomainProjectionStatus::Ready => Self::Ready,
            DomainProjectionStatus::Refreshing => Self::Refreshing,
            DomainProjectionStatus::Error => Self::Error,
        }
    }
}

/// Request body for lazily materializing an AI projection.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MaterializeAIProjectionRequest {
    /// Frontend-defined projection id.
    pub id: String,
    /// Projection target.
    pub target: AIProjectionTarget,
    /// Prompt used to generate the projection.
    pub prompt: String,
    /// Optional frontend context appended to the generation request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    /// Refresh cadence for active cached output.
    pub refresh_cadence: AIProjectionRefreshCadence,
    /// Inactivity expiry window for this projection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expiry: Option<AIProjectionExpiry>,
    /// Optional schema metadata for future structured output.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<Value>,
    /// Force a background refresh even when cached output is fresh.
    #[serde(default)]
    pub force_refresh: bool,
}

impl From<MaterializeAIProjectionRequest> for DomainMaterializeProjectionRequest {
    fn from(request: MaterializeAIProjectionRequest) -> Self {
        Self {
            id: request.id,
            target: request.target.into(),
            prompt: request.prompt,
            context: request.context,
            refresh_cadence: request.refresh_cadence.into(),
            expiry: request.expiry.map(Into::into),
            schema: request.schema,
            force_refresh: request.force_refresh,
        }
    }
}

/// Response body returned by the AI projection materialization endpoint.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = AiProjectionResponse)]
pub struct AIProjectionResponse {
    /// Current backend status.
    pub status: AIProjectionStatus,
    /// Cached projection output when available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    /// Last generation error when available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// When the current output was generated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generated_at: Option<DateTime<Utc>>,
    /// When the current output becomes stale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stale_at: Option<DateTime<Utc>>,
}

impl From<DomainMaterializeProjectionResponse> for AIProjectionResponse {
    fn from(response: DomainMaterializeProjectionResponse) -> Self {
        Self {
            status: response.status.into(),
            data: response.data,
            error: response.error,
            generated_at: response.generated_at,
            stale_at: response.stale_at,
        }
    }
}

/// Error body returned by AI projection endpoints.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[schema(as = AiProjectionErrorResponse)]
pub struct AIProjectionErrorResponse {
    /// Human-readable error message.
    pub error: String,
}

/// Error returned by AI projection handlers.
#[derive(Debug)]
pub struct AIProjectionApiError {
    status: StatusCode,
    message: String,
    source: Option<ProjectionError>,
}

impl AIProjectionApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
            source: None,
        }
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
            source: None,
        }
    }

    fn internal(source: ProjectionError) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: INTERNAL_ERROR_MESSAGE.to_string(),
            source: Some(source),
        }
    }
}

impl From<ProjectionError> for AIProjectionApiError {
    fn from(error: ProjectionError) -> Self {
        let message = error.to_string();

        match error {
            ProjectionError::EmptyProjectionId
            | ProjectionError::EmptyPrompt
            | ProjectionError::EmptyTargetId => Self::bad_request(message),
            ProjectionError::UserTargetMismatch { .. }
            | ProjectionError::UnauthorizedTeamTarget { .. } => Self::forbidden(message),
            ProjectionError::Repository(_)
            | ProjectionError::Publisher(_)
            | ProjectionError::Generator(_) => Self::internal(error),
        }
    }
}

impl IntoResponse for AIProjectionApiError {
    fn into_response(self) -> Response {
        let Self {
            status,
            message,
            source,
        } = self;

        if let Some(source) = source {
            tracing::error!(error = ?source, "failed to materialize AI projection");
        }

        (status, Json(AIProjectionErrorResponse { error: message })).into_response()
    }
}

/// Materialize an AI projection for the authenticated paid user.
#[utoipa::path(
    post,
    path = "/ai_projections/materialize",
    tag = "ai_projections",
    operation_id = "materialize_ai_projection",
    request_body = MaterializeAIProjectionRequest,
    responses(
        (status = 200, description = "Current materialized projection state", body = AIProjectionResponse),
        (status = 400, description = "Invalid projection definition", body = AIProjectionErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Paid access or target authorization required", body = AIProjectionErrorResponse),
        (status = 500, description = "Unexpected service error", body = AIProjectionErrorResponse),
    )
)]
pub async fn materialize_ai_projection_handler<Svc>(
    State(state): State<AIProjectionRouterState<Svc>>,
    user: MacroUserExtractor,
    Json(request): Json<MaterializeAIProjectionRequest>,
) -> Result<Json<AIProjectionResponse>, AIProjectionApiError>
where
    Svc: AiProjectionService,
{
    materialize_ai_projection(
        state,
        user.macro_user_id.clone(),
        &user.user_context,
        request,
    )
    .await
}

async fn materialize_ai_projection<Svc>(
    state: AIProjectionRouterState<Svc>,
    requester: MacroUserIdStr<'static>,
    user_context: &UserContext,
    request: MaterializeAIProjectionRequest,
) -> Result<Json<AIProjectionResponse>, AIProjectionApiError>
where
    Svc: AiProjectionService,
{
    if !has_paid_access(user_context) {
        return Err(AIProjectionApiError::forbidden(
            "AI projections require paid access",
        ));
    }

    let response = state.service.materialize(requester, request.into()).await?;

    Ok(Json(response.into()))
}

fn has_paid_access(user_context: &UserContext) -> bool {
    user_context
        .permissions
        .as_ref()
        .is_some_and(|permissions| permissions.contains(PROFESSIONAL_FEATURES_PERMISSION))
}

#[cfg(test)]
mod test {
    use std::collections::HashSet;
    use std::sync::{Arc, Mutex};

    use axum::response::IntoResponse;
    use macro_user_id::user_id::MacroUserIdStr;
    use serde_json::json;

    use super::*;
    use crate::domain::models::{
        MaterializeProjectionRequest, MaterializeProjectionResponse, ProjectionStatus,
        Result as DomainResult,
    };

    #[derive(Clone)]
    struct FakeProjectionService {
        state: Arc<Mutex<FakeProjectionServiceState>>,
    }

    struct FakeProjectionServiceState {
        response: Option<DomainResult<MaterializeProjectionResponse>>,
        calls: Vec<(MacroUserIdStr<'static>, MaterializeProjectionRequest)>,
    }

    impl FakeProjectionService {
        fn new(response: DomainResult<MaterializeProjectionResponse>) -> Self {
            Self {
                state: Arc::new(Mutex::new(FakeProjectionServiceState {
                    response: Some(response),
                    calls: Vec::new(),
                })),
            }
        }

        fn calls(&self) -> Vec<(MacroUserIdStr<'static>, MaterializeProjectionRequest)> {
            self.state
                .lock()
                .expect("fake service state lock")
                .calls
                .clone()
        }
    }

    impl AiProjectionService for FakeProjectionService {
        fn materialize(
            &self,
            requester: MacroUserIdStr<'static>,
            request: MaterializeProjectionRequest,
        ) -> impl Future<Output = DomainResult<MaterializeProjectionResponse>> + Send {
            let result = {
                let mut state = self.state.lock().expect("fake service state lock");
                state.calls.push((requester, request));
                state.response.take().expect("fake service response")
            };

            std::future::ready(result)
        }
    }

    #[tokio::test]
    async fn paid_user_can_materialize_projection() {
        let service = FakeProjectionService::new(Ok(ready_domain_response()));

        let Json(response) = call_handler(
            service.clone(),
            paid_user(),
            api_request(AIProjectionTarget::User {
                id: "macro|projection@example.com".to_string(),
            }),
        )
        .await
        .expect("projection response");

        assert_eq!(response.status, AIProjectionStatus::Ready);
        assert_eq!(response.data.as_deref(), Some("cached output"));

        let calls = service.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, user_id("macro|projection@example.com"));
    }

    #[tokio::test]
    async fn free_user_receives_forbidden_without_calling_service() {
        let service = FakeProjectionService::new(Ok(ready_domain_response()));

        let error = call_handler(
            service.clone(),
            free_user(),
            api_request(AIProjectionTarget::User {
                id: "macro|projection@example.com".to_string(),
            }),
        )
        .await
        .expect_err("free user should be rejected");

        assert_eq!(error.into_response().status(), StatusCode::FORBIDDEN);
        assert!(service.calls().is_empty());
    }

    #[tokio::test]
    async fn unauthorized_target_receives_forbidden() {
        let service = FakeProjectionService::new(Err(ProjectionError::UnauthorizedTeamTarget {
            user_id: "macro|projection@example.com".to_string(),
            team_id: "team-1".to_string(),
        }));

        let error = call_handler(
            service,
            paid_user(),
            api_request(AIProjectionTarget::Team {
                id: "team-1".to_string(),
            }),
        )
        .await
        .expect_err("unauthorized target should be rejected");

        assert_eq!(error.into_response().status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn invalid_projection_definition_receives_bad_request() {
        let service = FakeProjectionService::new(Err(ProjectionError::EmptyPrompt));

        let error = call_handler(
            service,
            paid_user(),
            api_request(AIProjectionTarget::User {
                id: "macro|projection@example.com".to_string(),
            }),
        )
        .await
        .expect_err("invalid definition should be rejected");

        assert_eq!(error.into_response().status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn unexpected_service_error_receives_internal_server_error() {
        let service = FakeProjectionService::new(Err(ProjectionError::Repository(
            anyhow::anyhow!("database unavailable"),
        )));

        let error = call_handler(
            service,
            paid_user(),
            api_request(AIProjectionTarget::User {
                id: "macro|projection@example.com".to_string(),
            }),
        )
        .await
        .expect_err("unexpected error should be rejected");

        assert_eq!(
            error.into_response().status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[tokio::test]
    async fn force_refresh_is_passed_to_service() {
        let service = FakeProjectionService::new(Ok(ready_domain_response()));
        let mut request = api_request(AIProjectionTarget::User {
            id: "macro|projection@example.com".to_string(),
        });
        request.force_refresh = true;

        let Json(_) = call_handler(service.clone(), paid_user(), request)
            .await
            .expect("projection response");

        let calls = service.calls();
        assert_eq!(calls.len(), 1);
        assert!(calls[0].1.force_refresh);
    }

    async fn call_handler(
        service: FakeProjectionService,
        user: TestUser,
        request: MaterializeAIProjectionRequest,
    ) -> std::result::Result<Json<AIProjectionResponse>, AIProjectionApiError> {
        let TestUser {
            macro_user_id,
            user_context,
        } = user;

        materialize_ai_projection(
            AIProjectionRouterState::new(Arc::new(service)),
            macro_user_id,
            &user_context,
            request,
        )
        .await
    }

    fn api_request(target: AIProjectionTarget) -> MaterializeAIProjectionRequest {
        MaterializeAIProjectionRequest {
            id: "inbox/important".to_string(),
            target,
            prompt: "What should I triage first?".to_string(),
            context: Some("Recent inbox activity".to_string()),
            refresh_cadence: AIProjectionRefreshCadence::High,
            expiry: Some(AIProjectionExpiry::Day),
            schema: Some(json!({ "type": "string" })),
            force_refresh: false,
        }
    }

    fn ready_domain_response() -> MaterializeProjectionResponse {
        MaterializeProjectionResponse {
            status: ProjectionStatus::Ready,
            data: Some("cached output".to_string()),
            error: None,
            generated_at: None,
            stale_at: None,
        }
    }

    fn paid_user() -> TestUser {
        user_with_permissions(&[PROFESSIONAL_FEATURES_PERMISSION])
    }

    fn free_user() -> TestUser {
        user_with_permissions(&[])
    }

    fn user_with_permissions(permissions: &[&str]) -> TestUser {
        let permission_set = permissions
            .iter()
            .map(|permission| (*permission).to_string())
            .collect::<HashSet<_>>();

        TestUser {
            macro_user_id: user_id("macro|projection@example.com"),
            user_context: UserContext {
                user_id: "macro|projection@example.com".to_string(),
                fusion_user_id: "fusion-user-id".to_string(),
                permissions: Some(permission_set),
                organization_id: None,
            },
        }
    }

    struct TestUser {
        macro_user_id: MacroUserIdStr<'static>,
        user_context: UserContext,
    }

    fn user_id(value: &str) -> MacroUserIdStr<'static> {
        MacroUserIdStr::try_from(value.to_string()).expect("valid macro user id")
    }
}
