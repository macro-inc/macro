//! Pipeline metadata and grants, composed with the database domain's writer.

use crate::domain::pipeline_commercial::CommercialFields;
use crate::domain::pipelines::requirements::StageRequirement;
use crate::domain::pipelines::{
    Pipeline, PipelineBlueprint, PipelineRecordType, PipelineReference, PipelineRepo,
    PipelineSharing,
};
use chrono::{DateTime, Utc};
use databases::domain::provisioning::DatabaseStorageProvisioner;
use entity_access::domain::telemetry::span_count;
use entity_access_db_utils::{AccessLevel, EntityAccessSourceType, EntityType};
use models_databases::OptionId;
use models_databases::{ColumnId, DatabaseId, RowId, TableId};
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission,
};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

/// Pipeline persistence errors.
#[derive(Debug, thiserror::Error)]
pub enum PipelineRepoError {
    /// SQL failure rolls back the entire operation.
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    /// Database provisioning failure.
    #[error("Database provisioning failed: {0}")]
    Database(#[source] Box<dyn std::error::Error + Send + Sync>),
}

/// A pipeline as `get_many` and `lock_live_many` read it.
struct PipelineRow {
    id: Uuid,
    team_id: Uuid,
    record_type: Option<String>,
    database_id: Uuid,
    table_id: Uuid,
    name: String,
    user_id: String,
    created_at: DateTime<Utc>,
    trashed_at: Option<DateTime<Utc>>,
    primary_column_id: Uuid,
    commercial_fields: sqlx::types::Json<CommercialFields>,
    team_shared: bool,
}

impl TryFrom<PipelineRow> for Pipeline {
    type Error = PipelineRepoError;

