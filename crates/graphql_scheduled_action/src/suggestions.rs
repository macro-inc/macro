//! Routine suggestions of the authenticated user: the list with its
//! generation status, and dismissing one.

use std::{future::Future, pin::Pin, sync::Arc};

use async_graphql::{Context, Enum, ErrorExtensions, ID, Json, Object, SimpleObject, Union};
use graphql_common::require_authenticated_user;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use rootcause::Report;
use routine_program::Surface;
use scheduled_action::domain::suggestions::model::{
    GenerationStatus, RoutineSuggestion, RoutineSuggestions, SuggestedPick, SuggestionFrom,
};
use serde_json::{Map, Value};

#[cfg(test)]
mod test;

/// Why a routine suggestions call failed.
#[derive(Debug)]
pub enum RoutineSuggestionsError {
    /// Routine suggestions are off for the user.
    Off,
    /// No such suggestion for the user.
    NotFound,
    /// Anything else.
    Internal(Report),
}

/// A boxed routine suggestions call.
pub type SuggestionsFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, RoutineSuggestionsError>> + Send + 'a>>;

/// Routine suggestions as GraphQL serves them. Object-safe, so request data
/// does not carry the service's type parameters.
pub trait RoutineSuggestionsGraphql: Send + Sync {
    /// The user's suggestions, only `surface`'s when given.
    fn suggestions(
        &self,
        user: MacroUserIdStr<'static>,
        surface: Option<Surface>,
    ) -> SuggestionsFuture<'_, RoutineSuggestions>;

    /// The user isn't interested in suggestion `id`, AI's or a template;
    /// the suggestion as it was shown.
    fn dismiss(
        &self,
        user: MacroUserIdStr<'static>,
        id: Uuid,
    ) -> SuggestionsFuture<'_, RoutineSuggestion>;

    /// Start the user's onboarding generation; whether one started.
    fn start_generation(
        &self,
        user: MacroUserIdStr<'static>,
        timezone: chrono_tz::Tz,
    ) -> SuggestionsFuture<'_, bool>;
}

/// Type-erased routine suggestions service stored in GraphQL request data.
#[derive(Clone)]
pub struct RoutineSuggestionsGraphqlContext(pub Arc<dyn RoutineSuggestionsGraphql>);

/// Flattenable routine suggestion fields of the authenticated user.
pub struct GraphqlRoutineSuggestionsQuery {
    user_id: MacroUserIdStr<'static>,
}

impl GraphqlRoutineSuggestionsQuery {
    /// Routine suggestion fields scoped to the authenticated `user_id`.
    pub fn new(user_id: MacroUserIdStr<'static>) -> Self {
        Self { user_id }
    }
}

/// Routine suggestion fields of the authenticated user.
#[Object]
impl GraphqlRoutineSuggestionsQuery {
    /// The routines suggested to the user, AI's first, then Macro's
    /// templates, with where their generation is; only `surface`'s when
    /// given. Reading never generates. Null when routine suggestions are
    /// off for them.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn routine_suggestions(
        &self,
        ctx: &Context<'_>,
        surface: Option<GraphqlRoutineSurface>,
    ) -> async_graphql::Result<Option<GraphqlRoutineSuggestions>> {
        let service = &ctx.data::<RoutineSuggestionsGraphqlContext>()?.0;
        match service
            .suggestions(self.user_id.clone(), surface.map(Into::into))
            .await
        {
            Ok(suggestions) => Ok(Some(suggestions.into())),
            Err(RoutineSuggestionsError::Off) => Ok(None),
            Err(error) => Err(suggestions_error(error)),
        }
    }
}

/// What the authenticated user does with their routine suggestions.
#[derive(Default)]
pub struct RoutineSuggestionsMutationRoot;

