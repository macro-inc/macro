//! Verified source reconstruction; timestamps never establish repository identity.

use std::collections::BTreeMap;

use super::GithubPullRequestServiceImpl;
use crate::domain::{
    models::{
        GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE, GithubKey, GithubPullRequestError,
        GithubPullRequestRow, GithubPullRequestWrite, GithubRepositoryIdentity,
        PullRequestIndexOutcome, PullRequestIndexRecord, PullRequestIndexSummary, RepositorySlug,
    },
    ports::{GithubPullRequestIndexRepository, GithubPullRequestIndexer},
};
use foreign_entity::domain::ports::ForeignEntityService;

impl<F, R> GithubPullRequestIndexer for GithubPullRequestServiceImpl<F, R>
where
    F: ForeignEntityService,
    R: GithubPullRequestIndexRepository,
{
    #[tracing::instrument(err, skip(self, repositories), fields(repositories = repositories.len()))]
    async fn index_repositories(
        &self,
        repositories: &[GithubRepositoryIdentity],
    ) -> Result<PullRequestIndexSummary, GithubPullRequestError> {
        let mut summary = PullRequestIndexSummary::default();
        for repository in repositories {
            let valid_slug =
                RepositorySlug::parse(&format!("{}/{}", repository.owner, repository.name))
                    .is_some_and(|slug| {
                        slug.owner == repository.owner && slug.name == repository.name
                    });
            if !valid_slug {
                summary.failures += 1;
                tracing::warn!(
                    repository_id = repository.id,
                    "invalid installation repository name"
                );
                continue;
            }
            let Some(repository_id) = i64::try_from(repository.id).ok().filter(|id| *id > 0) else {
                summary.failures += 1;
                tracing::warn!(
                    repository_id = repository.id,
                    "invalid installation repository identity"
                );
                continue;
            };
            let mut records = match self
                .repo
                .pull_request_index_records(&repository.owner, &repository.name)
                .await
            {
                Ok(records) => records,
                Err(error) => {
                    summary.failures += 1;
                    tracing::error!(error=?error, repository_id, "failed to read pull request index sources");
                    continue;
                }
            };
            records.sort_by_key(|record| (record.updated_at, record.id));
            let mut groups: BTreeMap<i64, GithubPullRequestRow> = BTreeMap::new();
            for record in records {
                let write = match verified_write(&record, repository, repository_id) {
                    Ok(write) => write,
                    Err(Rejection::Unverified) => {
                        summary.unverified_records += 1;
                        continue;
                    }
                    Err(rejection) => {
                        match rejection {
                            Rejection::Invalid => summary.invalid_records += 1,
                            Rejection::Conflict => summary.identity_conflicts += 1,
                            Rejection::Unverified => unreachable!(),
                        }
                        tracing::warn!(record_id=%record.id, github_key=%record.github_key, ?rejection, repository_id, "rejected pull request index source");
                        continue;
                    }
                };
                let number = write.number;
                let row = write.merge(groups.remove(&number));
                groups.insert(number, row);
            }
            for row in groups.into_values() {
                match self.repo.initialize_indexed_row(&row).await {
                    Ok(PullRequestIndexOutcome::Inserted) => summary.inserted += 1,
                    Ok(PullRequestIndexOutcome::AlreadyPresent) => summary.already_present += 1,
                    Ok(PullRequestIndexOutcome::IdentityConflict) => {
                        summary.identity_conflicts += 1;
                        tracing::warn!(github_key=%row.github_key, repository_id, "pull request index identity conflicts with existing row");
                    }
                    Err(error) => {
                        summary.failures += 1;
                        tracing::error!(error=?error, github_key=%row.github_key, repository_id, "failed to initialize pull request index row");
                    }
                }
            }
        }
        Ok(summary)
    }
}

#[derive(Debug)]
enum Rejection {
    Unverified,
    Invalid,
    Conflict,
}

fn verified_write(
    record: &PullRequestIndexRecord,
    repository: &GithubRepositoryIdentity,
    repository_id: i64,
) -> Result<GithubPullRequestWrite, Rejection> {
    if record.source != GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE {
        return Err(Rejection::Invalid);
    }
    let mut write =
        GithubPullRequestWrite::from_metadata(&record.metadata).ok_or(Rejection::Invalid)?;
    // Check the original JSON too: an overflowing ID must not become an omitted ID.
    let source_id = match record.metadata.get("repositoryId") {
        None | Some(serde_json::Value::Null) => return Err(Rejection::Unverified),
        Some(value) => value
            .as_u64()
            .and_then(|id| i64::try_from(id).ok())
            .filter(|id| *id > 0)
            .ok_or(Rejection::Invalid)?,
    };
    if source_id != repository_id || write.repository_id != Some(repository_id) {
        return Err(Rejection::Conflict);
    }
    if write.number <= 0 {
        return Err(Rejection::Invalid);
    }
    let key = GithubKey::new(&repository.owner, &repository.name, write.number as u64).to_string();
    if !write.owner.eq_ignore_ascii_case(&repository.owner)
        || !write.repo.eq_ignore_ascii_case(&repository.name)
        || !write.github_key.eq_ignore_ascii_case(&key)
        || !record.github_key.eq_ignore_ascii_case(&key)
    {
        return Err(Rejection::Invalid);
    }
    // Canonical casing is only for new rows; initialization never renames an existing row.
    write.github_key = key;
    write.owner = repository.owner.clone();
    write.repo = repository.name.clone();
    Ok(write)
}
