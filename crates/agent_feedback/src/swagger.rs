//! The feedback routes' OpenAPI, merged into the agent harness document that
//! serves them.

use utoipa::OpenApi;

/// The feedback routes' OpenAPI.
#[derive(OpenApi)]
#[openapi(
    paths(
        crate::inbound::axum_router::rate_turn,
        crate::inbound::axum_router::retract_turn,
        crate::inbound::axum_router::my_turn_feedback,
        crate::inbound::axum_router::rate_message,
        crate::inbound::axum_router::retract_message,
        crate::inbound::axum_router::my_message_feedback,
        crate::inbound::axum_router::rate_run,
        crate::inbound::axum_router::retract_run,
        crate::inbound::axum_router::my_run_feedback,
        crate::inbound::axum_router::rate_suggestion,
        crate::inbound::axum_router::retract_suggestion,
        crate::inbound::axum_router::my_suggestion_feedback,
        crate::inbound::axum_router::export_feedback,
    ),
    components(schemas(
        crate::domain::model::Rating,
        crate::domain::model::Surface,
        crate::domain::model::SubjectKind,
        crate::domain::model::AgentKind,
        crate::domain::model::FeedbackState,
        crate::domain::model::MyFeedback,
        crate::domain::model::ExportCursor,
        crate::domain::model::FeedbackEvent,
        crate::domain::model::ExportPage,
        crate::inbound::axum_router::RateFeedbackBody,
        crate::inbound::axum_router::MyFeedbackResponse,
        crate::inbound::axum_router::FeedbackErrorBody,
    ))
)]
pub struct AgentFeedbackApiDoc;
