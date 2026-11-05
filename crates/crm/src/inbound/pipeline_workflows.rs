//! HTTP routes over the pipeline workflows and CSV transfers: pipeline
//! entries addressed by the company or contact they track, fields by name and
//! options by label, the way the agent tools address them. Mount at `/crm`.
//!
//! Every handler is a thin adapter over [`PipelineWorkflowService`] or
//! [`CrmTransferService`], which authorize against the pipeline and write
//! through its own access boundary.

pub mod models;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use databases::domain::models::{RowId, TableVersion, Viewer};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;
use uuid::Uuid;

use crate::domain::{
    crm_transfer::{CrmTransferService, CsvInput, PipelineDestination, TransferError},
    pipeline_workflows::{
        EntryAddition, EntryQuery, EntryTarget, EntryUpdate, MAX_SCANNED_ROWS, PipelineEdit,
        PipelineWorkflowService, RecordTarget, WorkflowError,
    },
};

use models::{
    AddEntriesRequest, AddEntriesResponse, CompanyImportResponse, EditPipelineRequest,
    EntrySearchQuery, FindEntriesRequest, FoundEntriesResponse, ImportCompaniesCsvRequest,
    ImportPipelineCsvRequest, PipelineCsvResponse, PipelineEntries, PipelineEntry,
    PipelineExportResponse, PipelineFields, PipelineImportResponse, RecordEntriesRequest,
    RemoveEntriesRequest, RemoveEntriesResponse, UpdateEntriesRequest, UpdateEntriesResponse,
    UpdatedPipelineEntry, pairs,
};

/// Entries a read returns when it names no limit.
const DEFAULT_LIMIT: usize = 50;

/// Services the workflow routes run through.
pub struct PipelineWorkflowRouterState<Workflows, Transfer, Authorization> {
    /// Entries, fields and options by name.
    pub workflows: Arc<Workflows>,
    /// CSV imports and exports.
    pub transfer: Arc<Transfer>,
    /// Authentication state.
    pub authorization: MacroAuthorizationState<Authorization>,
}

