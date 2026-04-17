use utoipa::OpenApi;

#[allow(
    unused_imports,
    reason = "utoipa path macros require these generated symbols in scope"
)]
use crate::inbound::axum_router::{
    __path_create_action, __path_delete_action, __path_execute_action, __path_health,
    __path_list_actions, __path_list_history, __path_update_action,
};

use crate::domain::models::{
    ActionExecutionRecord, ActionKind, AgentTask, CreateScheduledAction, InProgressExecution,
    Schedule, ScheduledAction, ScheduledActionUpdate, UpdateScheduledAction,
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
        crate::inbound::axum_router::health,
        crate::inbound::axum_router::list_actions,
        crate::inbound::axum_router::create_action,
        crate::inbound::axum_router::update_action,
        crate::inbound::axum_router::delete_action,
        crate::inbound::axum_router::execute_action,
        crate::inbound::axum_router::list_history,
    ),
    components(
        schemas(
            ScheduledAction,
            CreateScheduledAction,
            UpdateScheduledAction,
            Schedule,
            ActionKind,
            AgentTask,
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
