//! Company/contact pipelines: CRM policy over reusable database storage.

mod columns;
mod references;
mod sharing;
use columns::{generic_columns, tracked_columns};
use sharing::{requested_channel_grants, share_permission};
pub mod requirements;
use references::primary_references;

#[cfg(test)]
mod test;

use requirements::StageRequirement;

use super::{auth::CrmTeamReceipt, stages::StageDefinitionStore};
use bot_id::BotId;
use chrono::{DateTime, Utc};
use databases::domain::{
    models::{
        AppliedOps, CardPosition, ColumnDetail, ColumnId, DatabaseId, OpBatch, RowId, TableDetail,
        TableId, ViewId, Viewer,
    },
    provisioning::StorageBlueprint,
    storage::{DatabaseStorageService, StorageRow, StorageRows, StorageRowsQuery},
};
use entity_access::domain::{
    models::{
        AccessLevel, EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, EntityType,
        MemberTeamRole, OwnerAccessLevel, RequiredPermission, ViewAccessLevel,
    },
    ports::{AccessiblePipelines, EntityAccessService},
};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::{
    SharePermissionV2, UpdateSharePermissionRequestV2,
    channel_share_permission::{
        ChannelSharePermission, UpdateChannelSharePermission, UpdateOperation,
    },
};
use models_properties::EntityType as PropertyEntityType;
use models_properties::service::property_value::PropertyValue;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use uuid::Uuid;

/// Which CRM entity each row references. Fixed when a pipeline is created.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PipelineRecordType {
    /// Company memberships.
    Company,
    /// Contact memberships.
    Contact,
}

impl PipelineRecordType {
    /// Database representation.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Company => "company",
            Self::Contact => "contact",
        }
    }
    /// The primary reference's property type.
    pub fn property_type(self) -> PropertyEntityType {
        match self {
            Self::Company => PropertyEntityType::Company,
            Self::Contact => PropertyEntityType::Contact,
        }
    }
    /// The kind of record the primary column's cells reference.
    pub fn entity_kind(self) -> models_databases::EntityKind {
        match self {
            Self::Company => models_databases::EntityKind::Company,
            Self::Contact => models_databases::EntityKind::Contact,
        }
    }
}

/// Initial sharing, or the desired team grant. Individual ownership is preserved.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PipelineSharing {
    /// Only the creator, by default.
    #[default]
    Private,
    /// Creator owns; current team members may edit.
    Team,
}

/// Request to create an empty pipeline: the standard CRM columns for a tracked
/// record, or one Name column, like a new database, for a generic pipeline.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreatePipeline {
    /// Pipeline name.
    pub name: String,
    /// Company or contact entries; omitted, a generic pipeline of free-form rows.
    #[serde(default)]
    pub record_type: Option<PipelineRecordType>,
    /// Defaults to private.
    #[serde(default)]
    pub sharing: PipelineSharing,
}

/// Pipeline metadata; table schema and data are read through the database service.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Pipeline {
    /// Entity identity, used with `CrmPipeline` access receipts.
    pub id: Uuid,
    /// Team owning the pipeline; references retain their own access controls.
    pub team_id: Uuid,
    /// Owning user; sharing never changes ownership.
    pub user_id: String,
    /// Pipeline display name.
    pub name: String,
    /// Kind of the primary reference; `None` for a generic pipeline, whose
    /// primary column is plain text.
    #[schema(required = true)]
    pub record_type: Option<PipelineRecordType>,
    /// Dedicated backing database.
    #[schema(value_type = Uuid)]
    pub database_id: DatabaseId,
    /// Table of entries.
    #[schema(value_type = Uuid)]
    pub table_id: TableId,
    /// A tracked pipeline's protected record reference. A generic pipeline's
    /// Name, which names no column once someone deletes it.
    #[schema(value_type = Uuid)]
    pub primary_column_id: ColumnId,
    /// Stable identities for Outcome and amount/currency fields.
    pub commercial_fields: super::pipeline_commercial::CommercialFields,
    /// Whether the pipeline has a team grant.
    pub sharing: PipelineSharing,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Trashed pipelines are omitted from navigation.
    #[schema(required = true)]
    pub trashed_at: Option<DateTime<Utc>>,
}

/// Metadata together with the caller's effective grant.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AccessiblePipeline {
    /// Pipeline metadata.
    #[serde(flatten)]
    pub pipeline: Pipeline,
    /// Highest effective access.
    pub grant: AccessLevel,
}

