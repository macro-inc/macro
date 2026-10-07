//! Company/contact pipelines: CRM policy over reusable database storage.

#[cfg(test)]
mod test;

use super::{auth::CrmTeamReceipt, stages::StageDefinitionStore};
use chrono::{DateTime, Utc};
use databases::domain::{
    models::{
        AppliedOps, ColumnId, ColumnProtection, DatabaseId, OpBatch, RowId, TableDetail, TableId,
        Viewer,
    },
    provisioning::{ProvisionedColumn, StorageBlueprint},
    storage::{DatabaseStorageService, StorageRows, StorageRowsQuery},
};
use entity_access::domain::{
    models::{
        AccessLevel, EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, EntityType,
        MemberTeamRole, OwnerAccessLevel, RequiredPermission, ViewAccessLevel,
    },
    ports::{AccessiblePipelines, EntityAccessService},
};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::{DataType, EntityType as PropertyEntityType};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use uuid::Uuid;

/// Which CRM entity each row references. Fixed when a pipeline is created.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
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

/// Request to create an empty pipeline with the standard CRM columns.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreatePipeline {
    /// Pipeline name.
    pub name: String,
    /// Company or contact entries.
    pub record_type: PipelineRecordType,
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
    /// Kind of the primary reference.
    pub record_type: PipelineRecordType,
    /// Dedicated backing database.
    #[schema(value_type = Uuid)]
    pub database_id: DatabaseId,
    /// Table of entries.
    #[schema(value_type = Uuid)]
    pub table_id: TableId,
    /// Protected primary column.
    #[schema(value_type = Uuid)]
    pub primary_column_id: ColumnId,
    /// Whether the pipeline has a team grant.
    pub sharing: PipelineSharing,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Trashed pipelines are omitted from navigation.
    #[schema(required = true)]
    pub trashed_at: Option<DateTime<Utc>>,
}

/// Metadata together with the caller's effective grant.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AccessiblePipeline {
    /// Pipeline metadata.
    #[serde(flatten)]
    pub pipeline: Pipeline,
    /// Highest effective access.
    pub grant: AccessLevel,
}

/// All records needed for atomic provisioning.
pub struct PipelineBlueprint {
    /// Pipeline identity.
    pub id: Uuid,
    /// CRM team.
    pub team_id: Uuid,
    /// Primary reference kind.
    pub record_type: PipelineRecordType,
    /// Initial grants.
    pub sharing: PipelineSharing,
    /// Schema owned by the database domain.
    pub database: StorageBlueprint,
    /// Pipeline-owned display name.
    pub name: String,
    /// Initial owner.
    pub creator: MacroUserIdStr<'static>,
    /// Protected company/contact reference.
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
}

/// Pipeline use cases for HTTP and other driving adapters.
pub trait PipelineService: Send + Sync + 'static {
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

    /// Validate pipeline policy, then use the shared storage operation planner.
    fn apply_ops(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        batch: OpBatch,
    ) -> impl Future<Output = Result<AppliedOps, PipelineError>> + Send;
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

/// Build the common CRM schema without performing I/O. Callers validate the name.
pub(crate) fn pipeline_blueprint(
    team_id: Uuid,
    creator: MacroUserIdStr<'static>,
    input: CreatePipeline,
    labels: Vec<String>,
) -> PipelineBlueprint {
    let id = macro_uuid::generate_uuid_v7();
    let primary_column_id = ColumnId::new();
    let primary = ProvisionedColumn {
        id: primary_column_id,
        name: match input.record_type {
            PipelineRecordType::Company => "Company",
            PipelineRecordType::Contact => "Contact",
        }
        .into(),
        data_type: DataType::Entity,
        entity_type: Some(input.record_type.property_type()),
        options: vec![],
        nullable: false,
        protections: vec![ColumnProtection::Delete, ColumnProtection::ChangeType],
    };
    let columns = vec![
        primary,
        ProvisionedColumn {
            id: ColumnId::new(),
            nullable: true,
            protections: vec![],
            name: "Stage".into(),
            data_type: DataType::SelectString,
            entity_type: None,
            options: labels
                .into_iter()
                .map(|label| {
                    (
                        macro_uuid::generate_uuid_v7(),
                        PropertyOptionValue::String(label),
                    )
                })
                .collect(),
        },
        ProvisionedColumn {
            id: ColumnId::new(),
            nullable: true,
            protections: vec![],
            name: "Owner".into(),
            data_type: DataType::Entity,
            entity_type: Some(PropertyEntityType::User),
            options: vec![],
        },
        ProvisionedColumn {
            id: ColumnId::new(),
            nullable: true,
            protections: vec![],
            name: "Revenue".into(),
            data_type: DataType::Number,
            entity_type: None,
            options: vec![],
        },
    ];
    PipelineBlueprint {
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
        let stages = self.stages.get_team_stage_set(&team).await?;
        let labels = stages
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
            });
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

    async fn apply_ops(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        batch: OpBatch,
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
            acting_bot: None,
        };
        // A pipeline grant does not grant access to the records it references.
        // The editor may reference records from any team they can access.
        for id in primary_references(&pipeline, &batch)? {
            self.access
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    &viewer.user_id,
                    None,
                    &id.to_string(),
                    match pipeline.record_type {
                        PipelineRecordType::Company => EntityType::CrmCompany,
                        PipelineRecordType::Contact => EntityType::CrmContact,
                    },
                )
                .await?;
        }
        let _guard = self
            .repo
            .lock_live(pipeline.id)
            .await
            .map_err(storage)?
            .ok_or(PipelineError::NotFound)?;
        Ok(self
            .databases
            .apply_storage_ops(pipeline.database_id, viewer, batch)
            .await?)
    }
}

/// Distinct primary records explicitly written by this batch. Other cells and
/// unchanged references do not require the editor to reselect the record.
fn primary_references(
    pipeline: &Pipeline,
    batch: &OpBatch,
) -> Result<std::collections::BTreeSet<Uuid>, PipelineError> {
    use models_databases::{CellValue, CellWrite, DatabaseOp, RowChanges, RowsChange};
    let mut references = std::collections::BTreeSet::new();
    for op in &batch.ops {
        let cells: Vec<&CellWrite> = match op {
            DatabaseOp::Rows {
                change: RowsChange::Insert { rows },
                ..
            } => rows.iter().flatten().collect(),
            DatabaseOp::Rows {
                change:
                    RowsChange::Update {
                        changes: RowChanges::Uniform { cells, .. },
                    },
                ..
            } => cells.iter().collect(),
            DatabaseOp::Rows {
                change:
                    RowsChange::Update {
                        changes: RowChanges::PerRow { rows },
                    },
                ..
            } => rows.iter().flat_map(|row| &row.cells).collect(),
            _ => continue,
        };
        for cell in cells {
            if cell.column != pipeline.primary_column_id {
                continue;
            }
            if let CellValue::Entities(values) = &cell.value {
                for value in values {
                    let expected = match pipeline.record_type {
                        PipelineRecordType::Company => models_databases::EntityKind::Company,
                        PipelineRecordType::Contact => models_databases::EntityKind::Contact,
                    };
                    if value.entity_type != expected {
                        return Err(PipelineError::Invalid(
                            "Choose the required CRM record type",
                        ));
                    }
                    references.insert(
                        value
                            .entity_id
                            .parse()
                            .map_err(|_| PipelineError::Invalid("Choose a valid CRM record"))?,
                    );
                }
            }
        }
    }
    Ok(references)
}