    fn try_from(row: PipelineRow) -> Result<Self, Self::Error> {
        let record_type = match row.record_type.as_deref() {
            None => None,
            Some("company") => Some(PipelineRecordType::Company),
            Some("contact") => Some(PipelineRecordType::Contact),
            Some(_) => {
                return Err(sqlx::Error::Decode("Invalid pipeline record type".into()).into());
            }
        };
        Ok(Pipeline {
            commercial_fields: row.commercial_fields.0,
            id: row.id,
            team_id: row.team_id,
            name: row.name,
            user_id: row.user_id,
            record_type,
            database_id: DatabaseId::from_uuid(row.database_id),
            table_id: TableId::from_uuid(row.table_id),
            primary_column_id: ColumnId::from_uuid(row.primary_column_id),
            created_at: row.created_at,
            trashed_at: row.trashed_at,
            sharing: if row.team_shared {
                PipelineSharing::Team
            } else {
                PipelineSharing::Private
            },
        })
    }
}

/// Owns only CRM metadata; database storage is accessed through its domain port.
pub struct PgPipelineRepo<Database> {
    pool: PgPool,
    database: Database,
}

impl<Database> PgPipelineRepo<Database> {
    /// Construct at the application's composition root.
    pub fn new(pool: PgPool, database: Database) -> Self {
        Self { pool, database }
    }
}

impl<Database> PgPipelineRepo<Database>
where
    Database: DatabaseStorageProvisioner<Transaction = Transaction<'static, Postgres>>,
{
    async fn create_in(
        &self,
        transaction: &mut Transaction<'static, Postgres>,
        blueprint: &PipelineBlueprint,
    ) -> Result<(), PipelineRepoError> {
        self.database
            .create_storage_in(transaction, &blueprint.database)
            .await
            .map_err(|error| PipelineRepoError::Database(Box::new(error)))?;
        sqlx::query!(
            "INSERT INTO crm_pipeline_entities (id, team_id, database_id, table_id, record_type, name, user_id, primary_column_id, commercial_fields) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
            blueprint.id, blueprint.team_id, blueprint.database.id.into_uuid(),
            blueprint.database.table_id.into_uuid(), blueprint.record_type.map(PipelineRecordType::as_str), &blueprint.name, blueprint.creator.as_ref(), blueprint.primary_column_id.into_uuid(),
            sqlx::types::Json(&blueprint.commercial_fields) as _,
        ).execute(&mut **transaction).await?;
        entity_access_db_utils::insert_entity_access_row(
            transaction,
            &blueprint.id,
            EntityType::CrmPipeline,
            blueprint.creator.as_ref(),
            EntityAccessSourceType::User,
            AccessLevel::Owner,
        )
        .await?;
        if blueprint.sharing == PipelineSharing::Team {
            entity_access_db_utils::team_share::upsert_direct(
                transaction,
                &blueprint.id,
                EntityType::CrmPipeline,
                blueprint.team_id,
                AccessLevel::Edit,
            )
            .await?;
        }
        Ok(())
    }
}

impl<Database> PipelineRepo for PgPipelineRepo<Database>
where
    Database: DatabaseStorageProvisioner<Transaction = Transaction<'static, Postgres>>,
{
    type Error = PipelineRepoError;

    async fn crm_enabled(&self, team: Uuid) -> Result<bool, Self::Error> {
        Ok(
            sqlx::query_scalar!(r#"SELECT TRUE AS "enabled!" FROM team WHERE id = $1"#, team)
                .fetch_optional(&self.pool)
                .await?
                .unwrap_or(false),
        )
    }

    async fn get_many(&self, ids: &[Uuid]) -> Result<Vec<Pipeline>, Self::Error> {
        sqlx::query_as!(
            PipelineRow,
            r#"SELECT p.id, p.team_id, p.record_type, p.database_id, p.table_id,
                      p.name, p.user_id, p.created_at, p.trashed_at, p.primary_column_id,
                      p.commercial_fields AS "commercial_fields!: sqlx::types::Json<CommercialFields>",
                      EXISTS (SELECT 1 FROM entity_access ea WHERE ea.entity_id = p.id
                        AND ea.entity_type = 'crm_pipeline' AND ea.source_type = 'team'
                        AND ea.source_id = p.team_id::text) AS "team_shared!"
               FROM crm_pipeline_entities p
               WHERE p.id = ANY($1) ORDER BY p.id"#,
            ids,
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(Pipeline::try_from)
        .collect()
    }

    #[tracing::instrument(skip_all, err, fields(records = span_count(records.len())))]
    async fn referencing_rows(
        &self,
        record_type: PipelineRecordType,
        records: &[Uuid],
        pipeline: Option<Uuid>,
    ) -> Result<Vec<PipelineReference>, Self::Error> {
        let mut records = records.to_vec();
        records.sort_unstable();
        records.dedup();
        // Starts from the records' references, so this reads only the cells
        // that hold one: the partial index needs the literal predicates on
        // `ep`, and the row is joined by the guarded cast, not by `r.id::text`.
        // The CTE stays materialized: a generic plan estimates one pipeline
        // for `$2`/`$3` and would otherwise probe the references once per
        // pipeline. Only a primary cell counts, so an entry's other reference
        // columns, and other databases' rows, are left out.
        let rows = sqlx::query!(
            r#"WITH reference AS MATERIALIZED (
                   SELECT record.id AS record_id, r.id AS row_id, r.table_id, r.position,
                          ep.property_definition_id
                   FROM UNNEST($1::uuid[]) AS record(id)
                   JOIN entity_properties ep
                     ON ep.entity_type = 'DATABASE_ROW'
                    AND ep.values ->> 'type' = 'EntityReference'
                    AND ep.values -> 'value' @> jsonb_build_array(jsonb_build_object('entity_id', record.id::text))
                   -- A row cell's entity id is its row id's canonical text;
                   -- anything else names no row, and must not abort the statement.
                   JOIN database_rows r
                     ON r.id = (CASE
                         WHEN ep.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         THEN ep.entity_id
                     END)::uuid
               )
               SELECT p.id AS "pipeline_id!", reference.row_id AS "row_id!",
                      reference.record_id AS "record_id!"
               FROM reference
               JOIN crm_pipeline_entities p ON p.table_id = reference.table_id
               JOIN database_columns c
                 ON c.id = p.primary_column_id
                AND c.property_definition_id = reference.property_definition_id
               WHERE p.record_type = $2 AND p.trashed_at IS NULL
                 AND ($3::uuid IS NULL OR p.id = $3)
               ORDER BY p.id, reference.position, reference.row_id"#,
            &records,
            record_type.as_str(),
            pipeline,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| PipelineReference {
                pipeline_id: row.pipeline_id,
                row_id: RowId::from_uuid(row.row_id),
                record_id: row.record_id,
            })
            .collect())
    }

    type Guard = Transaction<'static, Postgres>;

    #[tracing::instrument(skip_all, err, fields(pipelines = span_count(ids.len())))]
    async fn lock_live_many(
        &self,
        ids: &[Uuid],
    ) -> Result<(Self::Guard, Vec<Pipeline>), Self::Error> {
        let mut tx = self.pool.begin().await?;
        // Readers queued behind a writer also need to release pool connections.
        sqlx::query!("SET LOCAL lock_timeout = '5s'")
            .execute(&mut *tx)
            .await?;
        // Rows lock in id order, as the sort runs before the lock.
        let pipelines = sqlx::query_as!(
            PipelineRow,
            r#"SELECT p.id, p.team_id, p.record_type, p.database_id, p.table_id,
                      p.name, p.user_id, p.created_at, p.trashed_at, p.primary_column_id,
                      p.commercial_fields AS "commercial_fields!: sqlx::types::Json<CommercialFields>",
                      EXISTS (SELECT 1 FROM entity_access ea WHERE ea.entity_id = p.id
                        AND ea.entity_type = 'crm_pipeline' AND ea.source_type = 'team'
                        AND ea.source_id = p.team_id::text) AS "team_shared!"
               FROM crm_pipeline_entities p
               WHERE p.id = ANY($1) AND p.trashed_at IS NULL
               ORDER BY p.id
               FOR SHARE OF p"#,
            ids,
        )
        .fetch_all(&mut *tx)
        .await?
        .into_iter()
        .map(Pipeline::try_from)
        .collect::<Result<_, _>>()?;
        Ok((tx, pipelines))
    }

    async fn lock_live(&self, id: Uuid) -> Result<Option<Self::Guard>, Self::Error> {
        let mut tx = self.pool.begin().await?;
        // Readers queued behind a writer also need to release pool connections.
        sqlx::query!("SET LOCAL lock_timeout = '5s'")
            .execute(&mut *tx)
            .await?;
        let row = sqlx::query!(
            "SELECT id FROM crm_pipeline_entities WHERE id = $1 AND trashed_at IS NULL FOR SHARE",
            id
        )
        .fetch_optional(&mut *tx)
        .await?;
        Ok(row.map(|_| tx))
    }

    async fn lock_write(&self, id: Uuid) -> Result<Option<Self::Guard>, Self::Error> {
        let mut tx = self.pool.begin().await?;
        // Queued writers must release connections so the holder can use storage.
        sqlx::query!("SET LOCAL lock_timeout = '5s'")
            .execute(&mut *tx)
            .await?;
        // Allows foreign-key checks from the storage transaction while serializing
        // all pipeline writers and holding the pipeline against trash/deletion.
        let row = sqlx::query!("SELECT id FROM crm_pipeline_entities WHERE id = $1 AND trashed_at IS NULL FOR NO KEY UPDATE", id).fetch_optional(&mut *tx).await?;
        Ok(row.map(|_| tx))
    }

    async fn stage_requirements(&self, id: Uuid) -> Result<Vec<StageRequirement>, Self::Error> {
        let rows = sqlx::query!("SELECT stage_column_id, stage_id, required_column_id FROM crm_pipeline_stage_requirements WHERE pipeline_id = $1 ORDER BY stage_column_id, stage_id, required_column_id", id).fetch_all(&self.pool).await?;
        let mut rules = Vec::new();
        for group in
            rows.chunk_by(|a, b| a.stage_column_id == b.stage_column_id && a.stage_id == b.stage_id)
        {
            rules.push(StageRequirement {
                stage_column_id: ColumnId::from_uuid(group[0].stage_column_id),
                stage_id: OptionId::from_uuid(group[0].stage_id),
                required_column_ids: group
                    .iter()
                    .map(|row| ColumnId::from_uuid(row.required_column_id))
                    .collect(),
            });
        }
        Ok(rules)
    }

    async fn set_stage_requirement(
        &self,
        id: Uuid,
        rule: &StageRequirement,
    ) -> Result<(), Self::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query!("DELETE FROM crm_pipeline_stage_requirements WHERE pipeline_id = $1 AND stage_column_id = $2 AND stage_id = $3", id, rule.stage_column_id.into_uuid(), rule.stage_id.into_uuid()).execute(&mut *tx).await?;
        let fields: Vec<_> = rule
            .required_column_ids
            .iter()
            .map(|id| id.into_uuid())
            .collect();
        sqlx::query!("INSERT INTO crm_pipeline_stage_requirements (pipeline_id, stage_column_id, stage_id, required_column_id) SELECT $1, $2, $3, unnest($4::uuid[]) ON CONFLICT DO NOTHING", id, rule.stage_column_id.into_uuid(), rule.stage_id.into_uuid(), &fields).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }

