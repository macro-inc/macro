//! Read, render and edit a canvas over HTTP for SDK callers, through the same
//! `CanvasService` workflows as the ReadCanvas, RenderCanvas, ApplyCanvasEdits
//! and EditCanvas tools.
//!
//! A client that disconnects aborts the call: axum drops the handler's future,
//! which drops the in-flight worker request, and the worker aborts on its
//! request signal. Steps already acknowledged stay.
use super::{CanvasRouteDeps, DocumentRouterState};
use crate::domain::{
    canvas::{
        CanvasBounds, CanvasCaller, CanvasError, CanvasReadFormat, CanvasRenderObject,
        CanvasRequest, CanvasService, CanvasTextLayout, CanvasUnavailable,
    },
    models::DocumentError,
    ports::DocumentService,
};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use entity_access::{
    domain::{
        models::{EditAccessLevel, EntityAccessReceipt, RequiredPermission, ViewAccessLevel},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::DocumentAccessExtractor,
};
use macro_authorization::MacroAuthorizationService;
use std::collections::BTreeMap;

/// Which part of the scene to read.
#[derive(Debug, Default, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasSceneRequest {
    /// Stable item ids to read, at most 100; omit for the whole scene, up to
    /// 300 items.
    pub item_ids: Option<Vec<String>>,
    /// `scene` (default) for exact geometry and data, `overview` for a compact
    /// approximate graph with an exact id legend.
    pub format: Option<CanvasReadFormat>,
}

/// The live scene at one revision.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CanvasScene {
    /// The scene's immutable revision; pass it as `expectedRevision` to edit.
    pub revision: String,
    /// The scene: `rootId`, `totalItems`, `matchedItems`, `truncated` and
    /// `items` with stable ids, transforms, world bounds, shapes and text.
    #[schema(value_type = Object)]
    pub scene: serde_json::Value,
}

/// What to render.
#[derive(Debug, Default, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasRenderRequest {
    /// Items to fit the image to, at most 100.
    pub item_ids: Option<Vec<String>>,
    /// A world-space rectangle; overrides `itemIds`.
    pub crop: Option<CanvasBounds>,
}

/// A PNG of the canvas, stored as a static file owned by the caller.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CanvasRendered {
    /// Static file id of the PNG.
    pub file_id: String,
    /// Permanent URL of the PNG.
    pub url: String,
    /// Revision of the scene the image shows.
    pub revision: String,
    /// World bounds the image covers; pixels map linearly onto them.
    pub crop: CanvasBounds,
    /// Image width in pixels.
    pub width: u32,
    /// Image height in pixels.
    pub height: u32,
    /// Items in the image, with their world bounds.
    pub objects: Vec<CanvasRenderObject>,
    /// Referenced content the renderer could not show, and why.
    pub unavailable: Vec<CanvasUnavailable>,
    /// Rendered text bounds and whether text overflows its frame.
    pub text_layout: Vec<CanvasTextLayout>,
}

/// One batch of CanvasEditor code to apply against a revision.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasEditsRequest {
    /// The revision the batch was planned against, from a fresh scene read.
    pub expected_revision: String,
    /// JavaScript using `editor` (and `snippets`), as ApplyCanvasEdits runs it.
    #[schema(min_length = 1)]
    pub code: String,
    /// Plain text values the code reads as `snippets.<key>`.
    pub snippets: Option<BTreeMap<String, String>>,
}

/// A committed batch.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CanvasEdited {
    /// Operations the live scene acknowledged.
    pub operations_applied: u64,
    /// The scene's revision after the batch.
    pub revision: String,
    /// The scene after the batch, with `textLayout` for measured text.
    #[schema(value_type = Object)]
    pub scene: serde_json::Value,
    /// What happened, in words.
    pub summary: String,
}

/// What to change, in words.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasAiEditRequest {
    /// Natural-language instructions, naming items by id where they exist.
    #[schema(min_length = 1)]
    pub instructions: String,
}

/// A completed edit by instructions.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CanvasAiEdited {
    /// Operations the live scene acknowledged.
    pub operations_applied: u64,
    /// What the editor did, in words.
    pub summary: String,
    /// What the editor needs to know to finish, when it applied part of the
    /// edit and stopped; the applied part stays.
    pub clarification: Option<String>,
}

