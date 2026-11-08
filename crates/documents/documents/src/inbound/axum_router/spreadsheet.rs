//! Create, read, calculate and edit native spreadsheets over HTTP, through the
//! same engine as the ReadSpreadsheet, CalculateSpreadsheet and
//! EditSpreadsheet tools, and edit them by instructions through a writer model.
use super::DocumentRouterState;
use super::ai_edit::{
    DocumentAiEditFailed, DocumentAiEditFailedCode, DocumentAiEditRefused,
    DocumentAiEditRefusedCode,
};
use crate::domain::{
    create::NewDocumentMetadata,
    models::DocumentError,
    ports::{DocumentService, create::DocumentCreationService},
    spreadsheet::{
        SpreadsheetAiEditError, SpreadsheetAiEdited, SpreadsheetCaller, SpreadsheetError,
        SpreadsheetFormula, SpreadsheetOperation, SpreadsheetOverride, SpreadsheetRequest,
        SpreadsheetResponse,
    },
};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use entity_access::{
    domain::{
        models::{EditAccessLevel, ViewAccessLevel},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::{DocumentAccessExtractor, ProjectBodyAccessLevelExtractorV2},
};
use entity_registry::CreationPrincipalExtractor;
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;

/// Request to create a blank native spreadsheet.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateSpreadsheetRequest {
    /// Spreadsheet name.
    pub document_name: String,
    /// Optional parent project.
    pub project_id: Option<uuid::Uuid>,
}

/// A created native spreadsheet.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateSpreadsheetResponse {
    /// The new spreadsheet's document ID.
    pub document_id: String,
}

/// What to read from a workbook.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadSpreadsheetRequest {
    /// Stable sheet ID or exact name; defaults to the first sheet.
    #[serde(default)]
    pub sheet_id: Option<String>,
    /// A1 ranges such as A1:F20. Omit for the workbook overview and samples.
    #[serde(default)]
    pub ranges: Option<Vec<String>>,
    /// Include cell formatting.
    #[serde(default)]
    pub include_styles: Option<bool>,
}

/// Scratch formulas to evaluate against a workbook, without writing anything.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalculateSpreadsheetRequest {
    /// Sheet for unqualified references; defaults to the first sheet.
    #[serde(default)]
    pub sheet_id: Option<String>,
    /// At most 20 formulas beginning with =.
    pub formulas: Vec<SpreadsheetFormula>,
    /// Hypothetical cell inputs, never saved.
    #[serde(default)]
    pub overrides: Option<Vec<SpreadsheetOverride>>,
}

/// One atomic batch of operations against the revision it was planned on.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditSpreadsheetRequest {
    /// The revision a read returned; a changed workbook rejects the batch.
    pub expected_revision: String,
    /// Between 1 and 25 operations, validated and saved together.
    pub operations: Vec<SpreadsheetOperation>,
}

impl IntoResponse for SpreadsheetError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            SpreadsheetError::Document(error) => return error.into_response(),
            SpreadsheetError::NotSpreadsheet => (
                StatusCode::BAD_REQUEST,
                SpreadsheetError::NotSpreadsheet.to_string(),
            ),
            SpreadsheetError::Invalid(message) => (StatusCode::BAD_REQUEST, message),
            SpreadsheetError::RevisionConflict(message) => (StatusCode::CONFLICT, message),
            SpreadsheetError::Failed(error) => {
                tracing::error!(error = ?error, "spreadsheet operation failed");
                (
                    StatusCode::BAD_GATEWAY,
                    "The spreadsheet operation failed, and an edit may have been saved. Read the workbook before retrying.".to_owned(),
                )
            }
        };
        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

/// What to change in a workbook, in words.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
pub struct SpreadsheetAiEditRequest {
    /// Natural-language instructions. Name the sheet and the cells, columns
    /// or table to change, describe the outcome, and say what must stay.
    #[schema(min_length = 1)]
    pub instructions: String,
}