#[Object]
impl RoutineSuggestionsMutationRoot {
    /// The user isn't interested in a suggestion, AI's or a template: it is
    /// never suggested again, on any surface. Answers with the suggestion,
    /// now `DISMISSED`, so every list showing it drops it.
    #[tracing::instrument(skip_all, fields(routine.suggestion.id = %suggestion_id.as_str()), err(Debug))]
    async fn dismiss_routine_suggestion(
        &self,
        ctx: &Context<'_>,
        suggestion_id: ID,
    ) -> async_graphql::Result<GraphqlRoutineSuggestion> {
        let user = require_authenticated_user(ctx)?;
        let id: Uuid = suggestion_id.parse().map_err(|_| {
            async_graphql::Error::new("suggestionId must be a UUID")
                .extend_with(|_, extensions| extensions.set("code", "BAD_USER_INPUT"))
        })?;
        let service = &ctx.data::<RoutineSuggestionsGraphqlContext>()?.0;
        let dismissed = service.dismiss(user, id).await.map_err(suggestions_error)?;
        // The write committed, so a suggestion that can't be shown is a
        // terminal answer, never a retry.
        routine_suggestion(dismissed, GraphqlRoutineSuggestionState::Dismissed)
            .ok_or_else(|| suggestions_error(RoutineSuggestionsError::NotFound))
    }

    /// Start the user's onboarding generation, once their inbox is
    /// connected, in IANA time zone `timezone`: their ideas and routine
    /// suggestions, as each is on for them. Later calls start nothing.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn start_suggestion_generation(
        &self,
        ctx: &Context<'_>,
        timezone: String,
    ) -> async_graphql::Result<GraphqlSuggestionGenerationStarted> {
        let user = require_authenticated_user(ctx)?;
        let timezone: chrono_tz::Tz = timezone.parse().map_err(|_| {
            async_graphql::Error::new("timezone must be an IANA time zone name")
                .extend_with(|_, extensions| extensions.set("code", "BAD_USER_INPUT"))
        })?;
        let service = &ctx.data::<RoutineSuggestionsGraphqlContext>()?.0;
        let started = service
            .start_generation(user, timezone)
            .await
            .map_err(suggestions_error)?;
        Ok(GraphqlSuggestionGenerationStarted { started })
    }
}

/// Map a failure to a generic message and an `extensions.code`:
/// `FEATURE_OFF`, `NOT_FOUND` or `INTERNAL_SERVER_ERROR`. None is retryable.
fn suggestions_error(error: RoutineSuggestionsError) -> async_graphql::Error {
    let (code, message) = match error {
        RoutineSuggestionsError::Off => ("FEATURE_OFF", "routine suggestions are off"),
        RoutineSuggestionsError::NotFound => ("NOT_FOUND", "routine suggestion not found"),
        RoutineSuggestionsError::Internal(report) => {
            tracing::error!(error = ?report, "routine suggestions call failed");
            (
                "INTERNAL_SERVER_ERROR",
                "routine suggestions are unavailable",
            )
        }
    };
    async_graphql::Error::new(message).extend_with(|_, extensions| extensions.set("code", code))
}

/// The user's routine suggestions, and whether more are on the way.
#[derive(SimpleObject)]
pub struct GraphqlRoutineSuggestions {
    /// Where the user's suggestions are in being generated.
    status: GraphqlSuggestionGenerationStatus,
    /// Per surface, AI's first, best first, then Macro's templates. A
    /// suggestion with several surfaces appears once.
    suggestions: Vec<GraphqlRoutineSuggestion>,
}

impl From<RoutineSuggestions> for GraphqlRoutineSuggestions {
    fn from(suggestions: RoutineSuggestions) -> Self {
        Self {
            status: suggestions.status.into(),
            suggestions: suggestions
                .suggestions
                .into_iter()
                .filter_map(|suggestion| {
                    routine_suggestion(suggestion, GraphqlRoutineSuggestionState::Open)
                })
                .collect(),
        }
    }
}

/// A routine offered to the user: one AI suggested for them, or one of
/// Macro's catalog routines filling a surface.
#[derive(SimpleObject)]
pub struct GraphqlRoutineSuggestion {
    /// The suggestion's id: saving a routine from it and dismissing it name
    /// it. A template's id is the user's own for that catalog routine.
    id: ID,
    /// Who suggests it.
    from: GraphqlRoutineSuggestionFrom,
    /// The sidebars it shows in, first the one it belongs to most.
    surfaces: Vec<GraphqlRoutineSurface>,
    /// Why it fits the user, in a line; null on Macro's templates.
    reason: Option<String>,
    /// AI's estimate, from 0 to 1, that the user keeps it on; null on
    /// Macro's templates.
    keep_probability: Option<f32>,
    /// Onboarding shows it switched on.
    on_by_default: bool,
    /// Where it is for the user. Lists serve only `OPEN` ones; a mutation
    /// answers with the state it left, and views leave out the rest.
    state: GraphqlRoutineSuggestionState,
    /// What is suggested.
    pick: GraphqlRoutineSuggestionPick,
}

