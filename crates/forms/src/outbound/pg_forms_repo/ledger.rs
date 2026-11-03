//! The submission ledger, `form_responses`. Its partial unique index on
//! `(form_id, respondent_id)` is what keeps a signed-in person to one entry;
//! on an anonymous form, whose entries name nobody, the key of
//! `form_submission_receipts` does.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use super::{PgFormsRepoError, parsed};
use crate::domain::models::{
    FormId, FormResponse, FormResponseId, FormSectionId, RecordedResponse, ResponseCounts,
    ResponseStatus, RowId,
};

/// One `form_responses` row as read.
struct ResponseRow {
    id: Uuid,
    form_id: Uuid,
    status: String,
    stopped_at_section: Option<Uuid>,
    row_id: Option<Uuid>,
    submitted_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl TryFrom<ResponseRow> for FormResponse {
    type Error = PgFormsRepoError;

    fn try_from(row: ResponseRow) -> Result<Self, Self::Error> {
        Ok(FormResponse {
            id: FormResponseId::from_uuid(row.id),
            form_id: FormId::from_uuid(row.form_id),
            status: parsed::<ResponseStatus>("response status", &row.status)?,
            stopped_at_section: row.stopped_at_section.map(FormSectionId::from_uuid),
            row: row.row_id.map(RowId::from_uuid),
            submitted_at: row.submitted_at,
            updated_at: row.updated_at,
        })
    }
}

#[tracing::instrument(err, skip(pool, respondent))]
pub(super) async fn response_of(
    pool: &PgPool,
    form: FormId,
    respondent: &MacroUserIdStr<'_>,
) -> Result<Option<FormResponse>, PgFormsRepoError> {
    sqlx::query_as!(
        ResponseRow,
        r#"
        SELECT id, form_id, status, stopped_at_section, row_id, submitted_at, updated_at
        FROM form_responses WHERE form_id = $1 AND respondent_id = $2
        "#,
        form.into_uuid(),
        respondent.as_ref(),
    )
    .fetch_optional(pool)
    .await?
    .map(FormResponse::try_from)
    .transpose()
}

#[tracing::instrument(err, skip(pool, respondent))]
pub(super) async fn record_stop(
    pool: &PgPool,
    form: FormId,
    respondent: &MacroUserIdStr<'_>,
    section: FormSectionId,
    at: DateTime<Utc>,
) -> Result<(), PgFormsRepoError> {
    // An accepted response holds the key, so the conflicting insert leaves it
    // as it is.
    sqlx::query_scalar!(
        r#"
        INSERT INTO form_responses (id, form_id, respondent_id, status, stopped_at_section, submitted_at, updated_at)
        VALUES ($1, $2, $3, 'stopped', $4, $5, $5)
        ON CONFLICT (form_id, respondent_id) WHERE respondent_id IS NOT NULL
        DO UPDATE SET stopped_at_section = EXCLUDED.stopped_at_section,
                      updated_at = EXCLUDED.updated_at
        WHERE form_responses.status = 'stopped'
        RETURNING id
        "#,
        FormResponseId::new().into_uuid(),
        form.into_uuid(),
        respondent.as_ref(),
        section.into_uuid(),
        at,
    )
    .fetch_optional(pool)
    .await?;
    Ok(())
}

#[tracing::instrument(err, skip(pool, respondent))]
pub(super) async fn record_submission(
    pool: &PgPool,
    form: FormId,
    respondent: Option<&MacroUserIdStr<'_>>,
    row: RowId,
    at: DateTime<Utc>,
) -> Result<RecordedResponse, PgFormsRepoError> {
    // A stop gives way to the response; an accepted response holds the key,
    // so the conflicting insert writes nothing and returns no row.
    let recorded = sqlx::query_as!(
        ResponseRow,
        r#"
        INSERT INTO form_responses (id, form_id, respondent_id, row_id, status, submitted_at, updated_at)
        VALUES ($1, $2, $3, $4, 'submitted', $5, $5)
        ON CONFLICT (form_id, respondent_id) WHERE respondent_id IS NOT NULL
        DO UPDATE SET status = 'submitted',
                      row_id = EXCLUDED.row_id,
                      stopped_at_section = NULL,
                      submitted_at = EXCLUDED.submitted_at,
                      updated_at = EXCLUDED.updated_at
        WHERE form_responses.status = 'stopped'
        RETURNING id, form_id, status, stopped_at_section, row_id, submitted_at, updated_at
        "#,
        FormResponseId::new().into_uuid(),
        form.into_uuid(),
        respondent.map(|respondent| respondent.as_ref()),
        row.into_uuid(),
        at,
    )
    .fetch_optional(pool)
    .await?;
    Ok(match recorded {
        Some(row) => RecordedResponse::Recorded(FormResponse::try_from(row)?),
        None => RecordedResponse::AlreadySubmitted,
    })
}

// The voter stays out of the span: it would pair them with the row.
#[tracing::instrument(err, skip(pool, voter, row))]
pub(super) async fn record_anonymous_submission(
    pool: &PgPool,
    form: FormId,
    voter: Option<&MacroUserIdStr<'_>>,
    row: RowId,
    day: DateTime<Utc>,
) -> Result<RecordedResponse, PgFormsRepoError> {
    let mut transaction = pool.begin().await?;
    if let Some(voter) = voter {
        let receipt = sqlx::query_scalar!(
            r#"
            INSERT INTO form_submission_receipts (form_id, user_id) VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            RETURNING 1 AS "one!"
            "#,
            form.into_uuid(),
            voter.as_ref(),
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if receipt.is_none() {
            transaction.rollback().await?;
            return Ok(RecordedResponse::AlreadySubmitted);
        }
    }
    // A random id, unlike a time-ordered one, says nothing of when or in
    // what order people responded.
    let recorded = sqlx::query_as!(
        ResponseRow,
        r#"
        INSERT INTO form_responses (id, form_id, row_id, status, submitted_at, updated_at)
        VALUES ($1, $2, $3, 'submitted', $4, $4)
        RETURNING id, form_id, status, stopped_at_section, row_id, submitted_at, updated_at
        "#,
        Uuid::new_v4(),
        form.into_uuid(),
        row.into_uuid(),
        day,
    )
    .fetch_one(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(RecordedResponse::Recorded(FormResponse::try_from(recorded)?))
}

#[tracing::instrument(err, skip(pool, voter))]
pub(super) async fn holds_receipt(
    pool: &PgPool,
    form: FormId,
    voter: &MacroUserIdStr<'_>,
) -> Result<bool, PgFormsRepoError> {
    Ok(sqlx::query_scalar!(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM form_submission_receipts WHERE form_id = $1 AND user_id = $2
        ) AS "held!"
        "#,
        form.into_uuid(),
        voter.as_ref(),
    )
    .fetch_one(pool)
    .await?)
}

#[tracing::instrument(err, skip(pool))]
pub(super) async fn repoint_response(
    pool: &PgPool,
    response: FormResponseId,
    row: RowId,
    at: DateTime<Utc>,
) -> Result<(), PgFormsRepoError> {
    sqlx::query!(
        "UPDATE form_responses SET row_id = $2, updated_at = $3 WHERE id = $1",
        response.into_uuid(),
        row.into_uuid(),
        at,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[tracing::instrument(err, skip(pool))]
pub(super) async fn touch_response(
    pool: &PgPool,
    response: FormResponseId,
    at: DateTime<Utc>,
) -> Result<(), PgFormsRepoError> {
    sqlx::query!(
        "UPDATE form_responses SET updated_at = $2 WHERE id = $1",
        response.into_uuid(),
        at,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[tracing::instrument(err, skip(pool))]
pub(super) async fn response_counts(
    pool: &PgPool,
    form: FormId,
) -> Result<ResponseCounts, PgFormsRepoError> {
    let rows = sqlx::query!(
        r#"
        SELECT status, stopped_at_section, COUNT(*) AS "count!"
        FROM form_responses WHERE form_id = $1
        GROUP BY status, stopped_at_section
        "#,
        form.into_uuid(),
    )
    .fetch_all(pool)
    .await?;
    let mut counts = ResponseCounts::default();
    for row in rows {
        let count = u64::try_from(row.count).map_err(|_| PgFormsRepoError::Corrupt {
            kind: "count",
            value: row.count.to_string(),
        })?;
        match (
            parsed::<ResponseStatus>("response status", &row.status)?,
            row.stopped_at_section,
        ) {
            (ResponseStatus::Submitted, _) => counts.submitted += count,
            (ResponseStatus::Stopped, Some(section)) => counts
                .stopped_by_section
                .push((FormSectionId::from_uuid(section), count)),
            (ResponseStatus::Stopped, None) => {
                return Err(PgFormsRepoError::Corrupt {
                    kind: "stop",
                    value: "a stop with no section".to_string(),
                });
            }
        }
    }
    Ok(counts)
}

#[tracing::instrument(err, skip(pool))]
pub(super) async fn respondents_by_row(
    pool: &PgPool,
    form: FormId,
) -> Result<Vec<(RowId, MacroUserIdStr<'static>)>, PgFormsRepoError> {
    let rows = sqlx::query!(
        r#"
        SELECT row_id AS "row_id!", respondent_id AS "respondent_id!"
        FROM form_responses
        WHERE form_id = $1 AND status = 'submitted'
        AND row_id IS NOT NULL AND respondent_id IS NOT NULL
        ORDER BY submitted_at, id
        "#,
        form.into_uuid(),
    )
    .fetch_all(pool)
    .await?;
    rows.into_iter()
        .map(|row| {
            let respondent = MacroUserIdStr::try_from(row.respondent_id.clone()).map_err(|_| {
                PgFormsRepoError::Corrupt {
                    kind: "respondent",
                    value: row.respondent_id,
                }
            })?;
            Ok((RowId::from_uuid(row.row_id), respondent))
        })
        .collect()
}
