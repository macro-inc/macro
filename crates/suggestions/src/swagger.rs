//! The suggestions routes' OpenAPI, merged into the scheduler's spec that serves
//! them.

use utoipa::OpenApi;

/// The suggestions routes' OpenAPI.
#[derive(OpenApi)]
#[openapi(
    paths(
        crate::inbound::router::list_suggestions,
        crate::inbound::router::accept_suggestion,
        crate::inbound::router::dismiss_suggestion,
        crate::inbound::router::review_suggestions,
        crate::inbound::router::add_suggestion,
        crate::inbound::router::rewrite_suggestion,
        crate::inbound::router::retire_suggestion,
        crate::inbound::router::attach_suggestion_draft,
    ),
    components(schemas(
        crate::domain::model::Suggestion,
        crate::domain::model::SuggestionKind,
        crate::domain::model::KindName,
        crate::domain::model::SuggestionState,
        crate::domain::model::Category,
        crate::domain::model::RunMode,
        crate::domain::model::EntityAction,
        crate::domain::model::Target,
        crate::domain::model::SuggestionFeed,
        crate::domain::model::SuggestionsReview,
        crate::domain::model::NewSuggestion,
        crate::domain::model::RewriteSuggestion,
        crate::inbound::router::AcceptSuggestionRequest,
        crate::inbound::router::SuggestionChanged,
        crate::domain::model::RetireSuggestionRequest,
        crate::domain::model::AttachDraft,
        crate::domain::model::SuggestionWriteOutcome,
    )),
    tags((name = "suggestions", description = "Each person's suggestions, and the tools generation sessions manage them with")),
)]
pub struct SuggestionsApiDoc;
