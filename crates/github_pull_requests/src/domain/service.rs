//! Service implementation for storing GitHub pull requests.

#[cfg(test)]
mod test;

use foreign_entity::domain::{
    models::{CreateForeignEntity, ForeignEntity, PatchForeignEntity, SourceId},
    ports::{ForeignEntityListQuery, ForeignEntityService},
};
use item_filters::ast::{LiteralTree, github_pull_request::GithubPullRequestLiteral};

use super::{
    models::{
        EnrichedGithubPullRequest, GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
        GithubPullRequestError, GithubPullRequestRow, GithubPullRequestStatus,
        GithubRepositoryIdentity, UpsertGithubPullRequest, UpsertedGithubPullRequest,
    },
    ports::{
        GithubPullRequestIndexRepository, GithubPullRequestIndexer, GithubPullRequestListing,
        GithubPullRequestListingRepository, GithubPullRequestRepository, GithubPullRequestService,
    },
};

/// Stores pull requests through the foreign entity service, with their typed columns in `repo`.
pub struct GithubPullRequestServiceImpl<F, R> {
    foreign_entity_service: F,
    repo: R,
}

impl<F: ForeignEntityService, R: GithubPullRequestRepository> GithubPullRequestServiceImpl<F, R> {
    /// Create a service that stores pull requests through `foreign_entity_service` and their
    /// typed columns in `repo`.
    pub fn new(foreign_entity_service: F, repo: R) -> Self {
        Self {
            foreign_entity_service,
            repo,
        }
    }

    async fn stored_records(
        &self,
        github_key: &str,
    ) -> Result<Vec<ForeignEntity>, GithubPullRequestError> {
        Ok(self
            .foreign_entity_service
            .get_foreign_entities_by_foreign_entity_id(
                github_key,
                Some(GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE),
            )
            .await?)
    }

    /// Move a pull request stored under the name its repository had before a rename or
    /// transfer to its current key: every record stored for it, and its row.
    async fn follow_rename(
        &self,
        pull_request: &EnrichedGithubPullRequest,
    ) -> Result<(), GithubPullRequestError> {
        let (Some(repository_id), Ok(number)) = (
            pull_request
                .repository_id
                .and_then(|id| i64::try_from(id).ok()),
            i64::try_from(pull_request.number),
        ) else {
            return Ok(());
        };
        let Some(previous_key) = self
            .repo
            .github_key_for(repository_id, number)
            .await
            .map_err(repository_error)?
        else {
            return Ok(());
        };
        if previous_key == pull_request.github_key {
            return Ok(());
        }

        for record in self.stored_records(&previous_key).await? {
            self.foreign_entity_service
                .patch_foreign_entity(
                    record.id,
                    PatchForeignEntity {
                        foreign_entity_id: Some(pull_request.github_key.clone()),
                        ..PatchForeignEntity::default()
                    },
                )
                .await?;
        }
        self.repo
            .rename_row(&previous_key, &pull_request.github_key)
            .await
            .map_err(repository_error)
    }

    /// Write a pull request's typed columns from a record's metadata. Rows are derived data, so
    /// a failure is logged rather than failing the write of the record itself.
    async fn store_row(&self, metadata: &serde_json::Value, repository_id: Option<i64>) -> bool {
        let Some(mut row) = GithubPullRequestRow::from_metadata(metadata) else {
            tracing::warn!("pull request metadata has no typed columns");
            return false;
        };
        if repository_id.is_some() {
            row.repository_id = repository_id;
        }

        match self.repo.upsert_row(&row).await {
            Ok(()) => true,
            Err(error) => {
                tracing::error!(
                    error=?error,
                    github_key=%row.github_key,
                    "failed to store pull request row"
                );
                false
            }
        }
    }
}