/// Error code of a canvas call.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CanvasErrorCode {
    /// The request or document does not fit; nothing ran.
    InvalidRequest,
    /// The scene changed since `expectedRevision`; nothing was committed.
    RevisionConflict,
    /// The batch failed before it committed; nothing changed.
    EditRejected,
    /// The editor could not do the edit as instructed; nothing changed.
    EditRefused,
    /// The call failed after it started; a write may have partly applied.
    EditFailed,
    /// The call could not start.
    Internal,
}

/// Why a canvas call failed.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct CanvasErrorBody {
    /// What kind of failure.
    pub error: CanvasErrorCode,
    /// What happened and what to do next.
    pub message: String,
}

/// A canvas call's error response; `write` says whether the call could have
/// changed the scene, which decides what a failure tells the caller.
struct CanvasFailure {
    error: CanvasError,
    write: bool,
}

fn body(status: StatusCode, error: CanvasErrorCode, message: String) -> Response {
    (status, Json(CanvasErrorBody { error, message })).into_response()
}

impl IntoResponse for CanvasFailure {
    fn into_response(self) -> Response {
        match self.error {
            CanvasError::Invalid(message) => body(
                StatusCode::BAD_REQUEST,
                CanvasErrorCode::InvalidRequest,
                message,
            ),
            CanvasError::Admission(error) => error.into_response(),
            CanvasError::Conflict(message) => body(
                StatusCode::CONFLICT,
                CanvasErrorCode::RevisionConflict,
                message,
            ),
            CanvasError::Rejected(message) => body(
                StatusCode::UNPROCESSABLE_ENTITY,
                CanvasErrorCode::EditRejected,
                message,
            ),
            CanvasError::Internal(error) => {
                tracing::error!(error = ?error, "canvas call could not start");
                body(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    CanvasErrorCode::Internal,
                    "The canvas call could not start; nothing changed. Retry later.".to_owned(),
                )
            }
            CanvasError::Failed(error) => {
                tracing::error!(error = ?error, write = self.write, "canvas call failed");
                body(
                    StatusCode::BAD_GATEWAY,
                    CanvasErrorCode::EditFailed,
                    if self.write {
                        "The edit failed after it started and may have partly applied; read the scene before retrying."
                    } else {
                        "The canvas could not be read; retry."
                    }
                    .to_owned(),
                )
            }
        }
    }
}

fn read_failure(error: CanvasError) -> Response {
    CanvasFailure {
        error,
        write: false,
    }
    .into_response()
}

fn write_failure(error: CanvasError) -> Response {
    CanvasFailure { error, write: true }.into_response()
}

fn bad_request(rejection: &JsonRejection) -> Response {
    read_failure(CanvasError::Invalid(rejection.body_text()))
}

/// The caller and a `CanvasService` scoped to their artifacts rollout.
async fn canvas_service<T: DocumentService, A: RequiredPermission>(
    service: &std::sync::Arc<T>,
    canvas: &CanvasRouteDeps,
    jwt_secret: &str,
    receipt: &EntityAccessReceipt<A>,
) -> Result<(CanvasCaller, CanvasService<T, super::DefaultEditingWorker>), Response> {
    let caller =
        CanvasCaller::of(receipt).ok_or_else(|| DocumentError::Unauthorized.into_response())?;
    let artifacts = (canvas.artifacts)(caller.user.clone()).await;
    let service = CanvasService::new(
        service.clone(),
        canvas.worker.clone(),
        jwt_secret.to_owned(),
        canvas.admission.clone(),
        canvas.recorder.clone(),
    )
    .with_artifacts(artifacts);
    Ok((caller, service))
}

/// Parse the worker's scene JSON and take its revision out of it.
fn scene_with_revision(canvas: Option<String>) -> Result<(String, serde_json::Value), CanvasError> {
    let scene: serde_json::Value = serde_json::from_str(canvas.as_deref().unwrap_or_default())
        .map_err(|error| CanvasError::Failed(error.into()))?;
    let revision = scene
        .get("revision")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| CanvasError::Failed(anyhow::anyhow!("canvas scene has no revision")))?
        .to_owned();
    Ok((revision, scene))
}