impl IntoResponse for SpreadsheetAiEditError {
    fn into_response(self) -> Response {
        match self {
            SpreadsheetAiEditError::Spreadsheet(error) => error.into_response(),
            SpreadsheetAiEditError::Admission(error) => error.into_response(),
            SpreadsheetAiEditError::Refused(reason) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(DocumentAiEditRefused {
                    error: DocumentAiEditRefusedCode::EditRefused,
                    reason,
                }),
            )
                .into_response(),
            SpreadsheetAiEditError::NotSaved(error) => {
                tracing::error!(error = %error, "spreadsheet ai edit failed before saving");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "The edit failed before saving; nothing changed. Retry it.".into(),
                    }),
                )
                    .into_response()
            }
            SpreadsheetAiEditError::OutcomeUnknown(error) => {
                tracing::error!(error = ?error, "spreadsheet ai edit outcome unknown");
                (
                    StatusCode::BAD_GATEWAY,
                    Json(DocumentAiEditFailed {
                        error: DocumentAiEditFailedCode::EditFailed,
                        message: "The edit may have been saved; read the workbook before retrying."
                            .to_string(),
                    }),
                )
                    .into_response()
            }
        }
    }
}

fn body<T>(body: Result<Json<T>, JsonRejection>) -> Result<T, SpreadsheetError> {
    body.map(|Json(body)| body)
        .map_err(|rejection| DocumentError::BadRequest(rejection.body_text()).into())
}

/// Create a blank native spreadsheet, ready to read and edit.
#[utoipa::path(
    post,
    tag = "document",
    path = "/documents/create_spreadsheet",
    operation_id = "create_spreadsheet",
    request_body = CreateSpreadsheetRequest,
    responses(
        (status = 200, body = CreateSpreadsheetResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, description = "Project edit access denied"),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn create_spreadsheet_handler<
    T: DocumentService + DocumentCreationService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    project: ProjectBodyAccessLevelExtractorV2<
        permissions_types::share_permission::access_level::EditAccessLevel,
        CreateSpreadsheetRequest,
        Svc,
        Auth,
    >,
) -> Result<Json<CreateSpreadsheetResponse>, DocumentError> {
    let request = project.into_inner();
    let mut metadata = NewDocumentMetadata::builder(request.document_name);
    if let Some(project_id) = request.project_id {
        metadata = metadata.project_id(project_id);
    }

    let created = state
        .creator
        .create_spreadsheet(&principal, metadata.build())
        .await?;
    Ok(Json(CreateSpreadsheetResponse {
        document_id: created.document_id().to_string(),
    }))
}

/// Read a native spreadsheet with view access: every sheet's summary, and the
/// cells of the requested ranges. Returns the revision an edit needs.
#[utoipa::path(
    post,
    tag = "document",
    path = "/documents/{document_id}/spreadsheet/read",
    operation_id = "read_spreadsheet",
    params(("document_id" = String, Path, description = "Document identity")),
    request_body = ReadSpreadsheetRequest,
    responses(
        (status = 200, body = SpreadsheetResponse),
        (status = 400, description = "Not a native spreadsheet, or an invalid sheet or range", body = ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document access denied"),
        (status = 404, description = "Document not found"),
        (status = 502, description = "The spreadsheet engine failed", body = ErrorResponse)
    )
)]
pub async fn read_spreadsheet_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    request: Result<Json<ReadSpreadsheetRequest>, JsonRejection>,
) -> Result<Json<SpreadsheetResponse>, SpreadsheetError> {
    let request = body(request)?;
    state
        .spreadsheet
        .read(
            access.entity_access_receipt,
            SpreadsheetCaller::Receipt,
            SpreadsheetRequest::Read {
                sheet_id: request.sheet_id,
                ranges: request.ranges,
                include_styles: request.include_styles,
            },
        )
        .await
        .map(Json)
}

