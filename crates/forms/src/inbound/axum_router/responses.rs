//! Transport for responding and for what is read of the responses.

use axum::Json;
use axum::extract::State;
use entity_access::domain::models::{EditAccessLevel, ViewAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::MacroAuthorizationService;
use models_forms::{
    FormErrorResponse, FormTally, MyResponse, ResponseSummary, Submission, SubmissionOutcome,
};

use super::access::FormReceipt;
use super::{FormsApiError, FormsRouterState};
use crate::domain::ports::FormsService;

/// Respond to a form. A gate that stops the response answers `stopped` and
/// writes nothing to the table. A public form takes anonymous responses.
#[utoipa::path(post, tag = "forms", operation_id = "submit_form_response", path = "/forms/{id}/responses",
    params(("id" = Uuid, Path, description = "Form id")), request_body = Submission,
    responses((status = 200, body = SubmissionOutcome), (status = 400, body = FormErrorResponse),
        (status = 401, body = FormErrorResponse), (status = 403, body = FormErrorResponse), (status = 404, body = FormErrorResponse),
        (status = 409, body = FormErrorResponse), (status = 500, body = FormErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn submit_form_response_handler<Service, EntityAccess, Authorization>(
    access: FormReceipt<ViewAccessLevel, EntityAccess, Authorization>,
    State(state): State<FormsRouterState<Service, EntityAccess, Authorization>>,
    Json(submission): Json<Submission>,
) -> Result<Json<SubmissionOutcome>, FormsApiError>
where
    Service: FormsService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .submit_response(access.receipt, submission)
            .await?,
    ))
}

/// The signed-in caller's own response, with the row's current cells.
#[utoipa::path(get, tag = "forms", operation_id = "get_my_form_response", path = "/forms/{id}/responses/mine",
    params(("id" = Uuid, Path, description = "Form id")),
    responses((status = 200, body = MyResponse), (status = 401, body = FormErrorResponse), (status = 403, body = FormErrorResponse),
        (status = 404, body = FormErrorResponse), (status = 500, body = FormErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn get_my_form_response_handler<Service, EntityAccess, Authorization>(
    access: FormReceipt<ViewAccessLevel, EntityAccess, Authorization>,
    State(state): State<FormsRouterState<Service, EntityAccess, Authorization>>,
) -> Result<Json<MyResponse>, FormsApiError>
where
    Service: FormsService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    Ok(Json(state.service.my_response(access.receipt).await?))
}

/// Replace the signed-in caller's answers while the form is open. A gate
/// that stops the edit leaves the saved response as it was.
#[utoipa::path(put, tag = "forms", operation_id = "edit_my_form_response", path = "/forms/{id}/responses/mine",
    params(("id" = Uuid, Path, description = "Form id")), request_body = Submission,
    responses((status = 200, body = SubmissionOutcome), (status = 400, body = FormErrorResponse),
        (status = 401, body = FormErrorResponse), (status = 403, body = FormErrorResponse), (status = 404, body = FormErrorResponse),
        (status = 409, body = FormErrorResponse), (status = 500, body = FormErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn edit_my_form_response_handler<Service, EntityAccess, Authorization>(
    access: FormReceipt<ViewAccessLevel, EntityAccess, Authorization>,
    State(state): State<FormsRouterState<Service, EntityAccess, Authorization>>,
    Json(submission): Json<Submission>,
) -> Result<Json<SubmissionOutcome>, FormsApiError>
where
    Service: FormsService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .edit_my_response(access.receipt, submission)
            .await?,
    ))
}

/// Response counts for the form's editors.
#[utoipa::path(get, tag = "forms", operation_id = "get_form_response_summary", path = "/forms/{id}/responses/summary",
    params(("id" = Uuid, Path, description = "Form id")),
    responses((status = 200, body = ResponseSummary), (status = 401, body = FormErrorResponse), (status = 403, body = FormErrorResponse),
        (status = 404, body = FormErrorResponse), (status = 409, body = FormErrorResponse),
        (status = 500, body = FormErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn get_form_response_summary_handler<Service, EntityAccess, Authorization>(
    access: FormReceipt<EditAccessLevel, EntityAccess, Authorization>,
    State(state): State<FormsRouterState<Service, EntityAccess, Authorization>>,
) -> Result<Json<ResponseSummary>, FormsApiError>
where
    Service: FormsService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    Ok(Json(state.service.response_summary(access.receipt).await?))
}

/// Option counts of the form's choice questions: for respondents when the
/// owner shows them, for editors always.
#[utoipa::path(get, tag = "forms", operation_id = "get_form_tally", path = "/forms/{id}/tally",
    params(("id" = Uuid, Path, description = "Form id")),
    responses((status = 200, body = FormTally), (status = 401, body = FormErrorResponse),
        (status = 403, body = FormErrorResponse), (status = 404, body = FormErrorResponse),
        (status = 409, body = FormErrorResponse), (status = 500, body = FormErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn get_form_tally_handler<Service, EntityAccess, Authorization>(
    access: FormReceipt<ViewAccessLevel, EntityAccess, Authorization>,
    State(state): State<FormsRouterState<Service, EntityAccess, Authorization>>,
) -> Result<Json<FormTally>, FormsApiError>
where
    Service: FormsService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    Ok(Json(state.service.tally(access.receipt).await?))
}