/// A pipeline row and the company or contact its primary column references.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PipelineReference {
    /// The pipeline holding the row.
    pub pipeline_id: Uuid,
    /// The row.
    pub row_id: RowId,
    /// The referenced company or contact.
    pub record_id: Uuid,
}

/// A row of a pipeline the viewer can see, for the company or contact it references.
#[derive(Debug, Clone)]
pub struct PipelineEntry {
    /// The row.
    pub row_id: RowId,
    /// The referenced company or contact.
    pub record_id: Uuid,
    /// The pipeline and the viewer's grant on it, shared by its entries.
    pub pipeline: Arc<AccessiblePipeline>,
    /// The pipeline's columns in display order, shared by its entries.
    pub columns: Arc<[ColumnDetail]>,
    /// Populated cells by column.
    pub cells: HashMap<ColumnId, PropertyValue>,
}

/// All records needed for atomic provisioning.
pub struct PipelineBlueprint {
    /// Pipeline identity.
    pub id: Uuid,
    /// CRM team.
    pub team_id: Uuid,
    /// Primary reference kind, if it tracks a record.
    pub record_type: Option<PipelineRecordType>,
    /// Outcome and amount/currency fields provisioned with a tracked pipeline's table.
    pub commercial_fields: super::pipeline_commercial::CommercialFields,
    /// Initial grants.
    pub sharing: PipelineSharing,
    /// Schema owned by the database domain.
    pub database: StorageBlueprint,
    /// Pipeline-owned display name.
    pub name: String,
    /// Initial owner.
    pub creator: MacroUserIdStr<'static>,
    /// Protected company/contact reference, or a generic pipeline's Name.
    pub primary_column_id: ColumnId,
}

