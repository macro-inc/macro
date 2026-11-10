use utoipa::OpenApi;

#[expect(
    unused_imports,
    reason = "utoipa path macros require these generated symbols in scope"
)]
use crate::inbound::axum_router::{
    __path_check_action, __path_create_action, __path_delete_action, __path_execute_action,
    __path_get_action, __path_health, __path_list_actions, __path_list_history,
    __path_set_action_enabled, __path_set_appearance, __path_update_action,
    ScheduledActionResponse, SetScheduledActionEnabled,
};
#[expect(
    unused_imports,
    reason = "utoipa path macros require these generated symbols in scope"
)]
use crate::inbound::draft_router::__path_draft_routine;
#[expect(
    unused_imports,
    reason = "utoipa path macros require these generated symbols in scope"
)]
use crate::inbound::template_router::{
    __path_activate_template, __path_get_template, __path_share_template, __path_unshare_template,
};

use crate::domain::event_trigger::{
    ActionTrigger, EventFilter, EventFilters, EventName, GithubSelectorInput,
    PayloadConditionInput, PayloadScalar, PropertySelector,
};
use crate::domain::models::{
    ActionConfiguration, ActionConfigurationUpdate, ActionExecutionRecord, ActionKind,
    ExecutionResource, ExecutionResourceType, ExecutionResult, InProgressExecution, Schedule,
    ScheduledAction, ScheduledActionUpdate,
};
use ai_billing::inbound::admission::AiAdmissionErrorBody;
use model::response::EmptyResponse;
use model_entity::{AppearanceColor, AppearanceIcon, EntityAppearance};

#[derive(OpenApi)]
#[openapi(
    info(
        title = "scheduled_action",
        description = "API for managing scheduled actions",
        terms_of_service = "https://macro.com/terms",
    ),
    paths(
        crate::inbound::axum_router::health,
        crate::inbound::axum_router::list_actions,
        crate::inbound::axum_router::get_action,
        crate::inbound::axum_router::create_action,
        crate::inbound::axum_router::check_action,
        crate::inbound::axum_router::update_action,
        crate::inbound::axum_router::set_action_enabled,
        crate::inbound::axum_router::set_appearance,
        crate::inbound::axum_router::delete_action,
        crate::inbound::axum_router::execute_action,
        crate::inbound::axum_router::list_history,
        crate::inbound::axum_router::list_code_upgrades,
        crate::inbound::axum_router::catalog,
        crate::inbound::draft_router::draft_routine,
        crate::inbound::suggestion_router::list_suggestions,
        crate::inbound::suggestion_router::generate_suggestions,
        crate::inbound::suggestion_router::dismiss_suggestion,
        crate::inbound::suggestion_router::suggest_routine,
        crate::inbound::template_router::share_template,
        crate::inbound::template_router::get_template,
        crate::inbound::template_router::unshare_template,
        crate::inbound::template_router::activate_template,
    ),
    components(
        schemas(
            AiAdmissionErrorBody,
            crate::domain::catalog::CatalogEntry,
            routine_program::Surface,
            routine_program::NamedItemKind,
            crate::domain::suggestions::model::RoutineSuggestions,
            crate::domain::suggestions::model::RoutineSuggestion,
            crate::domain::suggestions::model::SuggestedPick,
            crate::domain::suggestions::model::SuggestionFrom,
            crate::domain::suggestions::model::GenerationStatus,
            crate::domain::suggestions::model::SuggestRequest,
            crate::domain::suggestions::model::SuggestOutcome,
            crate::inbound::draft_router::DraftRoutineRequest,
            crate::domain::drafts::DraftRequest,
            crate::domain::drafts::RoutineSoFar,
            crate::domain::drafts::StepKind,
            crate::domain::drafts::DraftContext,
            crate::domain::drafts::Draft,
            crate::domain::drafts::DraftedRoutine,
            crate::domain::drafts::DraftedStep,
            crate::domain::drafts::StepProblem,
            crate::domain::code_upgrade::CodeUpgrade,
            crate::domain::code_upgrade::UpgradeOutcome,
            ScheduledAction,
            EntityAppearance, AppearanceIcon, AppearanceColor,
            ScheduledActionResponse,
            ActionConfiguration,
            ActionConfigurationUpdate,
            crate::domain::models::RoutineCheck,
            crate::domain::models::CheckedStepProblems,
            crate::domain::models::CreatedItem,
            crate::inbound::axum_router::CheckRoutineRequest,
            ActionTrigger,
            crate::domain::event_trigger::RoutineTrigger,
            crate::domain::event_trigger::RoutineTriggers,
            EventFilter,
            EventFilters,
            EventName,
            GithubSelectorInput,
            PayloadConditionInput,
            PayloadScalar,
            PropertySelector,
            SetScheduledActionEnabled,
            Schedule,
            ActionKind,
            ExecutionResource,
            ExecutionResourceType,
            ExecutionResult,
            InProgressExecution,
            ActionExecutionRecord,
            ScheduledActionUpdate,
            EmptyResponse,
            crate::domain::templates::RoutineTemplate,
            crate::domain::templates::ShareRoutineTemplate,
            crate::domain::templates::TemplateVariable,
            crate::domain::templates::VariableFill,
            routine_program::AgentTask,
            routine_program::AgentSelection,
            routine_program::RoutineModelId,
            routine_program::CodeIdentity,
            routine_program::RoutineTask,
            routine_program::RoutineProgram,
            routine_program::Step,
            routine_program::CodeStep,
            routine_program::AgentStep,
            routine_program::Knob,
        ),
    ),
    tags(
        (name = "scheduled actions", description = "Scheduled action service")
    )
)]
pub struct ApiDoc;

#[cfg(test)]
mod test;