    async fn rename(&self, id: Uuid, name: &str) -> Result<(), Self::Error> {
        sqlx::query!("UPDATE crm_pipeline_entities SET name = $2, updated_at = now() WHERE id = $1 AND trashed_at IS NULL", id, name)
            .execute(&self.pool).await?;
        Ok(())
    }

    async fn set_trashed(&self, id: Uuid, trashed: bool) -> Result<(), Self::Error> {
        sqlx::query!("UPDATE crm_pipeline_entities SET trashed_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now() WHERE id = $1", id, trashed)
            .execute(&self.pool).await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn create(&self, blueprint: &PipelineBlueprint) -> Result<(), Self::Error> {
        let mut transaction = self.pool.begin().await?;
        entity_access_db_utils::team_share::acquire_guard(&mut transaction).await?;
        self.create_in(&mut transaction, blueprint).await?;
        transaction.commit().await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn share(
        &self,
        pipeline: &Pipeline,
        sharing: PipelineSharing,
    ) -> Result<(), Self::Error> {
        let mut transaction = self.pool.begin().await?;
        entity_access_db_utils::team_share::acquire_guard(&mut transaction).await?;
        // Serialize sharing with pipeline deletion.
        sqlx::query!(
            "SELECT id FROM crm_pipeline_entities WHERE id = $1 FOR UPDATE",
            pipeline.id
        )
        .fetch_one(&mut *transaction)
        .await?;
        match sharing {
            PipelineSharing::Team => {
                entity_access_db_utils::team_share::upsert_direct(
                    &mut transaction,
                    &pipeline.id,
                    EntityType::CrmPipeline,
                    pipeline.team_id,
                    AccessLevel::Edit,
                )
                .await?
            }
            PipelineSharing::Private => {
                entity_access_db_utils::team_share::delete_direct(
                    &mut transaction,
                    &pipeline.id,
                    EntityType::CrmPipeline,
                    pipeline.team_id,
                )
                .await?
            }
        }
        transaction.commit().await?;
        Ok(())
    }

    async fn channel_grants(&self, id: Uuid) -> Result<Vec<ChannelSharePermission>, Self::Error> {
        Ok(entity_access_db_utils::get_direct_channel_grants(
            &self.pool,
            &id,
            EntityType::CrmPipeline,
        )
        .await?)
    }

    #[tracing::instrument(skip_all, err)]
    async fn update_channel_grants(
        &self,
        id: Uuid,
        grants: &[UpdateChannelSharePermission],
    ) -> Result<bool, Self::Error> {
        // The live lock serializes sharing with trash and deletion.
        let Some(mut transaction) = self.lock_live(id).await? else {
            return Ok(false);
        };
        entity_access_db_utils::update_entity_access_channel_share_permissions(
            &mut transaction,
            &id,
            EntityType::CrmPipeline,
            grants,
        )
        .await?;
        transaction.commit().await?;
        Ok(true)
    }
}

impl<Database: Send + Sync> crate::domain::auth::CrmMemberAccess for PgPipelineRepo<Database> {
    async fn member_has_crm_access(
        &self,
        team_id: Uuid,
        user_id: &str,
    ) -> Result<bool, crate::domain::model::CrmError> {
        super::member_access::member_has_crm_access(&self.pool, team_id, user_id).await
    }
}