/// A suggestion as GraphQL serves it; a drafted routine that can't be
/// encoded is logged and left out, never failing the list.
fn routine_suggestion(
    suggestion: RoutineSuggestion,
    state: GraphqlRoutineSuggestionState,
) -> Option<GraphqlRoutineSuggestion> {
    let pick = match suggestion.pick {
        SuggestedPick::Catalog { key, knobs } => {
            GraphqlRoutineSuggestionPick::Catalog(GraphqlCatalogRoutinePick {
                key,
                knobs: Json(knobs),
            })
        }
        SuggestedPick::Routine { routine } => {
            let routine = serde_json::to_value(&routine)
                .inspect_err(|error| {
                    tracing::error!(?error, routine.suggestion.id = %suggestion.id, "could not encode a suggested routine");
                })
                .ok()?;
            GraphqlRoutineSuggestionPick::Routine(GraphqlDraftedRoutinePick {
                routine: Json(routine),
            })
        }
    };
    Some(GraphqlRoutineSuggestion {
        id: ID(suggestion.id.to_string()),
        from: suggestion.from.into(),
        surfaces: suggestion.surfaces.into_iter().map(Into::into).collect(),
        reason: suggestion.reason,
        keep_probability: suggestion.keep_probability,
        on_by_default: suggestion.on_by_default,
        state,
        pick,
    })
}

/// What is suggested.
#[derive(Union)]
pub enum GraphqlRoutineSuggestionPick {
    /// A catalog routine with knob values.
    Catalog(GraphqlCatalogRoutinePick),
    /// A routine AI drafted.
    Routine(GraphqlDraftedRoutinePick),
}

/// A catalog routine, with the knob values AI filled in. Its trigger and
/// steps come from the catalog.
#[derive(SimpleObject)]
pub struct GraphqlCatalogRoutinePick {
    /// The catalog routine, e.g. `inbox`.
    key: String,
    /// Knob values by knob name; knobs left out keep the catalog's.
    knobs: Json<Map<String, Value>>,
}

/// A routine AI drafted that passed saving's checks.
#[derive(SimpleObject)]
pub struct GraphqlDraftedRoutinePick {
    /// The routine as it would be saved, switched off: the body the
    /// scheduler's create route takes.
    routine: Json<Value>,
}

/// Where a routine suggestion is for the user.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
pub enum GraphqlRoutineSuggestionState {
    /// Shown.
    Open,
    /// The user turned it down; it is never suggested again.
    Dismissed,
}

/// What starting a generation did.
#[derive(SimpleObject)]
pub struct GraphqlSuggestionGenerationStarted {
    /// Whether a run started; false when one ran before or is running.
    started: bool,
}

/// Who suggests a routine.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
#[graphql(remote = "SuggestionFrom")]
pub enum GraphqlRoutineSuggestionFrom {
    /// AI suggested it for this user, with a reason.
    ForYou,
    /// One of Macro's catalog routines, as a template.
    Macro,
}

/// Where a user's suggestions are in being generated.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
#[graphql(remote = "GenerationStatus")]
pub enum GraphqlSuggestionGenerationStatus {
    /// Never generated: no inbox was connected yet. Only Macro's templates
    /// show.
    None,
    /// AI is suggesting; its suggestions appear as each is handed back.
    Generating,
    /// Generation finished.
    Ready,
    /// Generation failed, after a retry; Macro's templates fill in.
    Failed,
}

/// The part of the app a routine is about, where it is offered.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
#[graphql(remote = "Surface")]
pub enum GraphqlRoutineSurface {
    /// Mail.
    Email,
    /// Meetings and the day ahead.
    Calendar,
    /// Tasks and projects.
    Tasks,
    /// Documents and files.
    Files,
    /// Companies, people and deals.
    Crm,
    /// Channels and messages.
    Chat,
    /// Calls and their transcripts.
    Calls,
    /// Pull requests and code review.
    Reviews,
    /// Agents and their sessions.
    Agents,
}
