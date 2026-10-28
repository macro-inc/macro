//! Pull request changeset summaries in `github_pull_request_changeset`.

#[cfg(test)]
mod test;

use std::num::NonZeroU64;

use chrono::{DateTime, Utc};
use git_patch::ChangedFile;
use uuid::Uuid;

use super::PgGithubPullRequestRepo;
use crate::domain::{
    models::{ChangesetRange, GitRef, GithubPullRequestChangeset, PullRequestRef, RepositorySlug},
    ports::GithubPullRequestChangesetRepository,
};

/// The row as stored, kept apart from the domain type so a column rename touches one mapping.
struct ChangesetRow {
    id: Uuid,
    github_key: String,
    repository: String,
    number: i64,
    base_ref: Option<String>,
    base_sha: String,
    head_ref: Option<String>,
    head_sha: String,
    files: serde_json::Value,
    additions: i32,
    deletions: i32,
    patch_blob_key: Option<String>,
    patch_bytes: i64,
    truncated: bool,
    captured_at: DateTime<Utc>,
}

impl ChangesetRow {
    fn into_changeset(self) -> Result<GithubPullRequestChangeset, sqlx::Error> {
        let decode_error = |message: String| sqlx::Error::Decode(message.into());
        let repository = RepositorySlug::parse(&self.repository)
            .ok_or_else(|| decode_error(format!("stored repository {}", self.repository)))?;
        let number = u64::try_from(self.number)
            .ok()
            .and_then(NonZeroU64::new)
            .ok_or_else(|| decode_error(format!("stored pull request number {}", self.number)))?;
        let files: Vec<ChangedFile> = serde_json::from_value(self.files)
            .map_err(|error| decode_error(format!("stored changed files: {error}")))?;
        Ok(GithubPullRequestChangeset {
            id: self.id,
            github_key: self.github_key,
            range: ChangesetRange {
                repository: Some(repository.https_url()),
                base: GitRef {
                    name: self.base_ref,
                    sha: Some(self.base_sha),
                },
                head: GitRef {
                    name: self.head_ref,
                    sha: Some(self.head_sha),
                },
            },
            pull_request: PullRequestRef { repository, number },
            files,
            additions: u32::try_from(self.additions).unwrap_or(u32::MAX),
            deletions: u32::try_from(self.deletions).unwrap_or(u32::MAX),
            patch_bytes: u64::try_from(self.patch_bytes).unwrap_or(0),
            truncated: self.truncated,
            patch_key: self.patch_blob_key,
            captured_at: self.captured_at,
        })
    }
}

impl GithubPullRequestChangesetRepository for PgGithubPullRequestRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(err, skip(self))]
    async fn get_changeset(
        &self,
        id: Uuid,
    ) -> Result<Option<GithubPullRequestChangeset>, Self::Err> {
        let row = sqlx::query_as!(
            ChangesetRow,
            r#"
            SELECT
                id,
                github_key,
                repository,
                number,
                base_ref,
                base_sha,
                head_ref,
                head_sha,
                files,
                additions,
                deletions,
                patch_blob_key,
                patch_bytes,
                truncated,
                captured_at
            FROM github_pull_request_changeset
            WHERE id = $1
            "#,
            id,
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(ChangesetRow::into_changeset).transpose()
    }

    #[tracing::instrument(err, skip(self, changeset), fields(changeset.id = %changeset.id))]
    async fn insert_changeset(
        &self,
        changeset: &GithubPullRequestChangeset,
    ) -> Result<(), Self::Err> {
        let files = serde_json::to_value(&changeset.files)
            .map_err(|error| sqlx::Error::Encode(error.into()))?;
        let (Some(base_sha), Some(head_sha)) = (
            changeset.range.base.sha.as_deref(),
            changeset.range.head.sha.as_deref(),
        ) else {
            return Err(sqlx::Error::Encode(
                "a pull request changeset needs its base and head commits".into(),
            ));
        };
        sqlx::query!(
            r#"
            INSERT INTO github_pull_request_changeset (
                id,
                github_key,
                repository,
                number,
                base_ref,
                base_sha,
                head_ref,
                head_sha,
                files,
                additions,
                deletions,
                patch_blob_key,
                patch_bytes,
                truncated,
                captured_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (id) DO NOTHING
            "#,
            changeset.id,
            changeset.github_key,
            changeset.pull_request.repository.https_url(),
            i64::try_from(changeset.pull_request.number.get()).unwrap_or(i64::MAX),
            changeset.range.base.name.as_deref(),
            base_sha,
            changeset.range.head.name.as_deref(),
            head_sha,
            files,
            i32::try_from(changeset.additions).unwrap_or(i32::MAX),
            i32::try_from(changeset.deletions).unwrap_or(i32::MAX),
            changeset.patch_key.as_deref(),
            i64::try_from(changeset.patch_bytes).unwrap_or(i64::MAX),
            changeset.truncated,
            changeset.captured_at,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
