//! A validated layout and its version commit under the same form row lock.
use super::*;
use crate::domain::drafts::{FormDraftRepository, LayoutDraftState, LayoutProjection};

pub(super) struct ProjectionRevision<'revision> {
    expected: Option<&'revision [u8]>,
    revision: &'revision [u8],
}

impl PgFormsRepo {
    pub(super) async fn write_layout(
        &self,
        id: FormId,
        layout: &FormLayout,
        updated_at: DateTime<Utc>,
        required_audience: Option<Audience>,
        projection: Option<ProjectionRevision<'_>>,
    ) -> Result<LayoutProjection, PgFormsRepoError> {
        let mut transaction = self.pool.begin().await?;
        // The form's row lock serializes this with a change of its facts, so
        // the audience read here is the one the layout commits under.
        let Some(audience) = locked_audience(&mut transaction, id).await? else {
            transaction.rollback().await?;
            return Ok(LayoutProjection::Written(LayoutReplacement::FormGone));
        };
        let state = sqlx::query!(
            "SELECT layout_draft_enabled, layout_revision FROM forms WHERE id = $1",
            id.into_uuid(),
        )
        .fetch_one(&mut *transaction)
        .await?;
        if let Some(projection) = &projection {
            if !state.layout_draft_enabled
                || state.layout_revision.as_deref() != projection.expected
            {
                return Ok(LayoutProjection::RevisionChanged);
            }
        } else if state.layout_draft_enabled {
            return Ok(LayoutProjection::Written(LayoutReplacement::DraftRequired));
        }
        if required_audience.is_some_and(|required| required != audience) {
            transaction.rollback().await?;
            return Ok(LayoutProjection::Written(
                LayoutReplacement::AudienceChanged,
            ));
        }
        if let Some(taken) = layout::id_of_another_form(&mut *transaction, id, layout).await? {
            transaction.rollback().await?;
            return Ok(LayoutProjection::Written(LayoutReplacement::IdTaken(taken)));
        }
        sqlx::query!(
            "UPDATE forms SET updated_at = $2, layout_revision = CASE WHEN $3 THEN $4 ELSE layout_revision END WHERE id = $1",
            id.into_uuid(),
            updated_at,
            projection.is_some(),
            projection.as_ref().map(|projection| projection.revision),
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
                    Some(taken) => Ok(LayoutProjection::Written(LayoutReplacement::IdTaken(taken))),
                    None => Err(PgFormsRepoError::Sqlx(error)),
                };
            }
            Err(error) => return Err(error),
        }
        transaction.commit().await?;
        Ok(LayoutProjection::Written(LayoutReplacement::Replaced))
    }
}

impl FormDraftRepository for PgFormsRepo {
    type Error = PgFormsRepoError;
    async fn draft_state(&self, id: FormId) -> Result<Option<LayoutDraftState>, Self::Error> {
        Ok(sqlx::query!(
            "SELECT layout_draft_enabled, layout_revision FROM forms WHERE id = $1 AND trashed_at IS NULL",
            id.into_uuid(),
        ).fetch_optional(&self.pool).await?.map(|row| LayoutDraftState {
            enabled: row.layout_draft_enabled, revision: row.layout_revision,
        }))
    }
    async fn enable_draft(&self, id: FormId) -> Result<bool, Self::Error> {
        Ok(sqlx::query!(
            "UPDATE forms SET layout_draft_enabled = TRUE WHERE id = $1 AND trashed_at IS NULL",
            id.into_uuid(),
        )
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }
    async fn project_layout(
        &self,
        id: FormId,
        layout: &FormLayout,
        expected_revision: Option<&[u8]>,
        revision: &[u8],
        updated_at: DateTime<Utc>,
        required_audience: Option<Audience>,
    ) -> Result<LayoutProjection, Self::Error> {
        self.write_layout(
            id,
            layout,
            updated_at,
            required_audience,
            Some(ProjectionRevision {
                expected: expected_revision,
                revision,
            }),
        )
        .await
    }
}
