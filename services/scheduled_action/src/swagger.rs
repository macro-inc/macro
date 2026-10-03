use utoipa::OpenApi;

#[expect(
    unused_imports,
    reason = "utoipa path macros require these generated symbols in scope"
)]
use crate::inbound::axum_router::{
    __path_create_action, __path_delete_action, __path_execute_action, __path_health,
    __path_list_actions, __path_list_history, __path_set_action_enabled, __path_update_action,
    ScheduledActionResponse, SetScheduledActionEnabled,
};

use crate::domain::event_trigger::{ActionTrigger, EventFilter, EventFilters, EventName};
use crate::domain::models::{
    ActionConfiguration, ActionConfigurationUpdate, ActionExecutionRecord, ActionKind, AgentTask,
    AgentTaskAgent, CreateScheduledAction, ExecutionResource, ExecutionResourceType,
    ExecutionResult, InProgressExecution, LegacyActionConfiguration, RoutineModelId, Schedule,
    ScheduledAction, ScheduledActionUpdate, UpdateScheduledAction,
};
use model::response::EmptyResponse;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "scheduled_action",
        description = "API for managing scheduled actions",
        terms_of_service = "https://macro.com/terms",
    ),
    paths(
        crate::inbound::routine_sharing::list,
        crate::inbound::routine_sharing::read,
        crate::inbound::routine_sharing::share,
        crate::inbound::routine_sharing::history,
        crate::inbound::axum_router::health,
        crate::inbound::axum_router::list_actions,
        crate::inbound::axum_router::create_action,
        crate::inbound::axum_router::update_action,
        crate::inbound::axum_router::set_action_enabled,
        crate::inbound::axum_router::delete_action,
        crate::inbound::axum_router::execute_action,
        crate::inbound::axum_router::list_history,
    ),
    components(
        schemas(
            ScheduledAction,
            ScheduledActionResponse,
            ActionConfiguration,
            ActionConfigurationUpdate,
            LegacyActionConfiguration,
            ActionTrigger,
            EventFilter,
            EventFilters,
            EventName,
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
        ),
    ),
    tags(
        (name = "scheduled actions", description = "Scheduled action service")
    )
)]
pub struct ApiDoc;