/// Read a canvas's live scene with view access: stable item ids, containment
/// and order, transforms, world bounds, shapes and text. No model runs.
#[utoipa::path(
    post,
    tag = "document",
    path = "/documents/{document_id}/canvas/scene",
    operation_id = "read_canvas_scene",
    params(("document_id" = String, Path, description = "Canvas document identity")),
    request_body = CanvasSceneRequest,
    responses(
        (status = 200, body = CanvasScene),
        (status = 400, description = "Not a canvas, or an invalid request", body = CanvasErrorBody),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document view access denied"),
        (status = 404, description = "Document not found"),
        (status = 500, description = "The read could not start", body = CanvasErrorBody),
        (status = 502, description = "The read failed", body = CanvasErrorBody)
    )
)]
#[tracing::instrument(skip_all, fields(document_id = %access.entity_access_receipt.entity().entity_id))]
pub async fn canvas_scene_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    request: Result<Json<CanvasSceneRequest>, JsonRejection>,
) -> Result<Json<CanvasScene>, Response> {
    let Json(request) = request.map_err(|rejection| bad_request(&rejection))?;
    let receipt = access.entity_access_receipt;
    let (caller, canvas) = canvas_service(
        &state.service,
        &state.canvas,
        &state.document_permission_jwt_secret,
        &receipt,
    )
    .await?;
    let response = canvas
        .read(
            receipt,
            &caller.user,
            caller.actor.as_deref(),
            request.item_ids,
            request.format,
        )
        .await
        .map_err(read_failure)?;
    let (revision, scene) = scene_with_revision(response.canvas).map_err(read_failure)?;
    Ok(Json(CanvasScene { revision, scene }))
}

/// Render a canvas to a PNG with view access, with the Canvas renderer, and
/// keep it as a static file owned by the caller. No model runs.
#[utoipa::path(
    post,
    tag = "document",
    path = "/documents/{document_id}/canvas/render",
    operation_id = "render_canvas",
    params(("document_id" = String, Path, description = "Canvas document identity")),
    request_body = CanvasRenderRequest,
    responses(
        (status = 200, body = CanvasRendered),
        (status = 400, description = "Not a canvas, or an invalid crop or selection", body = CanvasErrorBody),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document view access denied"),
        (status = 404, description = "Document not found"),
        (status = 500, description = "The render could not start or be stored", body = CanvasErrorBody),
        (status = 502, description = "The render failed", body = CanvasErrorBody)
    )
)]
#[tracing::instrument(skip_all, fields(document_id = %access.entity_access_receipt.entity().entity_id))]
pub async fn render_canvas_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    request: Result<Json<CanvasRenderRequest>, JsonRejection>,
) -> Result<Json<CanvasRendered>, Response> {
    let Json(request) = request.map_err(|rejection| bad_request(&rejection))?;
    let receipt = access.entity_access_receipt;
    let (caller, canvas) = canvas_service(
        &state.service,
        &state.canvas,
        &state.document_permission_jwt_secret,
        &receipt,
    )
    .await?;
    let stored = canvas
        .render_to_file(
            receipt,
            &caller.user,
            caller.actor.as_deref(),
            request.item_ids,
            request.crop,
            state.canvas.images.as_ref(),
        )
        .await
        .map_err(read_failure)?;
    let render = stored.render;
    Ok(Json(CanvasRendered {
        file_id: stored.image.file_id,
        url: stored.image.url,
        revision: render.revision,
        crop: render.crop,
        width: render.width,
        height: render.height,
        objects: render.objects,
        unavailable: render.unavailable,
        text_layout: render.text_layout,
    }))
}

