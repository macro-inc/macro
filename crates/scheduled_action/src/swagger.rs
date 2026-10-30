use utoipa::OpenApi;

#[expect(
    unused_imports,
    reason = "utoipa path macros require these generated symbols in scope"
)]
use crate::inbound::axum_router::{
    __path_create_action, __path_delete_action, __path_execute_action, __path_get_action,
    __path_health, __path_list_actions, __path_list_history, __path_set_action_enabled,
    __path_update_action, ScheduledActionResponse, SetScheduledActionEnabled,
};
#[expect(
    unused_imports,
    reason = "utoipa path macros require these generated symbols in scope"
)]
use crate::inbound::template_router::{
    __path_activate_template, __path_get_template, __path_share_template, __path_unshare_template,
};

use crate::domain::event_trigger::{
    ActionTrigger, EventFilter, EventFilters, EventName, GithubSelectorInput,
    PayloadConditionInput, PayloadScalar,
};
use crate::domain::models::{
    ActionConfiguration, ActionConfigurationUpdate, ActionExecutionRecord, ActionKind, AgentTask,
    AgentTaskAgent, CreateScheduledAction, ExecutionResource, ExecutionResourceType,
    ExecutionResult, InProgressExecution, LegacyActionConfiguration, RoutineModelId, Schedule,
    ScheduledAction, ScheduledActionUpdate, UpdateScheduledAction,
};
use ai_billing::inbound::admission::AiAdmissionErrorBody;
use model::response::EmptyResponse;

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
        crate::inbound::axum_router::update_action,
        crate::inbound::axum_router::set_action_enabled,
        crate::inbound::axum_router::delete_action,
        crate::inbound::axum_router::execute_action,
        crate::inbound::axum_router::list_history,
        crate::inbound::template_router::share_template,
        crate::inbound::template_router::get_template,
        crate::inbound::template_router::unshare_template,
        crate::inbound::template_router::activate_template,
    ),
    components(
        schemas(
            AiAdmissionErrorBody,
            ScheduledAction,
            ScheduledActionResponse,
            ActionConfiguration,
            ActionConfigurationUpdate,
            LegacyActionConfiguration,
            ActionTrigger,
            crate::domain::event_trigger::RoutineTrigger,
            crate::domain::event_trigger::RoutineTriggers,
            EventFilter,
            EventFilters,
            EventName,
            GithubSelectorInput,
            PayloadConditionInput,
            PayloadScalar,
            CreateScheduledAction,
            UpdateScheduledAction,
            SetScheduledActionEnabled,
            Schedule,
            ActionKind,
            AgentTask,
            AgentTaskAgent,
            RoutineModelId,
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
        ),
    ),
    tags(
        (name = "scheduled actions", description = "Scheduled action service")
    )
)]
pub struct ApiDoc;
