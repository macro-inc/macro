//! Handler for assigning tasks to an initiative.

use axum::{Json, extract::State};
use entity_access::domain::models::{
    AccessError, EditAccessLevel, EntityAccessReceipt, EntityType,
};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::InitiativeAccessExtractor;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use model_error_response::ErrorResponse;

use super::{InitiativeIdParams, InitiativeRouterState};
use crate::domain::{
    models::{AssignTasksRequest, AssignTasksResponse, InitiativeError, TaskAssignment},
    ports::InitiativeService,
};

/// Assign tasks the caller can edit.
#[utoipa::path(
    put,
    tag = "initiative",
    operation_id = "assign_initiative_tasks",
    path = "/initiatives/{initiative_id}/tasks",
    params(InitiativeIdParams),
    request_body = AssignTasksRequest,
    responses(
        (status = 200, body = AssignTasksResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn assign_initiative_tasks_handler<S, Eas, Auth>(
    State(state): State<InitiativeRouterState<S, Eas, Auth>>,
    access: InitiativeAccessExtractor<EditAccessLevel, Eas, Auth>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(request): Json<AssignTasksRequest>,
) -> Result<Json<AssignTasksResponse>, InitiativeError>
where
    S: InitiativeService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let user_id = &user.authorization.user.macro_user_id;
    let user_org_id = user
        .authorization
        .user
        .user_context
        .organization_id
        .map(i64::from);

    let mut assignments = Vec::with_capacity(request.task_ids.len());
    for task_id in request.task_ids {
        let result = state
            .entity_access_service
            .generate_entity_access_receipt::<EditAccessLevel>(
                user_id,
                user_org_id,
                &task_id,
                EntityType::Document,
            )
            .await;
        assignments.push(task_assignment_from_access(task_id, result)?);
    }

    let response = state
        .service
        .assign_tasks(access.entity_access_receipt, assignments)
        .await?;
    Ok(Json(response))
}

fn task_assignment_from_access(
    task_id: String,
    result: Result<EntityAccessReceipt<EditAccessLevel>, AccessError>,
) -> Result<TaskAssignment, InitiativeError> {
    match result {
        Ok(_) => Ok(TaskAssignment::Candidate { task_id }),
        Err(AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_)) => {
            Ok(TaskAssignment::SkippedNoPermission { task_id })
        }
        Err(AccessError::NotFound(_) | AccessError::BadRequest(_)) => {
            Ok(TaskAssignment::NotFound { task_id })
        }
        Err(other) => Err(InitiativeError::Internal(
            rootcause::Report::new(other).into_dynamic(),
        )),
    }
}