/// Errors crossing the pipeline boundary.
#[derive(Debug, thiserror::Error)]
pub enum PipelineError {
    /// Invalid user input.
    #[error("{0}")]
    Invalid(&'static str),
    /// Missing or inaccessible pipeline.
    #[error("Pipeline not found")]
    NotFound,
    /// Access-layer refusal.
    #[error(transparent)]
    Access(#[from] entity_access::domain::models::AccessError),
    /// CRM policy failure.
    #[error(transparent)]
    Crm(#[from] super::model::CrmError),
    /// Database operation failure.
    #[error(transparent)]
    Database(#[from] databases::domain::models::DatabaseError),
    /// Persistence failure.
    #[error("Pipeline storage failed: {0}")]
    Storage(rootcause::Report),
}

/// Persistence contract. Transactions and grant writes belong to the adapter.
pub trait PipelineRepo: Send + Sync + 'static {
    /// Adapter error.
    type Error: std::error::Error + Send + Sync + 'static;
    /// Holds a live pipeline against concurrent trash/deletion.
    type Guard: Send;
    /// Acquire a lifecycle guard for reads and writes.
    fn lock_live(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<Self::Guard>, Self::Error>> + Send;
    /// Serialize policy changes and row writes for one live pipeline.
    fn lock_write(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<Self::Guard>, Self::Error>> + Send;
    /// Read stage rules, keyed by stable column and option identities.
    fn stage_requirements(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Vec<StageRequirement>, Self::Error>> + Send;
    /// Replace the required fields for one stage; an empty list removes its rule.
    fn set_stage_requirement(
        &self,
        id: Uuid,
        rule: &StageRequirement,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;
    /// Rename pipeline metadata.
    fn rename(&self, id: Uuid, name: &str) -> impl Future<Output = Result<(), Self::Error>> + Send;
    /// Update pipeline lifecycle metadata.
    fn set_trashed(
        &self,
        id: Uuid,
        trashed: bool,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;
    /// Facts used by creation policy.
    fn crm_enabled(&self, team: Uuid) -> impl Future<Output = Result<bool, Self::Error>> + Send;
    /// Read pipeline metadata for a known set of accessible identities.
    fn get_many(
        &self,
        ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<Pipeline>, Self::Error>> + Send;
    /// Rows of these live tracked pipelines whose primary column references one
    /// of `records`, grouped by pipeline in each one's row order.
    fn referencing_rows(
        &self,
        pipelines: &[Uuid],
        records: &[Uuid],
    ) -> impl Future<Output = Result<Vec<PipelineReference>, Self::Error>> + Send;
    /// Insert metadata, backing database and grants atomically.
    fn create(
        &self,
        blueprint: &PipelineBlueprint,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;
    /// Change the owning team's grant; ownership remains unchanged.
    fn share(
        &self,
        pipeline: &Pipeline,
        sharing: PipelineSharing,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;
    /// The channels, direct messages included, the pipeline is shared with.
    fn channel_grants(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Vec<ChannelSharePermission>, Self::Error>> + Send;
    /// Change channel grants while the pipeline is live; false when it is not.
    fn update_channel_grants(
        &self,
        id: Uuid,
        grants: &[UpdateChannelSharePermission],
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send;
}

/// Pipeline use cases for HTTP and other driving adapters.
pub trait PipelineService: Send + Sync + 'static {
    /// Read a saved board's order through pipeline access and lifecycle checks.
    fn view_positions(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        view: ViewId,
    ) -> impl Future<Output = Result<Vec<CardPosition>, PipelineError>> + Send;
    /// Create for the authenticated team member.
    fn create(
        &self,
        team: CrmTeamReceipt<MemberTeamRole>,
        input: CreatePipeline,
    ) -> impl Future<Output = Result<AccessiblePipeline, PipelineError>> + Send;
    /// Visible, live pipelines of this CRM.
    fn list(
        &self,
        team: CrmTeamReceipt<MemberTeamRole>,
    ) -> impl Future<Output = Result<Vec<AccessiblePipeline>, PipelineError>> + Send;
    /// Rows referencing these companies or contacts, from the live pipelines
    /// of that record type the viewer can see. Pipeline grants are the whole
    /// boundary: the rows are what those pipelines already show the viewer.
    fn entries(
        &self,
        viewer: &MacroUserIdStr<'static>,
        record_type: PipelineRecordType,
        records: &[Uuid],
    ) -> impl Future<Output = Result<Vec<PipelineEntry>, PipelineError>> + Send;
    /// Read a pipeline by identity.
    fn get(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<AccessiblePipeline, PipelineError>> + Send;
    /// Read the pipeline's schema through its own access boundary.
    fn table(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<TableDetail, PipelineError>> + Send;
    /// Read pipeline records, without database app or Soup access.
    fn rows(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        after: Option<RowId>,
    ) -> impl Future<Output = Result<StorageRows, PipelineError>> + Send;
    /// Query pipeline rows with the shared database filter and sort semantics.
    fn query_rows(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        query: StorageRowsQuery,
    ) -> impl Future<Output = Result<StorageRows, PipelineError>> + Send;
    /// The cells of those of `rows` that are this pipeline's, in row order.
    fn read_rows(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        rows: &[RowId],
    ) -> impl Future<Output = Result<Vec<StorageRow>, PipelineError>> + Send;
    /// This pipeline's rows whose primary column references one of
    /// `records`, in row order.
    fn record_rows(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        records: &[Uuid],
    ) -> impl Future<Output = Result<Vec<PipelineReference>, PipelineError>> + Send;

    /// Validate pipeline policy, then use the shared storage operation planner.
    /// `acting_bot` is the agent making the change for the receipt's user,
    /// recorded for attribution only.
    fn apply_ops(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        acting_bot: Option<BotId>,
        batch: OpBatch,
    ) -> impl Future<Output = Result<AppliedOps, PipelineError>> + Send;
    /// Read the rules visible to anyone with pipeline read access.
    fn stage_requirements(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<Vec<StageRequirement>, PipelineError>> + Send;
    /// Set required fields for one stage with pipeline edit access.
    fn set_stage_requirement(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        rule: StageRequirement,
    ) -> impl Future<Output = Result<(), PipelineError>> + Send;
    /// Rename pipeline metadata.
    fn rename(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        name: String,
    ) -> impl Future<Output = Result<(), PipelineError>> + Send;
    /// Change team sharing.
    fn share(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        sharing: PipelineSharing,
    ) -> impl Future<Output = Result<(), PipelineError>> + Send;
    /// Owner, team grant and channel recipients, for those who may share it.
    fn share_permissions(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> impl Future<Output = Result<SharePermissionV2, PipelineError>> + Send;
    /// Change channel recipients. Like a document, anyone who can edit the
    /// pipeline shares it with people and channels; only the owner changes
    /// team access, through [`Self::share`].
    fn update_share_permissions(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        request: UpdateSharePermissionRequestV2,
    ) -> impl Future<Output = Result<SharePermissionV2, PipelineError>> + Send;
    /// Move to trash or restore.
    fn set_trashed(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        trashed: bool,
    ) -> impl Future<Output = Result<(), PipelineError>> + Send;
}

/// Pipeline policy, composed with the owning database and access services.
pub struct PipelineServiceImpl<Repo, Databases, Access, Stages> {
    repo: Repo,
    databases: Arc<Databases>,
    access: Arc<Access>,
    stages: Stages,
}

fn storage(error: impl std::error::Error + Send + Sync + 'static) -> PipelineError {
    PipelineError::Storage(rootcause::Report::new(error).into_dynamic())
}

fn actor<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<MacroUserIdStr<'static>, PipelineError> {
    match receipt.auth() {
        EntityAccessAuth::Authenticated(user) => Ok(user.clone()),
        _ => Err(PipelineError::Invalid("An authenticated user is required")),
    }
}

fn name(input: &str) -> Result<String, PipelineError> {
    let input = input.trim();
    if input.is_empty() || input.chars().count() > 200 {
        return Err(PipelineError::Invalid(
            "Use a pipeline name between 1 and 200 characters",
        ));
    }
    Ok(input.to_string())
}

impl<R: PipelineRepo, D, A, S> PipelineServiceImpl<R, D, A, S> {
    /// Compose the service from domain capabilities.
    pub fn new(repo: R, databases: Arc<D>, access: Arc<A>, stages: S) -> Self {
        Self {
            repo,
            databases,
            access,
            stages,
        }
    }

    async fn pipeline<T: RequiredPermission>(
        &self,
        receipt: &EntityAccessReceipt<T>,
    ) -> Result<Pipeline, PipelineError> {
        if receipt.entity().entity_type != EntityType::CrmPipeline {
            return Err(PipelineError::NotFound);
        }
        let id = receipt
            .entity()
            .entity_id
            .parse()
            .map_err(|_| PipelineError::NotFound)?;
        self.repo
            .get_many(&[id])
            .await
            .map_err(storage)?
            .pop()
            .ok_or(PipelineError::NotFound)
    }
}

/// Build the initial schema without performing I/O. Callers validate the name.
/// `labels` are a tracked pipeline's stages.
pub(crate) fn pipeline_blueprint(
    team_id: Uuid,
    creator: MacroUserIdStr<'static>,
    input: CreatePipeline,
    labels: Vec<String>,
) -> PipelineBlueprint {
    let id = macro_uuid::generate_uuid_v7();
    let primary_column_id = ColumnId::new();
    // Only a pipeline that tracks a record holds deals; a generic one is a free-form table.
    let (columns, commercial_fields) = match input.record_type {
        Some(record_type) => {
            let mut columns = tracked_columns(primary_column_id, record_type, labels);
            let commercial_fields = super::pipeline_commercial::provision(&mut columns);
            (columns, commercial_fields)
        }
        None => (generic_columns(primary_column_id), Default::default()),
    };
    PipelineBlueprint {
        commercial_fields,
        id,
        team_id,
        record_type: input.record_type,
        sharing: input.sharing,
        name: input.name,
        creator,
        primary_column_id,
        database: StorageBlueprint {
            id: DatabaseId::new(),
            table_id: TableId::new(),
            columns,
        },
    }
}

impl<R, D, A, S> PipelineService for PipelineServiceImpl<R, D, A, S>
where
    R: PipelineRepo,
    D: DatabaseStorageService,
    A: EntityAccessService + AccessiblePipelines,
    S: StageDefinitionStore,
{
    async fn create(
        &self,
        team: CrmTeamReceipt<MemberTeamRole>,
        input: CreatePipeline,
    ) -> Result<AccessiblePipeline, PipelineError> {
        let name = name(&input.name)?;
        let creator = actor(team.receipt())?;
        if !self
            .repo
            .crm_enabled(team.team_id())
            .await
            .map_err(storage)?
        {
            return Err(super::model::CrmError::CrmDisabledForTeam.into());
        }
        // The team's stages describe its sales process, which a generic
        // pipeline makes no assumption about.
        let labels = if input.record_type.is_some() {
            let stages = self.stages.get_team_stage_set(&team).await?;
            stages
                .map(|set| {
                    set.stages
                        .into_iter()
                        .map(|stage| stage.label)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_else(|| {
                    use system_properties::StageOption::*;
                    [Lead, Qualified, Demo, Trial, Negotiation, Customer, Churned]
                        .into_iter()
                        .map(|stage| stage.display_value().to_owned())
                        .collect()
                })
        } else {
            Vec::new()
        };
        let blueprint = pipeline_blueprint(
            team.team_id(),
            creator.clone(),
            CreatePipeline { name, ..input },
            labels,
        );
        let id = blueprint.id;
        self.repo.create(&blueprint).await.map_err(storage)?;
        let pipeline = self
            .repo
            .get_many(&[id])
            .await
            .map_err(storage)?
            .pop()
            .ok_or(PipelineError::NotFound)?;
        Ok(AccessiblePipeline {
            pipeline,
            grant: AccessLevel::Owner,
        })
    }

    async fn list(
        &self,
        team: CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<Vec<AccessiblePipeline>, PipelineError> {
        let user = actor(team.receipt())?;
        let grants: HashMap<_, _> = self
            .access
            .accessible_pipelines(&user)
            .await?
            .into_iter()
            .collect();
        let ids = grants.keys().copied().collect::<Vec<_>>();
        Ok(self
            .repo
            .get_many(&ids)
            .await
            .map_err(storage)?
            .into_iter()
            .filter(|p| p.team_id == team.team_id() && p.trashed_at.is_none())
            .map(|pipeline| AccessiblePipeline {
                grant: grants[&pipeline.id],
                pipeline,
            })
            .collect())
    }

    async fn entries(
        &self,
        viewer: &MacroUserIdStr<'static>,
        record_type: PipelineRecordType,
        records: &[Uuid],
    ) -> Result<Vec<PipelineEntry>, PipelineError> {
        if records.is_empty() {
            return Ok(Vec::new());
        }
        let grants: HashMap<_, _> = self
            .access
            .accessible_pipelines(viewer)
            .await?
            .into_iter()
            .collect();
        if grants.is_empty() {
            return Ok(Vec::new());
        }
        let ids = grants.keys().copied().collect::<Vec<_>>();
        let pipelines: HashMap<_, _> = self
            .repo
            .get_many(&ids)
            .await
            .map_err(storage)?
            .into_iter()
            .filter(|p| p.trashed_at.is_none() && p.record_type == Some(record_type))
            .map(|p| (p.id, p))
            .collect();
        let live = pipelines.keys().copied().collect::<Vec<_>>();
        let references = self
            .repo
            .referencing_rows(&live, records)
            .await
            .map_err(storage)?;
        let mut entries = Vec::with_capacity(references.len());
        for references in references.chunk_by(|a, b| a.pipeline_id == b.pipeline_id) {
            let Some(pipeline) = pipelines.get(&references[0].pipeline_id) else {
                continue;
            };
            // A pipeline trashed since the lookup has no entries.
            let Some(_guard) = self.repo.lock_live(pipeline.id).await.map_err(storage)? else {
                continue;
            };
            let Some(table) = self
                .databases
                .storage_tables(pipeline.database_id)
                .await?
                .into_iter()
                .find(|table| table.table.id == pipeline.table_id)
            else {
                continue;
            };
            let rows = references.iter().map(|r| r.row_id).collect::<Vec<_>>();
            let cells: HashMap<_, _> = self
                .databases
                .storage_row_cells(pipeline.database_id, pipeline.table_id, &rows)
                .await?
                .into_iter()
                .map(|row| (row.row_id, row.cells))
                .collect();
            let shared = Arc::new(AccessiblePipeline {
                pipeline: pipeline.clone(),
                grant: grants[&pipeline.id],
            });
            let columns: Arc<[ColumnDetail]> = table.columns.into();
            entries.extend(references.iter().filter_map(|reference| {
                Some(PipelineEntry {
                    row_id: reference.row_id,
                    record_id: reference.record_id,
                    pipeline: shared.clone(),
                    columns: columns.clone(),
                    cells: cells.get(&reference.row_id)?.clone(),
                })
            }));
        }
        Ok(entries)
    }

    async fn get(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<AccessiblePipeline, PipelineError> {
        let pipeline = self.pipeline(&receipt).await?;
        if pipeline.trashed_at.is_some() {
            return Err(PipelineError::NotFound);
        }
        let grant = match receipt.entity_permission() {
            entity_access::domain::models::EntityPermission::AccessLevel { access_level } => {
                *access_level
            }
            _ => AccessLevel::View,
        };
        Ok(AccessiblePipeline { pipeline, grant })
    }

    async fn stage_requirements(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<StageRequirement>, PipelineError> {
        let pipeline = self.pipeline(&receipt).await?;
        let _guard = self
            .repo
            .lock_live(pipeline.id)
            .await
            .map_err(storage)?
            .ok_or(PipelineError::NotFound)?;
        self.repo
            .stage_requirements(pipeline.id)
            .await
            .map_err(storage)
    }

    #[tracing::instrument(skip_all, fields(pipeline_id = tracing::field::Empty, stage_column_id = %rule.stage_column_id, stage_id = %rule.stage_id), err)]
    async fn set_stage_requirement(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        rule: StageRequirement,
    ) -> Result<(), PipelineError> {
        let pipeline = self.pipeline(&receipt).await?;
        tracing::Span::current().record("pipeline_id", pipeline.id.to_string());
        let _guard = self
            .repo
            .lock_write(pipeline.id)
            .await
            .map_err(storage)?
            .ok_or(PipelineError::NotFound)?;
        let table = self
            .databases
            .storage_tables(pipeline.database_id)
            .await?
            .into_iter()
            .find(|table| table.table.id == pipeline.table_id)
            .ok_or(PipelineError::NotFound)?;
        requirements::validate_rule(&table, &rule)?;
        self.repo
            .set_stage_requirement(pipeline.id, &rule)
            .await
            .map_err(storage)
    }

    async fn rename(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        input: String,
    ) -> Result<(), PipelineError> {
        let name = name(&input)?;
        let pipeline = self.pipeline(&receipt).await?;
        if pipeline.trashed_at.is_some() {
            return Err(PipelineError::NotFound);
        }
        self.repo.rename(pipeline.id, &name).await.map_err(storage)
    }

    async fn share(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        sharing: PipelineSharing,
    ) -> Result<(), PipelineError> {
        let pipeline = self.pipeline(&receipt).await?;
        if pipeline.trashed_at.is_some() {
            return Err(PipelineError::NotFound);
        }
        self.repo.share(&pipeline, sharing).await.map_err(storage)
    }

    async fn share_permissions(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<SharePermissionV2, PipelineError> {
        let pipeline = self.pipeline(&receipt).await?;
        if pipeline.trashed_at.is_some() {
            return Err(PipelineError::NotFound);
        }
        let channels = self
            .repo
            .channel_grants(pipeline.id)
            .await
            .map_err(storage)?;
        Ok(share_permission(&pipeline, channels))
    }

    async fn update_share_permissions(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        request: UpdateSharePermissionRequestV2,
    ) -> Result<SharePermissionV2, PipelineError> {
        let grants = requested_channel_grants(request)?;
        let pipeline = self.pipeline(&receipt).await?;
        if pipeline.trashed_at.is_some()
            || !self
                .repo
                .update_channel_grants(pipeline.id, &grants)
                .await
                .map_err(storage)?
        {
            return Err(PipelineError::NotFound);
        }
        self.share_permissions(receipt).await
    }

    async fn set_trashed(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        trashed: bool,
    ) -> Result<(), PipelineError> {
        let pipeline = self.pipeline(&receipt).await?;
        self.repo
            .set_trashed(pipeline.id, trashed)
            .await
            .map_err(storage)
    }

    #[tracing::instrument(name = "crm.board.positions", skip_all, fields(pipeline_id = %receipt.entity().entity_id, view_id = %view), err)]
    async fn view_positions(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        view: ViewId,
    ) -> Result<Vec<CardPosition>, PipelineError> {
        let pipeline = self.pipeline(&receipt).await?;
        let _guard = self
            .repo
            .lock_live(pipeline.id)
            .await
            .map_err(storage)?
            .ok_or(PipelineError::NotFound)?;
        Ok(self
            .databases
            .storage_view_positions(pipeline.database_id, pipeline.table_id, view)
            .await?)
    }

    async fn table(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<TableDetail, PipelineError> {
        let pipeline = self.pipeline(&receipt).await?;
        let _guard = self
            .repo
            .lock_live(pipeline.id)
            .await
            .map_err(storage)?
            .ok_or(PipelineError::NotFound)?;
        let mut table = self
            .databases
            .storage_tables(pipeline.database_id)
            .await?
            .into_iter()
            .find(|table| table.table.id == pipeline.table_id)
            .ok_or(PipelineError::NotFound)?;
        let editable = matches!(
            receipt.entity_permission(),
            entity_access::domain::models::EntityPermission::AccessLevel {
                access_level: AccessLevel::Edit | AccessLevel::Owner
            }
        );
        for column in &mut table.columns {
            column.writable &= editable;
        }
        Ok(table)
    }

    async fn rows(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        after: Option<RowId>,
    ) -> Result<StorageRows, PipelineError> {
        self.query_rows(
            receipt,
            StorageRowsQuery {
                after,
                ..Default::default()
            },
        )
        .await
    }

    async fn query_rows(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        query: StorageRowsQuery,
    ) -> Result<StorageRows, PipelineError> {
        let pipeline = self.pipeline(&receipt).await?;
        let _guard = self
            .repo
            .lock_live(pipeline.id)
            .await
            .map_err(storage)?
            .ok_or(PipelineError::NotFound)?;
        Ok(self
            .databases
            .storage_rows(pipeline.database_id, pipeline.table_id, query)
            .await?)
    }

    async fn read_rows(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        rows: &[RowId],
    ) -> Result<Vec<StorageRow>, PipelineError> {
        let pipeline = self.pipeline(&receipt).await?;
        let _guard = self
            .repo
            .lock_live(pipeline.id)
            .await
            .map_err(storage)?
            .ok_or(PipelineError::NotFound)?;
        Ok(self
            .databases
            .storage_row_cells(pipeline.database_id, pipeline.table_id, rows)
            .await?)
    }

    async fn record_rows(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        records: &[Uuid],
    ) -> Result<Vec<PipelineReference>, PipelineError> {
        let pipeline = self.pipeline(&receipt).await?;
        if pipeline.trashed_at.is_some() {
            return Err(PipelineError::NotFound);
        }
        // A generic pipeline's primary cells are text, not references.
        if records.is_empty() || pipeline.record_type.is_none() {
            return Ok(Vec::new());
        }
        self.repo
            .referencing_rows(&[pipeline.id], records)
            .await
            .map_err(storage)
    }

    async fn apply_ops(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        acting_bot: Option<BotId>,
        mut batch: OpBatch,
    ) -> Result<AppliedOps, PipelineError> {
        use models_databases::{DatabaseOp, TableChange};
        let pipeline = self.pipeline(&receipt).await?;
        for op in &batch.ops {
            let table = match op {
                DatabaseOp::Rows { table, .. } | DatabaseOp::View { table, .. } => *table,
                DatabaseOp::Column { table, .. } => *table,
                DatabaseOp::Table {
                    table,
                    change: TableChange::ReorderColumns { .. },
                } => *table,
                _ => {
                    return Err(PipelineError::Invalid(
                        "A pipeline has one table; customize its columns and records",
                    ));
                }
            };
            if table != pipeline.table_id {
                return Err(PipelineError::NotFound);
            }
        }
        let viewer = Viewer {
            user_id: actor(&receipt)?,
            acting_bot,
        };
        // A pipeline grant does not grant access to the records it references.
        // The editor may reference records from any team they can access.
        if let Some(record_type) = pipeline.record_type {
            for id in primary_references(&pipeline, record_type, &batch)? {
                self.access
                    .generate_entity_access_receipt::<ViewAccessLevel>(
                        &viewer.user_id,
                        None,
                        &id.to_string(),
                        match record_type {
                            PipelineRecordType::Company => EntityType::CrmCompany,
                            PipelineRecordType::Contact => EntityType::CrmContact,
                        },
                    )
                    .await?;
            }
        }
        let _guard = self
            .repo
            .lock_write(pipeline.id)
            .await
            .map_err(storage)?
            .ok_or(PipelineError::NotFound)?;
        // Insert defaults come first so they can satisfy a stage's required fields.
        // The table read for them also serves the stage rules.
        let mut table = None;
        if pipeline.commercial_fields.has_system_fields() {
            let loaded = self.pipeline_table(&pipeline).await?;
            pipeline.commercial_fields.prepare(&loaded, &mut batch)?;
            table = Some(loaded);
        }
        self.validate_stage_requirements(&pipeline, table, &mut batch)
            .await?;
        Ok(self
            .databases
            .apply_storage_ops(pipeline.database_id, viewer, batch)
            .await?)
    }
}