/// Evaluate scratch formulas against a native spreadsheet with view access,
/// optionally with hypothetical inputs. Nothing is saved.
#[utoipa::path(
    post,
    tag = "document",
    path = "/documents/{document_id}/spreadsheet/calculate",
    operation_id = "calculate_spreadsheet",
    params(("document_id" = String, Path, description = "Document identity")),
    request_body = CalculateSpreadsheetRequest,
    responses(
        (status = 200, body = SpreadsheetResponse),
        (status = 400, description = "Not a native spreadsheet, or invalid formulas or overrides", body = ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document access denied"),
        (status = 404, description = "Document not found"),
        (status = 502, description = "The spreadsheet engine failed", body = ErrorResponse)
    )
)]
pub async fn calculate_spreadsheet_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    request: Result<Json<CalculateSpreadsheetRequest>, JsonRejection>,
) -> Result<Json<SpreadsheetResponse>, SpreadsheetError> {
    let request = body(request)?;
    state
        .spreadsheet
        .read(
            access.entity_access_receipt,
            SpreadsheetCaller::Receipt,
            SpreadsheetRequest::Calculate {
                sheet_id: request.sheet_id,
                formulas: request.formulas,
                overrides: request.overrides,
            },
        )
        .await
        .map(Json)
}

/// Apply one atomic batch of operations to a native spreadsheet with edit
/// access. Every operation validates before anything is saved; a workbook that
/// changed since `expectedRevision` rejects the batch with 409.
#[utoipa::path(
    post,
    tag = "document",
    path = "/documents/{document_id}/spreadsheet/edits",
    operation_id = "edit_spreadsheet",
    params(("document_id" = String, Path, description = "Document identity")),
    request_body = EditSpreadsheetRequest,
    responses(
        (status = 200, body = SpreadsheetResponse),
        (status = 400, description = "Not a native spreadsheet, or an invalid batch; nothing changed", body = ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document edit access denied"),
        (status = 404, description = "Document not found"),
        (status = 409, description = "The workbook changed since expectedRevision; nothing changed", body = ErrorResponse),
        (status = 502, description = "The engine failed and the batch may have been saved", body = ErrorResponse)
    )
)]
pub async fn edit_spreadsheet_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<EditAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    request: Result<Json<EditSpreadsheetRequest>, JsonRejection>,
) -> Result<Json<SpreadsheetResponse>, SpreadsheetError> {
    let request = body(request)?;
    state
        .spreadsheet
        .edit(
            access.entity_access_receipt,
            SpreadsheetCaller::Receipt,
            request.expected_revision,
            request.operations,
        )
        .await
        .map(Json)
}

/// Edit a native spreadsheet by instructions with the caller's edit access:
/// a writer model reads the workbook and saves one atomic batch, with AI
/// admission and billing. A workbook changed while it worked saves nothing
/// and answers 409.
///
/// A client that disconnects drops the worker request, which cancels the
/// edit before its save.
#[utoipa::path(
    post,
    tag = "document",
    path = "/documents/{document_id}/spreadsheet/ai-edit",
    operation_id = "edit_spreadsheet_with_ai",
    params(("document_id" = String, Path, description = "Document identity")),
    request_body = SpreadsheetAiEditRequest,
    responses(
        (status = 200, body = SpreadsheetAiEdited),
        (status = 400, description = "Not a native spreadsheet, or empty instructions", body = ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 402, description = "AI allowance exhausted", body = ai_billing::inbound::admission::AiAdmissionErrorBody),
        (status = 403, description = "Document edit access denied"),
        (status = 404, description = "Document not found"),
        (status = 409, description = "The workbook changed while the edit ran; nothing changed", body = ErrorResponse),
        (status = 422, description = "The writer could not do the edit; nothing changed", body = DocumentAiEditRefused),
        (status = 500, description = "The edit failed before saving; nothing changed", body = ErrorResponse),
        (status = 502, description = "The edit may have been saved", body = DocumentAiEditFailed),
        (status = 503, description = "AI usage validation unavailable; retry later", body = ai_billing::inbound::admission::AiAdmissionErrorBody)
    )
)]
pub async fn ai_edit_spreadsheet_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<EditAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    request: Result<Json<SpreadsheetAiEditRequest>, JsonRejection>,
) -> Result<Json<SpreadsheetAiEdited>, SpreadsheetAiEditError> {
    let request = body(request)?;
    state
        .spreadsheet_ai_edit
        .edit(access.entity_access_receipt, &request.instructions)
        .await
        .map(Json)
}
