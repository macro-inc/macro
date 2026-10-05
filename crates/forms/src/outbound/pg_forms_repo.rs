//! Postgres persistence for forms, their layouts and the submission ledger.
//! A form's grants are `entity_access` rows written through the owning
//! access crate's helpers.

mod layout;
mod ledger;
mod sharing;
#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use entity_access_db_utils::{AccessLevel, EntityAccessSourceType};
use model_entity::EntityType;
use models_databases::position::PositionError;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{
    Audience, ColumnId, DatabaseId, ForbiddenWidget, Form, FormId, FormLayout, FormStatus,
    FormUpdate, LayoutReplacement, StoredForm, TableId, UpdateForm,
};

/// Errors from the Postgres repository.
#[derive(Debug, thiserror::Error)]
pub enum PgFormsRepoError {
    /// Underlying database failure.
    #[error("database error")]
    Sqlx(#[from] sqlx::Error),
    /// A gate's rules could not be encoded as JSON for storage, or stored
    /// ones decoded.
    #[error("failed to encode or decode stored gate rules")]
    Json(#[from] serde_json::Error),
    /// Positions could not be minted for a layout.
    #[error("layout position")]
    Position(#[from] PositionError),
    /// A stored text names no value of its kind.
    #[error("stored {kind} `{value}` is not one the forms domain writes")]
    Corrupt {
        /// What the text should name.
        kind: &'static str,
        /// The text.
        value: String,
    },
}

/// The forms repository over a Postgres pool.
#[derive(Debug, Clone)]
pub struct PgFormsRepo {
    pool: PgPool,
}

impl PgFormsRepo {
    /// A repository over `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// The UUIDs of typed ids, for a statement's `ANY($n)`.
fn uuids<Id: Copy + Into<Uuid>>(ids: &[Id]) -> Vec<Uuid> {
    ids.iter().map(|id| (*id).into()).collect()
}

/// A stored text parsed as the enum it names.
fn parsed<Value: std::str::FromStr>(
    kind: &'static str,
    value: &str,
) -> Result<Value, PgFormsRepoError> {
    value.parse().map_err(|_| PgFormsRepoError::Corrupt {
        kind,
        value: value.to_string(),
    })
}

/// One `forms` row as stored.
struct FormRow {
    id: Uuid,
    name: String,
    description: String,
    owner_id: String,
    database_id: Uuid,
    table_id: Uuid,
    submitted_column_id: Option<Uuid>,
    respondent_column_id: Option<Uuid>,
    audience: String,
    tally_visible: bool,
    status: String,
    closes_at: Option<DateTime<Utc>>,
    confirmation_message: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    trashed_at: Option<DateTime<Utc>>,
}

impl TryFrom<FormRow> for StoredForm {
    type Error = PgFormsRepoError;

    fn try_from(row: FormRow) -> Result<Self, Self::Error> {
        Ok(StoredForm {
            form: Form {
                id: FormId::from_uuid(row.id),
                name: row.name,
                description: row.description,
                owner_id: row.owner_id,
                database_id: DatabaseId::from_uuid(row.database_id),
                table_id: TableId::from_uuid(row.table_id),
                submitted_column_id: row.submitted_column_id.map(ColumnId::from_uuid),
                respondent_column_id: row.respondent_column_id.map(ColumnId::from_uuid),
                audience: parsed::<Audience>("audience", &row.audience)?,
                tally_visible: row.tally_visible,
                status: parsed::<FormStatus>("status", &row.status)?,
                closes_at: row.closes_at,
                confirmation_message: row.confirmation_message,
                created_at: row.created_at,
                updated_at: row.updated_at,
            },
            trashed_at: row.trashed_at,
        })
    }
}

/// Lock a live form's row for the rest of the transaction, answering its
/// audience; `None` when it is gone or trashed.
async fn locked_audience(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id: FormId,
) -> Result<Option<Audience>, PgFormsRepoError> {
    sqlx::query_scalar!(
        "SELECT audience FROM forms WHERE id = $1 AND trashed_at IS NULL FOR UPDATE",
        id.into_uuid(),
    )
    .fetch_optional(&mut **transaction)
    .await?
    .map(|audience| parsed::<Audience>("audience", &audience))
    .transpose()
}

fn live_forms(rows: Vec<FormRow>) -> Result<Vec<Form>, PgFormsRepoError> {
    rows.into_iter()
        .map(|row| StoredForm::try_from(row).map(|stored| stored.form))
        .collect()
}

impl crate::domain::ports::FormsRepo for PgFormsRepo {
    type Error = PgFormsRepoError;

    #[tracing::instrument(err, skip(self, form, layout), fields(form_id = %form.id))]
    async fn create_form(&self, form: &Form, layout: &FormLayout) -> Result<(), Self::Error> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query!(
            r#"
            INSERT INTO forms (
                id, name, description, owner_id, database_id, table_id,
                submitted_column_id, respondent_column_id, audience, tally_visible,
                status, closes_at, confirmation_message, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            "#,
            form.id.into_uuid(),
            form.name,
            form.description,
            form.owner_id,
            form.database_id.into_uuid(),
            form.table_id.into_uuid(),
            form.submitted_column_id.map(ColumnId::into_uuid),
            form.respondent_column_id.map(ColumnId::into_uuid),
            <&str>::from(form.audience),
            form.tally_visible,
            <&str>::from(form.status),
            form.closes_at,
            form.confirmation_message,
            form.created_at,
            form.updated_at,
        )
        .execute(&mut *transaction)
        .await?;
        layout::insert(&mut transaction, form.id, layout).await?;
        entity_access_db_utils::insert_entity_access_row(
            &mut transaction,
            form.id.as_uuid(),
            EntityType::Form,
            &form.owner_id,
            EntityAccessSourceType::User,
            AccessLevel::Owner,
        )
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn form(&self, id: FormId) -> Result<Option<StoredForm>, Self::Error> {
        sqlx::query_as!(
            FormRow,
            r#"
            SELECT id, name, description, owner_id, database_id, table_id,
                   submitted_column_id, respondent_column_id, audience, tally_visible,
                   status, closes_at, confirmation_message, created_at, updated_at, trashed_at
            FROM forms WHERE id = $1
            "#,
            id.into_uuid(),
        )
        .fetch_optional(&self.pool)
        .await?
        .map(StoredForm::try_from)
        .transpose()
    }

    #[tracing::instrument(err, skip(self, ids), fields(ids = ids.len()))]
    async fn forms_by_ids(&self, ids: &[FormId]) -> Result<Vec<Form>, Self::Error> {
        live_forms(
            sqlx::query_as!(
                FormRow,
                r#"
                SELECT id, name, description, owner_id, database_id, table_id,
                       submitted_column_id, respondent_column_id, audience, tally_visible,
                       status, closes_at, confirmation_message, created_at, updated_at, trashed_at
                FROM forms WHERE id = ANY($1) AND trashed_at IS NULL
                ORDER BY id
                "#,
                &uuids(ids),
            )
            .fetch_all(&self.pool)
            .await?,
        )
    }

    #[tracing::instrument(err, skip(self))]
    async fn forms_for_database(&self, database_id: DatabaseId) -> Result<Vec<Form>, Self::Error> {
        live_forms(
            sqlx::query_as!(
                FormRow,
                r#"
                SELECT id, name, description, owner_id, database_id, table_id,
                       submitted_column_id, respondent_column_id, audience, tally_visible,
                       status, closes_at, confirmation_message, created_at, updated_at, trashed_at
                FROM forms WHERE database_id = $1 AND trashed_at IS NULL
                ORDER BY created_at, id
                "#,
                database_id.into_uuid(),
            )
            .fetch_all(&self.pool)
            .await?,
        )
    }

    #[tracing::instrument(err, skip(self))]
    async fn layout(&self, id: FormId) -> Result<FormLayout, Self::Error> {
        layout::read(&self.pool, id).await
    }

    #[tracing::instrument(err, skip(self, layout))]
    async fn replace_layout(
        &self,
        id: FormId,
        layout: &FormLayout,
        updated_at: DateTime<Utc>,
        required_audience: Option<Audience>,
    ) -> Result<LayoutReplacement, Self::Error> {
        let mut transaction = self.pool.begin().await?;
        // The form's row lock serializes this with a change of its facts, so
        // the audience read here is the one the layout commits under.
        let Some(audience) = locked_audience(&mut transaction, id).await? else {
            transaction.rollback().await?;
            return Ok(LayoutReplacement::FormGone);
        };
        if required_audience.is_some_and(|required| required != audience) {
            transaction.rollback().await?;
            return Ok(LayoutReplacement::AudienceChanged);
        }
        if let Some(taken) = layout::id_of_another_form(&mut *transaction, id, layout).await? {
            transaction.rollback().await?;
            return Ok(LayoutReplacement::IdTaken(taken));
        }
        sqlx::query!(
            "UPDATE forms SET updated_at = $2 WHERE id = $1",
            id.into_uuid(),
            updated_at,
        )
        .execute(&mut *transaction)
        .await?;
        sqlx::query!(
            "DELETE FROM form_sections WHERE form_id = $1",
            id.into_uuid()
        )
        .execute(&mut *transaction)
        .await?;
        match layout::insert(&mut transaction, id, layout).await {
            Ok(()) => {}
            // Another form took one of the ids after the lookup above and
            // committed first: name it now that it is visible.
            Err(PgFormsRepoError::Sqlx(error)) if layout::is_layout_key_taken(&error) => {
                transaction.rollback().await?;
                return match layout::id_of_another_form(&self.pool, id, layout).await? {
                    Some(taken) => Ok(LayoutReplacement::IdTaken(taken)),
                    None => Err(PgFormsRepoError::Sqlx(error)),
                };
            }
            Err(error) => return Err(error),
        }
        transaction.commit().await?;
        Ok(LayoutReplacement::Replaced)
    }

    #[tracing::instrument(err, skip(self, changes))]
    async fn update_form(
        &self,
        id: FormId,
        changes: &UpdateForm,
        updated_at: DateTime<Utc>,
        forbidden_widget: Option<ForbiddenWidget>,
    ) -> Result<FormUpdate, Self::Error> {
        let mut transaction = self.pool.begin().await?;
        // The form's row lock serializes this with a layout put, so the
        // questions read here are the ones the change commits under.
        if locked_audience(&mut transaction, id).await?.is_none() {
            transaction.rollback().await?;
            return Ok(FormUpdate::FormGone);
        }
        if let Some(forbidden) = forbidden_widget {
            let in_use = sqlx::query_scalar!(
                r#"
                SELECT EXISTS (
                    SELECT 1 FROM form_questions
                    WHERE form_id = $1 AND widget = $2 AND column_id = ANY($3)
                ) AS "in_use!"
                "#,
                id.into_uuid(),
                forbidden.widget.name(),
                &uuids(&forbidden.columns),
            )
            .fetch_one(&mut *transaction)
            .await?;
            if in_use {
                transaction.rollback().await?;
                return Ok(FormUpdate::WidgetInUse);
            }
        }
        let updated = sqlx::query_as!(
            FormRow,
            r#"
            UPDATE forms SET
                description = COALESCE($2, description),
                confirmation_message = COALESCE($3, confirmation_message),
                audience = COALESCE($4, audience),
                status = COALESCE($5, status),
                closes_at = CASE WHEN $6 THEN $7 ELSE closes_at END,
                tally_visible = COALESCE($8, tally_visible),
                updated_at = $9
            WHERE id = $1
            RETURNING id, name, description, owner_id, database_id, table_id,
                      submitted_column_id, respondent_column_id, audience, tally_visible,
                      status, closes_at, confirmation_message, created_at, updated_at, trashed_at
            "#,
            id.into_uuid(),
            changes.description.as_deref(),
            changes.confirmation_message.as_deref(),
            changes.audience.map(<&str>::from),
            changes.status.map(<&str>::from),
            changes.closes_at.is_some(),
            changes.closes_at.flatten(),
            changes.tally_visible,
            updated_at,
        )
        .fetch_one(&mut *transaction)
        .await?;
        let form = StoredForm::try_from(updated)?.form;
        transaction.commit().await?;
        Ok(FormUpdate::Updated(Box::new(form)))
    }

    #[tracing::instrument(err, skip(self))]
    async fn rename_form(
        &self,
        id: FormId,
        name: &str,
        updated_at: DateTime<Utc>,
    ) -> Result<Option<Form>, Self::Error> {
        sqlx::query_as!(
            FormRow,
            r#"
            UPDATE forms SET name = $2, updated_at = $3
            WHERE id = $1 AND trashed_at IS NULL
            RETURNING id, name, description, owner_id, database_id, table_id,
                      submitted_column_id, respondent_column_id, audience, tally_visible,
                      status, closes_at, confirmation_message, created_at, updated_at, trashed_at
            "#,
            id.into_uuid(),
            name,
            updated_at,
        )
        .fetch_optional(&self.pool)
        .await?
        .map(|row| StoredForm::try_from(row).map(|stored| stored.form))
        .transpose()
    }

    #[tracing::instrument(err, skip(self))]
    async fn trash_form(&self, id: FormId, trashed_at: DateTime<Utc>) -> Result<bool, Self::Error> {
        Ok(sqlx::query!(
            "UPDATE forms SET trashed_at = COALESCE(trashed_at, $2) WHERE id = $1",
            id.into_uuid(),
            trashed_at,
        )
        .execute(&self.pool)
        .await?
        .rows_affected()
            > 0)
    }

    #[tracing::instrument(err, skip(self))]
    async fn restore_form(&self, id: FormId) -> Result<bool, Self::Error> {
        Ok(sqlx::query!(
            "UPDATE forms SET trashed_at = NULL WHERE id = $1",
            id.into_uuid(),
        )
        .execute(&self.pool)
        .await?
        .rows_affected()
            > 0)
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_form(&self, id: FormId) -> Result<(), Self::Error> {
        let mut transaction = self.pool.begin().await?;
        entity_access_db_utils::delete_entity_access_rows(
            &mut transaction,
            id.as_uuid(),
            EntityType::Form,
        )
        .await?;
        sqlx::query!("DELETE FROM forms WHERE id = $1", id.into_uuid())
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(())
    }

    async fn response_of(
        &self,
        form: FormId,
        respondent: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Option<crate::domain::models::FormResponse>, Self::Error> {
        ledger::response_of(&self.pool, form, respondent).await
    }

    async fn record_stop(
        &self,
        form: FormId,
        respondent: &macro_user_id::user_id::MacroUserIdStr<'_>,
        section: crate::domain::models::FormSectionId,
        at: DateTime<Utc>,
    ) -> Result<(), Self::Error> {
        ledger::record_stop(&self.pool, form, respondent, section, at).await
    }

    async fn record_submission(
        &self,
        form: FormId,
        respondent: Option<&macro_user_id::user_id::MacroUserIdStr<'_>>,
        row: crate::domain::models::RowId,
        at: DateTime<Utc>,
    ) -> Result<crate::domain::models::RecordedResponse, Self::Error> {
        ledger::record_submission(&self.pool, form, respondent, row, at).await
    }

    async fn repoint_response(
        &self,
        response: crate::domain::models::FormResponseId,
        row: crate::domain::models::RowId,
        at: DateTime<Utc>,
    ) -> Result<(), Self::Error> {
        ledger::repoint_response(&self.pool, response, row, at).await
    }

    async fn touch_response(
        &self,
        response: crate::domain::models::FormResponseId,
        at: DateTime<Utc>,
    ) -> Result<(), Self::Error> {
        ledger::touch_response(&self.pool, response, at).await
    }

    async fn response_counts(
        &self,
        form: FormId,
    ) -> Result<crate::domain::models::ResponseCounts, Self::Error> {
        ledger::response_counts(&self.pool, form).await
    }
}
