//! Service implementation for storing GitHub pull requests.

#[cfg(test)]
mod test;

use foreign_entity::domain::{
    models::{CreateForeignEntity, ForeignEntity, PatchForeignEntity},
    ports::ForeignEntityService,
};

use super::{
    models::{
        EnrichedGithubPullRequest, GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
        GithubPullRequestError, GithubPullRequestStatus, UpsertGithubPullRequest,
        UpsertedGithubPullRequest,
    },
    ports::GithubPullRequestService,
};

/// Stores pull requests through the foreign entity service.
pub struct GithubPullRequestServiceImpl<F> {
    foreign_entity_service: F,
}

impl<F: ForeignEntityService> GithubPullRequestServiceImpl<F> {
    /// Create a service that stores pull requests through `foreign_entity_service`.
    pub fn new(foreign_entity_service: F) -> Self {
        Self {
            foreign_entity_service,
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
}

impl<F: ForeignEntityService> GithubPullRequestService for GithubPullRequestServiceImpl<F> {
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
        Ok(refreshed)
    }
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