/// Apply one batch of CanvasEditor code with edit access, against the revision
/// it was planned on, without a model. The batch validates, measures text and
/// commits once, or not at all.
#[utoipa::path(
    post,
    tag = "document",
    path = "/documents/{document_id}/canvas/edits",
    operation_id = "apply_canvas_edits",
    params(("document_id" = String, Path, description = "Canvas document identity")),
    request_body = CanvasEditsRequest,
    responses(
        (status = 200, body = CanvasEdited),
        (status = 400, description = "Not a canvas, or an invalid revision, code or snippets", body = CanvasErrorBody),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document edit access denied"),
        (status = 404, description = "Document not found"),
        (status = 409, description = "The scene changed since expectedRevision; nothing was committed", body = CanvasErrorBody),
        (status = 422, description = "The batch failed before it committed; nothing changed", body = CanvasErrorBody),
        (status = 500, description = "The batch could not start", body = CanvasErrorBody),
        (status = 502, description = "The batch failed and may have applied", body = CanvasErrorBody)
    )
)]
#[tracing::instrument(skip_all, fields(document_id = %access.entity_access_receipt.entity().entity_id, code_len))]
pub async fn apply_canvas_edits_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<EditAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    request: Result<Json<CanvasEditsRequest>, JsonRejection>,
) -> Result<Json<CanvasEdited>, Response> {
    let Json(request) = request.map_err(|rejection| bad_request(&rejection))?;
    tracing::Span::current().record("code_len", request.code.len());
    let receipt = access.entity_access_receipt;
    let (caller, canvas) = canvas_service(
        &state.service,
        &state.canvas,
        &state.document_permission_jwt_secret,
        &receipt,
    )
    .await?;
    let response = canvas
        .apply(
            receipt,
            &caller.user,
            caller.actor.as_deref(),
            CanvasRequest::Apply {
                expected_revision: request.expected_revision,
                code: request.code,
                snippets: request.snippets,
                editor_name: caller.editor.map(|name| name.as_str().to_owned()),
            },
        )
        .await
        .map_err(write_failure)?;
    let (revision, scene) = scene_with_revision(response.canvas).map_err(write_failure)?;
    Ok(Json(CanvasEdited {
        operations_applied: response.operations_applied as u64,
        revision,
        scene,
        summary: response.summary,
    }))
}

/// Edit a canvas by natural-language instructions with edit access, through
/// EditCanvas's editor, AI admission and billing.
#[utoipa::path(
    post,
    tag = "document",
    path = "/documents/{document_id}/canvas/ai-edit",
    operation_id = "edit_canvas_with_ai",
    params(("document_id" = String, Path, description = "Canvas document identity")),
    request_body = CanvasAiEditRequest,
    responses(
        (status = 200, body = CanvasAiEdited),
        (status = 400, description = "Not a canvas, or empty instructions", body = CanvasErrorBody),
        (status = 401, description = "Authentication required"),
        (status = 402, description = "AI allowance exhausted", body = ai_billing::inbound::admission::AiAdmissionErrorBody),
        (status = 403, description = "Document edit access denied"),
        (status = 404, description = "Document not found"),
        (status = 422, description = "The editor could not do the edit; nothing changed", body = CanvasErrorBody),
        (status = 500, description = "The edit could not start", body = CanvasErrorBody),
        (status = 502, description = "The edit failed and may have partly applied", body = CanvasErrorBody),
        (status = 503, description = "AI usage validation unavailable; retry later", body = ai_billing::inbound::admission::AiAdmissionErrorBody)
    )
)]
#[tracing::instrument(skip_all, fields(document_id = %access.entity_access_receipt.entity().entity_id, instructions_len))]
pub async fn edit_canvas_with_ai_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<EditAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    request: Result<Json<CanvasAiEditRequest>, JsonRejection>,
) -> Result<Json<CanvasAiEdited>, Response> {
    let Json(request) = request.map_err(|rejection| bad_request(&rejection))?;
    tracing::Span::current().record("instructions_len", request.instructions.len());
    let receipt = access.entity_access_receipt;
    let (caller, canvas) = canvas_service(
        &state.service,
        &state.canvas,
        &state.document_permission_jwt_secret,
        &receipt,
    )
    .await?;
    let response = canvas
        .edit(
            receipt,
            &caller.user,
            caller.actor.as_deref(),
            request.instructions,
            caller.editor,
        )
        .await
        .map_err(write_failure)?;
    // A clarification after applied operations is a partial edit, not a
    // refusal: the caller must know part of it landed.
    if response.operations_applied == 0
        && let Some(reason) = response.clarification
    {
        return Err(body(
            StatusCode::UNPROCESSABLE_ENTITY,
            CanvasErrorCode::EditRefused,
            reason,
        ));
    }
    Ok(Json(CanvasAiEdited {
        operations_applied: response.operations_applied as u64,
        summary: response.summary,
        clarification: response.clarification,
    }))
}
