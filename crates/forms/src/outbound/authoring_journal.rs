//! Forms-owned operation identity, expiring baselines and atomic settings CAS.
use crate::domain::authoring::{
    journal::{AuthoringJournal, Claim, Operation},
    *,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_forms::{FormId, UpdateForm};
use models_permissions::share_permission::{
    access_level::AccessLevel,
    channel_share_permission::{
        ChannelSharePermission, UpdateChannelSharePermission, UpdateOperation,
    },
};
use sqlx::PgPool;

/// PostgreSQL persistence shared by all authoring tool hosts.
#[derive(Clone)]
pub struct PgAuthoringJournal {
    pool: PgPool,
}
impl PgAuthoringJournal {
    /// Construct at the composition root.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}
fn failed(error: impl std::fmt::Debug) -> AuthoringError {
    tracing::error!(error=?error, "form authoring persistence failed");
    AuthoringError::new(
        Code::Unavailable,
        "operation",
        "Authoring persistence is unavailable; read the operation before retrying a dispatched write.",
    )
}
fn conflict() -> AuthoringError {
    AuthoringError::new(
        Code::ConcurrentFieldChange,
        "access",
        "The form, schema, projection or recipients changed. ReadForm and review the updated proposal.",
    )
}
fn grants(rows: Vec<ChannelSharePermission>) -> Result<Vec<Grant>, AuthoringError> {
    rows.into_iter()
        .map(|r| {
            Ok(Grant {
                channel_id: r.channel_id.parse().map_err(failed)?,
                access: match r.access_level {
                    AccessLevel::Owner | AccessLevel::Edit => GrantAccess::Edit,
                    AccessLevel::View | AccessLevel::Comment => GrantAccess::View,
                },
            })
        })
        .collect()
}
impl AuthoringJournal for PgAuthoringJournal {
    async fn claim(
        &self,
        actor: &MacroUserIdStr<'_>,
        operation: Operation,
    ) -> Result<Claim, AuthoringError> {
        let data = serde_json::to_value(&operation).map_err(failed)?;
        let command = serde_json::to_value(&operation.intent).map_err(failed)?;
        let inserted = sqlx::query!("INSERT INTO form_authoring_operations (user_id, request_id, command, operation) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", actor.as_ref(), operation.intent.request_id().into_uuid(), command, data).execute(&self.pool).await.map_err(failed)?.rows_affected();
        if inserted == 1 {
            return Ok(Claim::New(operation));
        }
        let row = sqlx::query!("SELECT command, operation FROM form_authoring_operations WHERE user_id = $1 AND request_id = $2", actor.as_ref(), operation.intent.request_id().into_uuid()).fetch_one(&self.pool).await.map_err(failed)?;
        if row.command != command {
            return Err(AuthoringError::new(
                Code::IdempotencyConflict,
                "requestId",
                "This requestId already names a different command. Use a new id for a new intended change.",
            ));
        }
        Ok(Claim::Existing(
            serde_json::from_value(row.operation).map_err(failed)?,
        ))
    }
    async fn save(
        &self,
        actor: &MacroUserIdStr<'_>,
        operation: &Operation,
    ) -> Result<(), AuthoringError> {
        let data = serde_json::to_value(operation).map_err(failed)?;
        sqlx::query!("UPDATE form_authoring_operations SET operation = $3, updated_at = now() WHERE user_id = $1 AND request_id = $2", actor.as_ref(), operation.intent.request_id().into_uuid(), data).execute(&self.pool).await.map_err(failed)?;
        Ok(())
    }
    async fn operation(
        &self,
        actor: &MacroUserIdStr<'_>,
        id: AuthoringOperationId,
    ) -> Result<Option<Operation>, AuthoringError> {
        let row = sqlx::query!("SELECT operation FROM form_authoring_operations WHERE user_id = $1 AND request_id = $2", actor.as_ref(), id.into_uuid()).fetch_optional(&self.pool).await.map_err(failed)?;
        row.map(|row| serde_json::from_value(row.operation).map_err(failed))
            .transpose()
    }
    async fn retain(
        &self,
        actor: &MacroUserIdStr<'_>,
        snapshot: &Snapshot,
    ) -> Result<AuthoringRevisionId, AuthoringError> {
        let id = AuthoringRevisionId::new();
        let data = serde_json::to_value(snapshot).map_err(failed)?;
        let mut tx = self.pool.begin().await.map_err(failed)?;
        sqlx::query!(
            "DELETE FROM form_authoring_baselines WHERE user_id = $1 AND expires_at <= now()",
            actor.as_ref()
        )
        .execute(&mut *tx)
        .await
        .map_err(failed)?;
        sqlx::query!("INSERT INTO form_authoring_baselines (user_id, revision_id, form_id, snapshot) VALUES ($1, $2, $3, $4)", actor.as_ref(), id.into_uuid(), snapshot.form.id.into_uuid(), data).execute(&mut *tx).await.map_err(failed)?;
        tx.commit().await.map_err(failed)?;
        Ok(id)
    }
    async fn baseline(
        &self,
        actor: &MacroUserIdStr<'_>,
        form: FormId,
        id: AuthoringRevisionId,
    ) -> Result<Option<Snapshot>, AuthoringError> {
        let row = sqlx::query!("SELECT snapshot FROM form_authoring_baselines WHERE user_id = $1 AND revision_id = $2 AND form_id = $3 AND expires_at > now()", actor.as_ref(), id.into_uuid(), form.into_uuid()).fetch_optional(&self.pool).await.map_err(failed)?;
        row.map(|row| serde_json::from_value(row.snapshot).map_err(failed))
            .transpose()
    }
    async fn grants(&self, form: FormId) -> Result<Vec<Grant>, AuthoringError> {
        grants(
            entity_access_db_utils::get_direct_channel_grants(
                &self.pool,
                form.as_uuid(),
                entity_access_db_utils::EntityType::Form,
            )
            .await
            .map_err(failed)?,
        )
    }
    async fn settings(
        &self,
        expected: &Snapshot,
        update: &UpdateForm,
        changes: &[GrantChange],
        check_grants: bool,
    ) -> Result<(), AuthoringError> {
        let mut tx = self.pool.begin().await.map_err(failed)?;
        // All ordinary sharing writers hold FOR SHARE on this same form row.
        let row = sqlx::query!("SELECT updated_at, layout_revision, table_id FROM forms WHERE id = $1 AND trashed_at IS NULL FOR UPDATE", expected.form.id.into_uuid()).fetch_optional(&mut *tx).await.map_err(failed)?.ok_or_else(conflict)?;
        if row.updated_at != expected.form.updated_at
            || (expected.projected
                && row.layout_revision.as_deref() != Some(expected.revision.as_slice()))
        {
            return Err(conflict());
        }
        let table = sqlx::query!(
            "SELECT version FROM database_tables WHERE id = $1 FOR SHARE",
            row.table_id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failed)?
        .ok_or_else(conflict)?;
        if table.version != expected.table_version {
            return Err(conflict());
        }
        if check_grants {
            let current = grants(
                entity_access_db_utils::get_direct_channel_grants(
                    &mut *tx,
                    expected.form.id.as_uuid(),
                    entity_access_db_utils::EntityType::Form,
                )
                .await
                .map_err(failed)?,
            )?;
            if current != expected.grants {
                return Err(conflict());
            }
        }
        sqlx::query!(r#"UPDATE forms SET description = COALESCE($2, description), confirmation_message = COALESCE($3, confirmation_message), audience = COALESCE($4, audience), status = COALESCE($5, status), closes_at = CASE WHEN $6 THEN $7 ELSE closes_at END, tally_visible = COALESCE($8, tally_visible), updated_at = now() WHERE id = $1"#,
            expected.form.id.into_uuid(), update.description.as_deref(), update.confirmation_message.as_deref(), update.audience.map(<&str>::from), update.status.map(<&str>::from), update.closes_at.is_some(), update.closes_at.flatten(), update.tally_visible).execute(&mut *tx).await.map_err(failed)?;
        let changes = changes
            .iter()
            .map(|g| match g {
                GrantChange::Upsert { channel_id, access } => UpdateChannelSharePermission {
                    operation: UpdateOperation::Replace,
                    channel_id: channel_id.to_string(),
                    access_level: Some(match access {
                        GrantAccess::View => AccessLevel::View,
                        GrantAccess::Edit => AccessLevel::Edit,
                    }),
                },
                GrantChange::Remove { channel_id } => UpdateChannelSharePermission {
                    operation: UpdateOperation::Remove,
                    channel_id: channel_id.to_string(),
                    access_level: None,
                },
            })
            .collect::<Vec<_>>();
        entity_access_db_utils::update_entity_access_channel_share_permissions(
            &mut tx,
            expected.form.id.as_uuid(),
            entity_access_db_utils::EntityType::Form,
            &changes,
        )
        .await
        .map_err(failed)?;
        tx.commit().await.map_err(failed)?;
        Ok(())
    }
}
