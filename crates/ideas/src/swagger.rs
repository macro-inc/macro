//! The ideas routes' OpenAPI, merged into the scheduler's spec that serves
//! them.

use utoipa::OpenApi;

/// The ideas routes' OpenAPI.
#[derive(OpenApi)]
#[openapi(
    paths(
        crate::inbound::router::list_ideas,
        crate::inbound::router::accept_idea,
        crate::inbound::router::dismiss_idea,
        crate::inbound::router::review_ideas,
        crate::inbound::router::suggest_idea,
        crate::inbound::router::rewrite_idea,
        crate::inbound::router::retire_idea,
    ),
    components(schemas(
        crate::domain::model::Idea,
        crate::domain::model::IdeaKind,
        crate::domain::model::KindName,
        crate::domain::model::IdeaState,
        crate::domain::model::Category,
        crate::domain::model::RunMode,
        crate::domain::model::EntityAction,
        crate::domain::model::Target,
        crate::domain::model::Ideas,
        crate::domain::model::IdeaReview,
        crate::domain::model::SuggestIdea,
        crate::domain::model::RewriteIdea,
        crate::inbound::router::AcceptIdeaRequest,
        crate::inbound::router::IdeaChanged,
        crate::domain::model::RetireIdea,
        crate::domain::model::IdeaWriteOutcome,
    )),
    tags((name = "suggestions", description = "Each person's suggestions, and the tools generation sessions manage them with")),
)]
pub struct IdeasApiDoc;
