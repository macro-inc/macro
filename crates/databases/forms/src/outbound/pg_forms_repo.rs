//! Postgres persistence for forms, their layouts and the submission ledger.
//! A form's grants are `entity_access` rows written through the owning
//! access crate's helpers.

mod drafts;
mod folders;
mod layout;
mod ledger;
mod sharing;
#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use databases_types::position::PositionError;
use entity_access_db_utils::{AccessLevel, EntityAccessSourceType};
use entity_kind::EntityType;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{
    AccentColor, Audience, ColumnId, DatabaseId, ForbiddenWidget, Form, FormBranding, FormCreation,
    FormId, FormLayout, FormResponse, FormResponseId, FormSectionId, FormStatus, FormUpdate,
    LayoutReplacement, RecordedResponse, ResponseCounts, RowId, StoredForm, TableId, UpdateForm,
};

/// Errors from the Postgres repository.
#[derive(Debug, thiserror::Error)]
pub enum PgFormsRepoError {
    /// Underlying database failure.
    #[error("database error")]
    Sqlx(#[from] sqlx::Error),
    /// A section's rules or booking target could not be encoded as JSON for
    /// storage, or stored ones decoded.
    #[error("failed to encode or decode a stored section's JSON")]
    Json(#[from] serde_json::Error),
    /// A folder id is not a uuid.
    #[error("folder id is not a uuid")]
    FolderId(#[from] uuid::Error),
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

    /// Return the forms filed directly in any of `project_ids` to the root,
    /// without the grants those folders passed down. A form is not trashed
    /// with its folder, so trashing the folder files it at the root, as
    /// purging the folder does.
    pub async fn unfile_from_projects(
        &self,
        project_ids: &[String],
    ) -> Result<(), PgFormsRepoError> {
        folders::unfile_from_projects(&self.pool, project_ids).await
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
    logo_file_id: Option<Uuid>,
    cover_file_id: Option<Uuid>,
    accent_color: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    trashed_at: Option<DateTime<Utc>>,
    name_follows_database: bool,
    is_hidden_in_drive: bool,
    responses_visible: bool,
    anonymous: bool,
    project_id: Option<String>,
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
                branding: FormBranding {
                    logo_file_id: row.logo_file_id,
                    cover_file_id: row.cover_file_id,
                    accent_color: row
                        .accent_color
                        .map(|color| {
                            AccentColor::try_from(color.clone()).map_err(|_| {
                                PgFormsRepoError::Corrupt {
                                    kind: "accent color",
                                    value: color,
                                }
                            })
                        })
                        .transpose()?,
                },
                created_at: row.created_at,
                updated_at: row.updated_at,
                project_id: row.project_id,
                is_hidden_in_drive: row.is_hidden_in_drive,
                responses_visible: row.responses_visible,
                anonymous: row.anonymous,
            },
            trashed_at: row.trashed_at,
            name_follows_database: row.name_follows_database,
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
    async fn create_form(
        &self,
        form: &Form,
        layout: &FormLayout,
        name_follows_database: bool,
    ) -> Result<FormCreation, Self::Error> {
        let mut transaction = self.pool.begin().await?;
        let inserted = sqlx::query!(
            r#"
            INSERT INTO forms (
                id, name, description, owner_id, database_id, table_id,
                submitted_column_id, respondent_column_id, audience, tally_visible,
                status, closes_at, confirmation_message, logo_file_id, cover_file_id,
                accent_color, created_at, updated_at, name_follows_database, is_hidden_in_drive, responses_visible, anonymous
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                $19, $20, $21, $22
            )
            ON CONFLICT (table_id) DO NOTHING
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
            form.branding.logo_file_id,
            form.branding.cover_file_id,
            form.branding.accent_color.as_ref().map(AccentColor::as_str),
            form.created_at,
            form.updated_at,
            name_follows_database,
            form.is_hidden_in_drive,
            form.responses_visible,
            form.anonymous,
        )
        .execute(&mut *transaction)
        .await;
        let inserted = match inserted {
            Ok(inserted) => inserted,
            Err(sqlx::Error::Database(error))
                if error.constraint() == Some("form_managed_column_schema") =>
            {
                return Ok(FormCreation::SchemaChanged);
            }
            Err(error) => return Err(error.into()),
        };
        if inserted.rows_affected() == 0 {
            return Ok(FormCreation::TableOccupied);
        }
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
        Ok(FormCreation::Created)
    }

    async fn table_has_form(&self, table: TableId) -> Result<bool, Self::Error> {
        Ok(sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM forms WHERE table_id = $1) AS \"exists!\"",
            table.into_uuid()
        )
        .fetch_one(&self.pool)
        .await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn form(&self, id: FormId) -> Result<Option<StoredForm>, Self::Error> {
        sqlx::query_as!(
            FormRow,
            r#"
            SELECT id, name, description, owner_id, database_id, table_id,
                   submitted_column_id, respondent_column_id, audience, tally_visible,
                   status, closes_at, confirmation_message, logo_file_id, cover_file_id, accent_color,
                   created_at, updated_at, trashed_at,
                   name_follows_database, is_hidden_in_drive, project_id, responses_visible, anonymous
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
                       status, closes_at, confirmation_message, logo_file_id, cover_file_id, accent_color,
                   created_at, updated_at, trashed_at,
                   name_follows_database, is_hidden_in_drive, project_id, responses_visible, anonymous
                FROM forms WHERE id = ANY($1) AND trashed_at IS NULL
                ORDER BY id
                "#,
                &uuids(ids),
            )
            .fetch_all(&self.pool)
            .await?,
        )
    }

    #[tracing::instrument(err, skip(self, ids), fields(ids = ids.len()))]
    async fn forms_with_database_names(&self, ids: &[FormId]) -> Result<Vec<FormId>, Self::Error> {
        Ok(sqlx::query_scalar!(
            "SELECT id FROM forms WHERE id = ANY($1) AND name_follows_database ORDER BY id",
            &uuids(ids),
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(FormId::from_uuid)
        .collect())
    }

    #[tracing::instrument(err, skip(self))]
    async fn forms_for_database(&self, database_id: DatabaseId) -> Result<Vec<Form>, Self::Error> {
        live_forms(
            sqlx::query_as!(
                FormRow,
                r#"
                SELECT id, name, description, owner_id, database_id, table_id,
                       submitted_column_id, respondent_column_id, audience, tally_visible,
                       status, closes_at, confirmation_message, logo_file_id, cover_file_id, accent_color,
                   created_at, updated_at, trashed_at,
                   name_follows_database, is_hidden_in_drive, project_id, responses_visible, anonymous
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
        match self
            .write_layout(id, layout, updated_at, required_audience, None)
            .await?
        {
            crate::domain::drafts::LayoutProjection::Written(result) => Ok(result),
            crate::domain::drafts::LayoutProjection::RevisionChanged => {
                Err(PgFormsRepoError::Corrupt {
                    kind: "layout replacement",
                    value: "unexpected revision check for an ordinary write".into(),
                })
            }
        }
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
        // The form's row lock also waits out a response being recorded, so
        // no response lands between this check and the change.
        if let Some(anonymous) = changes.anonymous {
            let locked = sqlx::query_scalar!(
                r#"
                SELECT f.anonymous <> $2 AND EXISTS (
                    SELECT 1 FROM form_responses
                    WHERE form_id = f.id AND status = 'submitted'
                ) AS "locked!"
                FROM forms f WHERE f.id = $1
                "#,
                id.into_uuid(),
                anonymous,
            )
            .fetch_one(&mut *transaction)
            .await?;
            if locked {
                transaction.rollback().await?;
                return Ok(FormUpdate::AnonymityLocked);
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
                logo_file_id = CASE WHEN $10 THEN $11 ELSE logo_file_id END,
                cover_file_id = CASE WHEN $12 THEN $13 ELSE cover_file_id END,
                accent_color = CASE WHEN $14 THEN $15 ELSE accent_color END,
                responses_visible = COALESCE($16, responses_visible),
                anonymous = COALESCE($17, anonymous),
                updated_at = $9
            WHERE id = $1
            RETURNING id, name, description, owner_id, database_id, table_id,
                      submitted_column_id, respondent_column_id, audience, tally_visible,
                      status, closes_at, confirmation_message, logo_file_id, cover_file_id, accent_color,
                   created_at, updated_at, trashed_at,
                   name_follows_database, is_hidden_in_drive, project_id, responses_visible, anonymous
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
            changes.logo_file_id.is_some(),
            changes.logo_file_id.flatten(),
            changes.cover_file_id.is_some(),
            changes.cover_file_id.flatten(),
            changes.accent_color.is_some(),
            changes
                .accent_color
                .as_ref()
                .and_then(|color| color.as_ref().map(AccentColor::as_str)),
            changes.responses_visible,
            changes.anonymous,
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
                      status, closes_at, confirmation_message, logo_file_id, cover_file_id, accent_color,
                   created_at, updated_at, trashed_at,
                   name_follows_database, is_hidden_in_drive, project_id, responses_visible, anonymous
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
    async fn touch_form(
        &self,
        id: FormId,
        updated_at: DateTime<Utc>,
    ) -> Result<Option<Form>, Self::Error> {
        sqlx::query_as!(
            FormRow,
            r#"
            UPDATE forms SET updated_at = $2
            WHERE id = $1 AND trashed_at IS NULL
            RETURNING id, name, description, owner_id, database_id, table_id,
                      submitted_column_id, respondent_column_id, audience, tally_visible,
                      status, closes_at, confirmation_message, logo_file_id, cover_file_id, accent_color,
                   created_at, updated_at, trashed_at,
                      name_follows_database, is_hidden_in_drive, project_id, responses_visible, anonymous
            "#,
            id.into_uuid(),
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
    async fn move_form(&self, id: FormId, project_id: Option<&str>) -> Result<bool, Self::Error> {
        folders::move_form(&self.pool, id, project_id).await
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
        respondent: &MacroUserIdStr<'_>,
    ) -> Result<Option<FormResponse>, Self::Error> {
        // The ledger's functions carry their own spans.
        ledger::response_of(&self.pool, form, respondent).await
    }

    async fn record_stop(
        &self,
        form: FormId,
        respondent: &MacroUserIdStr<'_>,
        section: FormSectionId,
        at: DateTime<Utc>,
    ) -> Result<(), Self::Error> {
        ledger::record_stop(&self.pool, form, respondent, section, at).await
    }

    async fn record_submission(
        &self,
        form: FormId,
        respondent: Option<&MacroUserIdStr<'_>>,
        row: RowId,
        at: DateTime<Utc>,
    ) -> Result<RecordedResponse, Self::Error> {
        ledger::record_submission(&self.pool, form, respondent, row, at).await
    }

    async fn record_anonymous_submission(
        &self,
        form: FormId,
        voter: Option<&MacroUserIdStr<'_>>,
        row: RowId,
        day: DateTime<Utc>,
    ) -> Result<RecordedResponse, Self::Error> {
        ledger::record_anonymous_submission(&self.pool, form, voter, row, day).await
    }

    async fn holds_receipt(
        &self,
        form: FormId,
        voter: &MacroUserIdStr<'_>,
    ) -> Result<bool, Self::Error> {
        ledger::holds_receipt(&self.pool, form, voter).await
    }

    async fn repoint_response(
        &self,
        response: FormResponseId,
        row: RowId,
        at: DateTime<Utc>,
    ) -> Result<(), Self::Error> {
        ledger::repoint_response(&self.pool, response, row, at).await
    }

    async fn touch_response(
        &self,
        response: FormResponseId,
        at: DateTime<Utc>,
    ) -> Result<(), Self::Error> {
        ledger::touch_response(&self.pool, response, at).await
    }

    async fn response_counts(&self, form: FormId) -> Result<ResponseCounts, Self::Error> {
        ledger::response_counts(&self.pool, form).await
    }

    async fn respondents_by_row(
        &self,
        form: FormId,
    ) -> Result<Vec<(RowId, MacroUserIdStr<'static>)>, Self::Error> {
        ledger::respondents_by_row(&self.pool, form).await
    }
}