impl<F: ForeignEntityService, R: GithubPullRequestRepository> GithubPullRequestService
    for GithubPullRequestServiceImpl<F, R>
{
    #[tracing::instrument(
        err,
        skip(self, upsert),
        fields(github_key = %upsert.pull_request.github_key)
    )]
    async fn upsert_pull_request(
        &self,
        upsert: UpsertGithubPullRequest,
    ) -> Result<UpsertedGithubPullRequest, GithubPullRequestError> {
        let UpsertGithubPullRequest {
            pull_request,
            stored_for,
        } = upsert;
        self.follow_rename(&pull_request).await?;

        let records = self.stored_records(&pull_request.github_key).await?;
        let existing = records.iter().find(|record| {
            record.stored_for_id == stored_for.id
                && record.stored_for_auth_entity == stored_for.auth_entity
        });
        let previous_status = existing.and_then(|record| status_from_metadata(&record.metadata));
        // A source's first record starts from what another source already stored.
        let existing_metadata = existing
            .or_else(|| records.first())
            .map(|record| &record.metadata);
        let metadata = pull_request.foreign_entity_metadata(existing_metadata)?;
        let participant_github_user_ids = participant_github_user_ids(&metadata);

        let foreign_entity = match existing {
            Some(record) => {
                self.foreign_entity_service
                    .patch_foreign_entity(
                        record.id,
                        PatchForeignEntity {
                            metadata: Some(metadata),
                            ..PatchForeignEntity::default()
                        },
                    )
                    .await?
            }
            None => {
                self.foreign_entity_service
                    .create_foreign_entity(CreateForeignEntity {
                        foreign_entity_id: pull_request.github_key.clone(),
                        foreign_entity_source: GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE
                            .to_string(),
                        metadata,
                        stored_for_id: stored_for.id,
                        stored_for_auth_entity: stored_for.auth_entity,
                    })
                    .await?
            }
        };
        self.store_row(&foreign_entity.metadata, None).await;

        Ok(UpsertedGithubPullRequest {
            foreign_entity,
            previous_status,
            participant_github_user_ids,
        })
    }

    #[tracing::instrument(
        err,
        skip(self, pull_request),
        fields(github_key = %pull_request.github_key)
    )]
    async fn refresh_pull_request(
        &self,
        pull_request: &EnrichedGithubPullRequest,
    ) -> Result<Vec<ForeignEntity>, GithubPullRequestError> {
        let mut refreshed = Vec::new();
        for record in self.stored_records(&pull_request.github_key).await? {
            let metadata = pull_request.foreign_entity_metadata(Some(&record.metadata))?;
            refreshed.push(
                self.foreign_entity_service
                    .patch_foreign_entity(
                        record.id,
                        PatchForeignEntity {
                            metadata: Some(metadata),
                            ..PatchForeignEntity::default()
                        },
                    )
                    .await?,
            );
        }
        if let Some(latest) = refreshed.iter().max_by_key(|record| record.updated_at) {
            self.store_row(&latest.metadata, None).await;
        }
        Ok(refreshed)
    }
}

impl<F, R> GithubPullRequestIndexer for GithubPullRequestServiceImpl<F, R>
where
    F: ForeignEntityService,
    R: GithubPullRequestRepository + GithubPullRequestIndexRepository,
{
    #[tracing::instrument(err, skip(self, repositories), fields(repositories = repositories.len()))]
    async fn index_repositories(
        &self,
        repositories: &[GithubRepositoryIdentity],
    ) -> Result<u64, GithubPullRequestError> {
        let mut indexed = 0;
        for repository in repositories {
            let Some(repository_id) = i64::try_from(repository.id).ok().filter(|id| *id != 0)
            else {
                continue;
            };
            let pull_requests = GithubPullRequestIndexRepository::latest_pull_request_metadata(
                &self.repo,
                &repository.owner,
                &repository.name,
            )
            .await
            .map_err(repository_error)?;
            for metadata in &pull_requests {
                if self.store_row(metadata, Some(repository_id)).await {
                    indexed += 1;
                }
            }
        }

        Ok(indexed)
    }
}

impl<F, R> GithubPullRequestListing for GithubPullRequestServiceImpl<F, R>
where
    F: ForeignEntityService,
    R: GithubPullRequestListingRepository,
{
    #[tracing::instrument(err, skip(self, source_ids, query, github_pull_request_filter))]
    async fn list_pull_requests(
        &self,
        requesting_user: Option<String>,
        source_ids: Vec<SourceId>,
        limit: u32,
        query: ForeignEntityListQuery,
        github_pull_request_filter: LiteralTree<GithubPullRequestLiteral>,
    ) -> Result<Vec<ForeignEntity>, GithubPullRequestError> {
        if source_ids.is_empty() {
            return Ok(Vec::new());
        }

        for source_id in &source_ids {
            source_id.validate()?;
        }

        GithubPullRequestListingRepository::list_pull_requests(
            &self.repo,
            requesting_user,
            source_ids,
            limit,
            query,
            github_pull_request_filter,
        )
        .await
        .map_err(repository_error)
    }
}

fn repository_error(error: impl Into<anyhow::Error>) -> GithubPullRequestError {
    GithubPullRequestError::Repository(error.into())
}

fn status_from_metadata(metadata: &serde_json::Value) -> Option<GithubPullRequestStatus> {
    metadata
        .get("status")
        .and_then(|status| serde_json::from_value(status.clone()).ok())
}

fn participant_github_user_ids(metadata: &serde_json::Value) -> Vec<String> {
    metadata
        .get("participantGithubUserIds")
        .and_then(|value| value.as_array())
        .map(|ids| {
            ids.iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}
