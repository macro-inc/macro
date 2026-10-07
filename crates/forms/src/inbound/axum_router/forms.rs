//! Transport for reading and changing forms and for the forms catalog.

use axum::Json;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use databases::domain::receipt::database_receipt;
use entity_access::domain::models::{EditAccessLevel, OwnerAccessLevel, ViewAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::MacroAuthorizationService;
use models_databases::DatabaseId;
use models_forms::{
    CreateForm, Form, FormCollaboration, FormDetail, FormErrorResponse, FormLayout, FormSource,
    ListedForm, UpdateForm,
};
use serde::Deserialize;

use super::access::{FormReceipt, SignedIn};
use super::{FormsApiError, FormsRouterState, viewer_of};
use crate::domain::ports::{CreateFormCommand, CreateSource, FormsService};

/// Which database's forms to list.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query, rename_all = "camelCase")]
pub struct ListFormsQuery {
    /// The database.
    #[param(value_type = Uuid)]
    pub database_id: DatabaseId,
}

/// Create a form owned by the caller: over a new database named like it, or
/// over an existing table of a database the caller owns. Database Edit is
/// not enough to attach a form: the form's editors gain Edit on the
/// database through it.
#[utoipa::path(post, tag = "forms", operation_id = "create_form", path = "/forms",
    request_body = CreateForm,
    responses((status = 201, body = FormDetail), (status = 400, body = FormErrorResponse),
        (status = 401, body = FormErrorResponse), (status = 403, body = FormErrorResponse),
        (status = 404, body = FormErrorResponse), (status = 500, body = FormErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn create_form_handler<Service, EntityAccess, Authorization>(
    State(state): State<FormsRouterState<Service, EntityAccess, Authorization>>,
    user: SignedIn<Authorization>,
    Json(request): Json<CreateForm>,
) -> Result<(StatusCode, Json<FormDetail>), FormsApiError>
where
    Service: FormsService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let creator = viewer_of(&user);
    let source = match request.source {
        FormSource::New => CreateSource::NewDatabase,
        FormSource::Table {
            database_id,
            table_id,
        } => CreateSource::Table {
            receipt: database_receipt::<OwnerAccessLevel, _>(
                state.entity_access_service.as_ref(),
                &creator,
                database_id,
            )
            .await?,
            table_id,
        },
    };
    let detail = state
        .service
        .create_form(
            creator,
            CreateFormCommand {
                name: request.name,
                source,
            },
        )
        .await?;
    Ok((StatusCode::CREATED, Json(detail)))
}

/// The live forms over a database the caller can see, for the grid's chip
/// and the delete-table confirmation.
#[utoipa::path(get, tag = "forms", operation_id = "list_forms", path = "/forms",
    params(ListFormsQuery),
    responses((status = 200, body = Vec<Form>), (status = 401, body = FormErrorResponse),
        (status = 403, body = FormErrorResponse), (status = 500, body = FormErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn list_forms_handler<Service, EntityAccess, Authorization>(
    State(state): State<FormsRouterState<Service, EntityAccess, Authorization>>,
    user: SignedIn<Authorization>,
    Query(query): Query<ListFormsQuery>,
) -> Result<Json<Vec<Form>>, FormsApiError>
where
    Service: FormsService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let receipt = database_receipt::<ViewAccessLevel, _>(
        state.entity_access_service.as_ref(),
        &viewer_of(&user),
        query.database_id,
    )
    .await?;
    Ok(Json(state.service.forms_for_database(receipt).await?))
}

/// Every live form the caller holds a grant on, newest first, with their
/// level: what Drive and Quick Access list. Public forms reached only by
/// their link are not listed.
#[utoipa::path(get, tag = "forms", operation_id = "list_accessible_forms", path = "/forms/accessible",
    responses((status = 200, body = Vec<ListedForm>), (status = 401, body = FormErrorResponse),
        (status = 500, body = FormErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn list_accessible_forms_handler<Service, EntityAccess, Authorization>(
    State(state): State<FormsRouterState<Service, EntityAccess, Authorization>>,
    user: SignedIn<Authorization>,
) -> Result<Json<Vec<ListedForm>>, FormsApiError>
where
    Service: FormsService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    Ok(Json(
        state.service.accessible_forms(viewer_of(&user)).await?,
    ))
}

/// A form with its layout, each question joined with its column's title,
/// type and options. Never rows. Readable by anyone when the form is public.
#[utoipa::path(get, tag = "forms", operation_id = "get_form", path = "/forms/{id}",
    params(("id" = Uuid, Path, description = "Form id")),
    responses((status = 200, body = FormDetail), (status = 401, body = FormErrorResponse), (status = 403, body = FormErrorResponse),
        (status = 404, body = FormErrorResponse), (status = 500, body = FormErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn get_form_handler<Service, EntityAccess, Authorization>(
    access: FormReceipt<ViewAccessLevel, EntityAccess, Authorization>,
    State(state): State<FormsRouterState<Service, EntityAccess, Authorization>>,
) -> Result<Json<FormDetail>, FormsApiError>
where
    Service: FormsService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    Ok(Json(state.service.get_form(access.receipt).await?))
}

/// Change a form's facts. The description and confirmation message take
/// edit; who responds, open or closed, the closing time and tallies take
/// its owner.
#[utoipa::path(patch, tag = "forms", operation_id = "update_form", path = "/forms/{id}",
    params(("id" = Uuid, Path, description = "Form id")), request_body = UpdateForm,
    responses((status = 200, body = Form), (status = 400, body = FormErrorResponse),
        (status = 401, body = FormErrorResponse), (status = 403, body = FormErrorResponse),
        (status = 404, body = FormErrorResponse), (status = 500, body = FormErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn update_form_handler<Service, EntityAccess, Authorization>(
    access: FormReceipt<EditAccessLevel, EntityAccess, Authorization>,
    State(state): State<FormsRouterState<Service, EntityAccess, Authorization>>,
    Json(update): Json<UpdateForm>,
) -> Result<Json<Form>, FormsApiError>
where
    Service: FormsService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    Ok(Json(
        state.service.update_form(access.receipt, update).await?,
    ))
}

/// Save a validated replacement in the shared layout and report publication.
/// A 200 response with `publicationError` means the draft is saved, while
/// respondents still see `detail`. Retrying collaboration retries publication.
#[utoipa::path(put, tag = "forms", operation_id = "put_form_layout", path = "/forms/{id}/layout",
    params(("id" = Uuid, Path, description = "Form id")), request_body = FormLayout,
    responses((status = 200, body = FormCollaboration), (status = 400, body = FormErrorResponse),
        (status = 401, body = FormErrorResponse), (status = 403, body = FormErrorResponse), (status = 404, body = FormErrorResponse),
        (status = 409, body = FormErrorResponse), (status = 500, body = FormErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn put_form_layout_handler<Service, EntityAccess, Authorization>(
    access: FormReceipt<EditAccessLevel, EntityAccess, Authorization>,
    State(state): State<FormsRouterState<Service, EntityAccess, Authorization>>,
    Json(layout): Json<FormLayout>,
) -> Result<Json<FormCollaboration>, FormsApiError>
where
    Service: FormsService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    Ok(Json(
        state.service.put_layout(access.receipt, layout).await?,
    ))
}

/// Open the editor-only collaborative layout, or publish its latest valid
/// revision. Content stays in the existing collaboration surface.
#[utoipa::path(post, tag = "forms", operation_id = "collaborate_form", path = "/forms/{id}/collaboration",
    params(("id" = Uuid, Path, description = "Form id")),
    responses((status = 200, body = FormCollaboration), (status = 401, body = FormErrorResponse),
        (status = 403, body = FormErrorResponse), (status = 404, body = FormErrorResponse),
        (status = 409, body = FormErrorResponse), (status = 500, body = FormErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn collaborate_form_handler<Service, EntityAccess, Authorization>(
    access: FormReceipt<EditAccessLevel, EntityAccess, Authorization>,
    State(state): State<FormsRouterState<Service, EntityAccess, Authorization>>,
) -> Result<Json<FormCollaboration>, FormsApiError>
where
    Service: FormsService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    Ok(Json(state.service.collaborate_form(access.receipt).await?))
}
