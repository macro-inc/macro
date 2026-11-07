//! Stored source scans and insert-only initialization of verified typed rows.

#[cfg(test)]
mod test;

use sqlx::{Postgres, Transaction};

use super::PgGithubPullRequestRepo;
use crate::domain::{
    models::{
        GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE, GithubPullRequestRow, PullRequestIndexOutcome,
        PullRequestIndexRecord,
    },
    ports::GithubPullRequestIndexRepository,
};

const SOURCE_PAGE_SIZE: i64 = 512;

/// Foreign-entity records are only read; initialization writes this crate's typed table.
impl GithubPullRequestIndexRepository for PgGithubPullRequestRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(err, skip(self))]
    async fn pull_request_index_records(
        &self,
        owner: &str,
        name: &str,
    ) -> Result<Vec<PullRequestIndexRecord>, Self::Err> {
        let key_prefix = format!("{owner}/{name}/pull/");
        let mut after: Option<uuid::Uuid> = None;
        let mut records = Vec::new();
        loop {
            let page = sqlx::query_as!(
                PullRequestIndexRecord,
                r#"
                SELECT id, foreign_entity_source AS source, foreign_entity_id AS github_key,
                       updated_at, metadata
                FROM foreign_entity
                WHERE foreign_entity_source = $1::text
                  AND left(lower(foreign_entity_id), length($2::text)) = lower($2::text)
                  AND ($3::uuid IS NULL OR id > $3)
                ORDER BY id ASC
                LIMIT $4
                "#,
                GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
                key_prefix,
                after,
                SOURCE_PAGE_SIZE,
            )
            .fetch_all(&self.pool)
            .await?;
            let complete = page.len() < SOURCE_PAGE_SIZE as usize;
            after = page.last().map(|record| record.id);
            records.extend(page);
            if complete {
                return Ok(records);
            }
        }
    }

    #[tracing::instrument(err, skip(self, row), fields(github_key = %row.github_key))]
    async fn initialize_indexed_row(
        &self,
        row: &GithubPullRequestRow,
    ) -> Result<PullRequestIndexOutcome, Self::Err> {
        let repository_id = row.repository_id.filter(|id| *id > 0).ok_or_else(|| {
            sqlx::Error::Protocol(
                "index initialization requires verified repository identity".into(),
            )
        })?;
        if row.number <= 0 {
            return Err(sqlx::Error::Protocol(
                "index initialization requires a positive PR number".into(),
            ));
        }
        let mut tx = self.pool.begin().await?;
        // Same case-insensitive lock as live upserts, before reading even an absent key.
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended(lower($1), 0))",
            row.github_key
        )
        .execute(&mut *tx)
        .await?;
        let identity_lock = format!(
            "github_pull_request.identity:{repository_id}/{}",
            row.number
        );
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            identity_lock
        )
        .execute(&mut *tx)
        .await?;
        if let Some(outcome) = existing_index_outcome(&mut tx, row, repository_id).await? {
            tx.commit().await?;
            return Ok(outcome);
        }
        let json = |value: serde_json::Result<serde_json::Value>| {
            value.map_err(|error| sqlx::Error::Encode(error.into()))
        };
        let assignees = json(serde_json::to_value(&row.assignees))?;
        let labels = json(serde_json::to_value(&row.labels))?;
        let reviews = json(serde_json::to_value(&row.reviews))?;
        let inserted = sqlx::query!(
            r#"
            INSERT INTO github_pull_request (
                github_key, repository_id, number, owner, repo, title, status, draft,
                author_github_user_id, author_login, requested_reviewer_github_user_ids,
                participant_github_user_ids, github_updated_at, assignees, labels, reviews,
                review_decision, base_ref, base_sha, head_ref, head_sha
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                $14::jsonb, $15::jsonb, $16::jsonb, $17, $18, $19, $20, $21
            )
            ON CONFLICT DO NOTHING
            "#,
            row.github_key,
            repository_id,
            row.number,
            row.owner,
            row.repo,
            row.title.as_deref(),
            row.status.map(|status| status.as_str()),
            row.draft,
            row.author_github_user_id.as_deref(),
            row.author_login.as_deref(),
            &row.requested_reviewer_github_user_ids,
            &row.participant_github_user_ids,
            row.github_updated_at,
            assignees,
            labels,
            reviews,
            row.review_decision.map(|decision| decision.as_str()),
            row.base.as_ref().and_then(|base| base.name.as_deref()),
            row.base.as_ref().and_then(|base| base.sha.as_deref()),
            row.head.as_ref().and_then(|head| head.name.as_deref()),
            row.head.as_ref().and_then(|head| head.sha.as_deref()),
        )
        .execute(&mut *tx)
        .await?
        .rows_affected()
            == 1;
        let outcome = if inserted {
            PullRequestIndexOutcome::Inserted
        } else {
            // A non-index writer can insert another key for this identity between reads.
            existing_index_outcome(&mut tx, row, repository_id)
                .await?
                .unwrap_or(PullRequestIndexOutcome::IdentityConflict)
        };
        tx.commit().await?;
        Ok(outcome)
    }
}

async fn existing_index_outcome(
    tx: &mut Transaction<'_, Postgres>,
    row: &GithubPullRequestRow,
    repository_id: i64,
) -> Result<Option<PullRequestIndexOutcome>, sqlx::Error> {
    let existing = sqlx::query!(
        r#"
        SELECT github_key, repository_id, number, owner, repo
        FROM github_pull_request
        WHERE lower(github_key) = lower($1)
           OR (repository_id = $2 AND number = $3)
        ORDER BY github_key
        FOR UPDATE
        "#,
        row.github_key,
        repository_id,
        row.number,
    )
    .fetch_all(&mut **tx)
    .await?;
    if existing.is_empty() {
        return Ok(None);
    }
    let matches = existing.len() == 1
        && existing.iter().all(|stored| {
            stored.github_key.eq_ignore_ascii_case(&row.github_key)
                && stored.repository_id == Some(repository_id)
                && stored.number == row.number
                && stored.owner.eq_ignore_ascii_case(&row.owner)
                && stored.repo.eq_ignore_ascii_case(&row.repo)
        });
    Ok(Some(if matches {
        PullRequestIndexOutcome::AlreadyPresent
    } else {
        PullRequestIndexOutcome::IdentityConflict
    }))
}