impl<Workflows, Transfer, Authorization> Clone
    for PipelineWorkflowRouterState<Workflows, Transfer, Authorization>
{
    fn clone(&self) -> Self {
        Self {
            workflows: self.workflows.clone(),
            transfer: self.transfer.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Workflows, Transfer, Authorization>
    FromRef<PipelineWorkflowRouterState<Workflows, Transfer, Authorization>>
    for MacroAuthorizationState<Authorization>
{
    fn from_ref(state: &PipelineWorkflowRouterState<Workflows, Transfer, Authorization>) -> Self {
        state.authorization.clone()
    }
}

/// Mount at `/crm`, beside the pipeline routes.
pub fn router<Workflows, Transfer, Authorization, S>(
    state: PipelineWorkflowRouterState<Workflows, Transfer, Authorization>,
) -> Router<S>
where
    Workflows: PipelineWorkflowService,
    Transfer: CrmTransferService,
    Authorization: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/companies/import",
            post(import_companies::<Workflows, Transfer, Authorization>),
        )
        .route(
            "/pipelines/record-entries",
            post(record_entries::<Workflows, Transfer, Authorization>),
        )
        .route(
            "/pipelines/entry-search",
            get(search_entries::<Workflows, Transfer, Authorization>),
        )
        .route(
            "/pipelines/{id}/edit",
            post(edit::<Workflows, Transfer, Authorization>),
        )
        .route(
            "/pipelines/{id}/entries",
            post(add_entries::<Workflows, Transfer, Authorization>)
                .patch(update_entries::<Workflows, Transfer, Authorization>),
        )
        .route(
            "/pipelines/{id}/entries/find",
            post(find_entries::<Workflows, Transfer, Authorization>),
        )
        .route(
            "/pipelines/{id}/entries/remove",
            post(remove_entries::<Workflows, Transfer, Authorization>),
        )
        .route(
            "/pipelines/{id}/import",
            post(import_pipeline::<Workflows, Transfer, Authorization>),
        )
        .route(
            "/pipelines/{id}/csv",
            get(pipeline_csv::<Workflows, Transfer, Authorization>),
        )
        .route(
            "/pipelines/{id}/export",
            post(export_pipeline::<Workflows, Transfer, Authorization>),
        )
        .with_state(state)
}

/// The caller, with the agent its SDK token names acting for it. The agent
/// only attributes writes; access stays the user's.
fn viewer<Authorization>(
    auth: &MacroAuthorizationExtractor<Authorization, UserOrInternal>,
) -> Viewer {
    Viewer {
        user_id: auth.authorization.user.macro_user_id.clone(),
        acting_bot: auth.authorization.user.agent_id,
    }
}

/// A requested limit, or the default.
fn limit(requested: Option<usize>) -> Result<usize, WorkflowError> {
    match requested {
        None => Ok(DEFAULT_LIMIT),
        Some(limit) if (1..=MAX_SCANNED_ROWS).contains(&limit) => Ok(limit),
        Some(_) => Err(WorkflowError::Invalid(format!(
            "limit must be from 1 to {MAX_SCANNED_ROWS}."
        ))),
    }
}

/// The CSV a request names: exactly one of its text or a file.
fn csv_input(csv: Option<String>, document_id: Option<Uuid>) -> Result<CsvInput, TransferError> {
    match (csv, document_id) {
        (Some(text), None) => Ok(CsvInput::Text(text)),
        (None, Some(id)) => Ok(CsvInput::File(id)),
        _ => Err(TransferError::Invalid(
            "Give exactly one of csv (the CSV text) or documentId (a CSV file in Macro).".into(),
        )),
    }
}

/// Entries of one pipeline matching filters, records or a search, with
/// per-option counts and number totals over every match.
#[utoipa::path(post, path = "/crm/pipelines/{id}/entries/find", operation_id = "find_crm_pipeline_entries",
    request_body = FindEntriesRequest, params(("id" = Uuid, Path)),
    responses((status = 200, body = FoundEntriesResponse), (status = 400, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all, fields(pipeline_id = %id))]
pub async fn find_entries<
    Workflows: PipelineWorkflowService,
    Transfer: CrmTransferService,
    Authorization: MacroAuthorizationService,
>(
    auth: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    State(state): State<PipelineWorkflowRouterState<Workflows, Transfer, Authorization>>,
    Path(id): Path<Uuid>,
    Json(request): Json<FindEntriesRequest>,
) -> Result<Json<FoundEntriesResponse>, WorkflowError> {
    let query = EntryQuery {
        filters: pairs(&request.filters),
        records: request.record_ids,
        search: request.search.filter(|search| !search.trim().is_empty()),
        sort: request.sort_by.map(|field| (field, request.descending)),
        limit: limit(request.limit)?,
    };
    let found = state.workflows.find(&viewer(&auth), id, query).await?;
    Ok(Json((&found).into()))
}

/// Every entry tracking one of the records, across the caller's pipelines;
/// pipelines without one are left out.
#[utoipa::path(post, path = "/crm/pipelines/record-entries", operation_id = "list_crm_record_pipeline_entries",
    request_body = RecordEntriesRequest,
    responses((status = 200, body = Vec<PipelineEntries>), (status = 400, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all, fields(records = request.record_ids.len()))]
pub async fn record_entries<
    Workflows: PipelineWorkflowService,
    Transfer: CrmTransferService,
    Authorization: MacroAuthorizationService,
>(
    auth: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    State(state): State<PipelineWorkflowRouterState<Workflows, Transfer, Authorization>>,
    Json(request): Json<RecordEntriesRequest>,
) -> Result<Json<Vec<PipelineEntries>>, WorkflowError> {
    let found = state
        .workflows
        .record_entries(&viewer(&auth), &request.record_ids)
        .await?;
    Ok(Json(
        found
            .iter()
            .filter(|group| !group.entries.is_empty())
            .map(PipelineEntries::from)
            .collect(),
    ))
}

/// Entries whose company or contact matches the search, across the caller's
/// pipelines; pipelines without a match are left out.
#[utoipa::path(get, path = "/crm/pipelines/entry-search", operation_id = "search_crm_pipeline_entries",
    params(EntrySearchQuery),
    responses((status = 200, body = Vec<PipelineEntries>), (status = 400, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn search_entries<
    Workflows: PipelineWorkflowService,
    Transfer: CrmTransferService,
    Authorization: MacroAuthorizationService,
>(
    auth: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    State(state): State<PipelineWorkflowRouterState<Workflows, Transfer, Authorization>>,
    Query(query): Query<EntrySearchQuery>,
) -> Result<Json<Vec<PipelineEntries>>, WorkflowError> {
    let search = query.search.trim();
    if search.is_empty() {
        return Err(WorkflowError::Invalid("search must not be empty.".into()));
    }
    let found = state
        .workflows
        .search_entries(&viewer(&auth), search, limit(query.limit)?)
        .await?;
    Ok(Json(found.iter().map(PipelineEntries::from).collect()))
}

/// Add companies or contacts as entries, filling fields by name. A record
/// already in the pipeline is returned in `alreadyPresent` instead, unless
/// `allowDuplicates`.
#[utoipa::path(post, path = "/crm/pipelines/{id}/entries", operation_id = "add_crm_pipeline_entries",
    request_body = AddEntriesRequest, params(("id" = Uuid, Path)),
    responses((status = 200, body = AddEntriesResponse), (status = 400, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all, fields(pipeline_id = %id, entries = request.entries.len()))]
pub async fn add_entries<
    Workflows: PipelineWorkflowService,
    Transfer: CrmTransferService,
    Authorization: MacroAuthorizationService,
>(
    auth: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    State(state): State<PipelineWorkflowRouterState<Workflows, Transfer, Authorization>>,
    Path(id): Path<Uuid>,
    Json(request): Json<AddEntriesRequest>,
) -> Result<Json<AddEntriesResponse>, WorkflowError> {
    let additions = request
        .entries
        .into_iter()
        .map(|entry| {
            let record = match (entry.record_id, entry.email) {
                (Some(id), None) => RecordTarget::Id(id),
                (None, Some(email)) => RecordTarget::Email(email.trim().to_owned()),
                _ => {
                    return Err(WorkflowError::Invalid(
                        "Give each entry exactly one of recordId or email.".into(),
                    ));
                }
            };
            Ok(EntryAddition {
                record,
                set: pairs(&entry.set),
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let added = state
        .workflows
        .add(&viewer(&auth), id, additions, request.allow_duplicates)
        .await?;
    Ok(Json(AddEntriesResponse {
        added: added.added.iter().map(PipelineEntry::from).collect(),
        already_present: added
            .already_present
            .iter()
            .map(PipelineEntry::from)
            .collect(),
        version: added.version.map(|version| version.0),
    }))
}

/// Set fields of entries by name, all or nothing; a stage takes its label.
#[utoipa::path(patch, path = "/crm/pipelines/{id}/entries", operation_id = "update_crm_pipeline_entries",
    request_body = UpdateEntriesRequest, params(("id" = Uuid, Path)),
    responses((status = 200, body = UpdateEntriesResponse), (status = 400, body = ErrorResponse),
        (status = 409, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all, fields(pipeline_id = %id, entries = request.updates.len()))]
pub async fn update_entries<
    Workflows: PipelineWorkflowService,
    Transfer: CrmTransferService,
    Authorization: MacroAuthorizationService,
>(
    auth: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    State(state): State<PipelineWorkflowRouterState<Workflows, Transfer, Authorization>>,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdateEntriesRequest>,
) -> Result<Json<UpdateEntriesResponse>, WorkflowError> {
    let updates = request
        .updates
        .into_iter()
        .map(|update| {
            let target = match (update.entry_id, update.record_id) {
                (Some(entry), None) => EntryTarget::Entry(RowId::from_uuid(entry)),
                (None, Some(record)) => EntryTarget::Record(record),
                _ => {
                    return Err(WorkflowError::Invalid(
                        "Give each update exactly one of entryId or recordId.".into(),
                    ));
                }
            };
            Ok(EntryUpdate {
                target,
                set: pairs(&update.set),
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let updated = state
        .workflows
        .update(
            &viewer(&auth),
            id,
            updates,
            request.base_version.map(TableVersion),
        )
        .await?;
    Ok(Json(UpdateEntriesResponse {
        updated: updated
            .updated
            .iter()
            .map(UpdatedPipelineEntry::from)
            .collect(),
        version: updated.version.map(|version| version.0),
    }))
}

/// Delete entries by id, or every entry of the records; the companies and
/// contacts stay in the CRM.
#[utoipa::path(post, path = "/crm/pipelines/{id}/entries/remove", operation_id = "remove_crm_pipeline_entries",
    request_body = RemoveEntriesRequest, params(("id" = Uuid, Path)),
    responses((status = 200, body = RemoveEntriesResponse), (status = 400, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all, fields(pipeline_id = %id))]
pub async fn remove_entries<
    Workflows: PipelineWorkflowService,
    Transfer: CrmTransferService,
    Authorization: MacroAuthorizationService,
>(
    auth: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    State(state): State<PipelineWorkflowRouterState<Workflows, Transfer, Authorization>>,
    Path(id): Path<Uuid>,
    Json(request): Json<RemoveEntriesRequest>,
) -> Result<Json<RemoveEntriesResponse>, WorkflowError> {
    let targets: Vec<EntryTarget> = request
        .entry_ids
        .into_iter()
        .map(|entry| EntryTarget::Entry(RowId::from_uuid(entry)))
        .chain(request.record_ids.into_iter().map(EntryTarget::Record))
        .collect();
    if targets.is_empty() {
        return Err(WorkflowError::Invalid(
            "Give the entryIds or recordIds to remove.".into(),
        ));
    }
    let removed = state.workflows.remove(&viewer(&auth), id, targets).await?;
    Ok(Json(RemoveEntriesResponse {
        removed: removed.removed.iter().map(PipelineEntry::from).collect(),
        version: removed.version.map(|version| version.0),
    }))
}

/// Rename or share a pipeline, and add, rename or delete its fields and
/// options by name, in one change.
#[utoipa::path(post, path = "/crm/pipelines/{id}/edit", operation_id = "edit_crm_pipeline",
    request_body = EditPipelineRequest, params(("id" = Uuid, Path)),
    responses((status = 200, body = PipelineFields), (status = 400, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all, fields(pipeline_id = %id))]
pub async fn edit<
    Workflows: PipelineWorkflowService,
    Transfer: CrmTransferService,
    Authorization: MacroAuthorizationService,
>(
    auth: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    State(state): State<PipelineWorkflowRouterState<Workflows, Transfer, Authorization>>,
    Path(id): Path<Uuid>,
    Json(request): Json<EditPipelineRequest>,
) -> Result<Json<PipelineFields>, WorkflowError> {
    let edit = PipelineEdit {
        name: request.name,
        sharing: request.sharing,
        add_fields: request.add_fields.iter().map(Into::into).collect(),
        rename_fields: request
            .rename_fields
            .into_iter()
            .map(|rename| (rename.from, rename.to))
            .collect(),
        remove_fields: request.remove_fields,
        add_options: request
            .add_options
            .into_iter()
            .map(|add| (add.field, add.labels))
            .collect(),
        rename_options: request
            .rename_options
            .into_iter()
            .map(|rename| (rename.field, rename.from, rename.to))
            .collect(),
        remove_options: request
            .remove_options
            .into_iter()
            .map(|remove| (remove.field, remove.label))
            .collect(),
    };
    let edited = state.workflows.edit(&viewer(&auth), id, edit).await?;
    Ok(Json((&edited).into()))
}

/// Add a CSV's rows as entries, matching its columns to fields by name and
/// creating the companies or contacts the team lacks. Records already in the
/// pipeline are not added again.
#[utoipa::path(post, path = "/crm/pipelines/{id}/import", operation_id = "import_crm_pipeline_csv",
    request_body = ImportPipelineCsvRequest, params(("id" = Uuid, Path)),
    responses((status = 200, body = PipelineImportResponse), (status = 400, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all, fields(pipeline_id = %id))]
pub async fn import_pipeline<
    Workflows: PipelineWorkflowService,
    Transfer: CrmTransferService,
    Authorization: MacroAuthorizationService,
>(
    auth: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    State(state): State<PipelineWorkflowRouterState<Workflows, Transfer, Authorization>>,
    Path(id): Path<Uuid>,
    Json(request): Json<ImportPipelineCsvRequest>,
) -> Result<Json<PipelineImportResponse>, TransferError> {
    let csv = csv_input(request.csv, request.document_id)?;
    let outcome = state
        .transfer
        .import_to_pipeline(&viewer(&auth), id, csv)
        .await?;
    Ok(Json((&outcome).into()))
}

/// Create the companies a CSV lists, and put its Stage, Owner and Revenue
/// values on entries of a company pipeline.
#[utoipa::path(post, path = "/crm/companies/import", operation_id = "import_crm_companies_csv",
    request_body = ImportCompaniesCsvRequest,
    responses((status = 200, body = CompanyImportResponse), (status = 400, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn import_companies<
    Workflows: PipelineWorkflowService,
    Transfer: CrmTransferService,
    Authorization: MacroAuthorizationService,
>(
    auth: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    State(state): State<PipelineWorkflowRouterState<Workflows, Transfer, Authorization>>,
    Json(request): Json<ImportCompaniesCsvRequest>,
) -> Result<Json<CompanyImportResponse>, TransferError> {
    let csv = csv_input(request.csv, request.document_id)?;
    let destination = match (request.pipeline_id, request.new_pipeline) {
        (Some(id), None) => Some(PipelineDestination::Existing(id)),
        (None, Some(new)) => Some(PipelineDestination::New {
            name: new.name,
            sharing: new.sharing,
        }),
        (None, None) => None,
        (Some(_), Some(_)) => {
            return Err(TransferError::Invalid(
                "Give at most one of pipelineId or newPipeline.".into(),
            ));
        }
    };
    let outcome = state
        .transfer
        .import_companies(&viewer(&auth), csv, destination)
        .await?;
    Ok(Json((&outcome).into()))
}

/// Every entry as CSV text: Company and Domain (or Contact and Email), then
/// one column per field, people as emails. An import reads the same layout.
#[utoipa::path(get, path = "/crm/pipelines/{id}/csv", operation_id = "get_crm_pipeline_csv",
    params(("id" = Uuid, Path)),
    responses((status = 200, body = PipelineCsvResponse), (status = 400, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all, fields(pipeline_id = %id))]
pub async fn pipeline_csv<
    Workflows: PipelineWorkflowService,
    Transfer: CrmTransferService,
    Authorization: MacroAuthorizationService,
>(
    auth: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    State(state): State<PipelineWorkflowRouterState<Workflows, Transfer, Authorization>>,
    Path(id): Path<Uuid>,
) -> Result<Json<PipelineCsvResponse>, TransferError> {
    let csv = state.transfer.pipeline_csv(&viewer(&auth), id).await?;
    Ok(Json(csv.into()))
}

/// Save every entry as a CSV file in the caller's files, laid out as
/// `/csv` returns it.
#[utoipa::path(post, path = "/crm/pipelines/{id}/export", operation_id = "export_crm_pipeline_csv",
    params(("id" = Uuid, Path)),
    responses((status = 200, body = PipelineExportResponse), (status = 400, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all, fields(pipeline_id = %id))]
pub async fn export_pipeline<
    Workflows: PipelineWorkflowService,
    Transfer: CrmTransferService,
    Authorization: MacroAuthorizationService,
>(
    auth: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    State(state): State<PipelineWorkflowRouterState<Workflows, Transfer, Authorization>>,
    Path(id): Path<Uuid>,
) -> Result<Json<PipelineExportResponse>, TransferError> {
    let export = state.transfer.export_pipeline(&viewer(&auth), id).await?;
    Ok(Json(export.into()))
}

fn message(status: StatusCode, message: String) -> Response {
    (
        status,
        Json(ErrorResponse {
            message: message.into(),
        }),
    )
        .into_response()
}

impl IntoResponse for WorkflowError {
    fn into_response(self) -> Response {
        match self {
            Self::Invalid(text) => message(StatusCode::BAD_REQUEST, text),
            Self::NoTeam => message(
                StatusCode::FORBIDDEN,
                "the user is not in a team, so they have no CRM".into(),
            ),
            Self::Pipeline(error) => error.into_response(),
            Self::Crm(error) => error.into_response(),
            Self::Access(error) => {
                entity_access::inbound::axum_extractors::ExtractorError::from(error).into_response()
            }
        }
    }
}

impl IntoResponse for TransferError {
    fn into_response(self) -> Response {
        match self {
            Self::Invalid(text) | Self::File(text) => message(StatusCode::BAD_REQUEST, text),
            Self::Workflow(error) => error.into_response(),
            Self::Crm(error) => error.into_response(),
            Self::Access(error) => {
                entity_access::inbound::axum_extractors::ExtractorError::from(error).into_response()
            }
        }
    }
}
