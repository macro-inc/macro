//! Service implementation for storing GitHub pull requests.

#[cfg(test)]
mod test;

mod changes;
mod index;

pub use changes::{GithubPullRequestChangesServiceImpl, GithubPullRequestChangesetStore};

use std::sync::Arc;
use uuid::Uuid;

use entity_access::domain::models::{
    EntityAccessReceipt, EntityType, MemberTeamRole, ViewAccessLevel,
};
use foreign_entity::domain::{
    models::{CreateForeignEntity, ForeignEntity, PatchForeignEntity, SourceId},
    ports::{ForeignEntityListQuery, ForeignEntityService},
};
use item_filters::ast::{LiteralTree, github_pull_request::GithubPullRequestLiteral};
use macro_user_id::user_id::MacroUserIdStr;

use super::{
    events::GithubPullRequestUpdated,
    models::{
        EnrichedGithubPullRequest, GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
        GithubPullRequestError, GithubPullRequestFacets, GithubPullRequestRow,
        GithubPullRequestSortDirection, GithubPullRequestStatus, GithubPullRequestWrite,
        StoredGithubPullRequest, UpsertGithubPullRequest, UpsertedGithubPullRequest,
    },
    ports::{
        GithubPullRequestEventPublisher, GithubPullRequestFacetRepository,
        GithubPullRequestFacetService, GithubPullRequestListing,
        GithubPullRequestListingRepository, GithubPullRequestRepository, GithubPullRequestService,
    },
};

/// Stores pull requests through the foreign entity service, with their typed columns in `repo`.
pub struct GithubPullRequestServiceImpl<F, R> {
    foreign_entity_service: F,
    repo: R,
    events: Option<Arc<dyn GithubPullRequestEventPublisher>>,
}

impl<F: ForeignEntityService, R: GithubPullRequestRepository> GithubPullRequestServiceImpl<F, R> {
    /// Create a service that stores pull requests through `foreign_entity_service` and their
    /// typed columns in `repo`.
    pub fn new(foreign_entity_service: F, repo: R) -> Self {
        Self {
            foreign_entity_service,
            repo,
            events: None,
        }
    }

    /// Enable committed change publication. Read-only service instances need no publisher.
    pub fn with_event_publisher(mut self, publisher: impl GithubPullRequestEventPublisher) -> Self {
        self.events = Some(Arc::new(publisher));
        self
    }

    async fn publish_updated(&self, github_key: &str, foreign_entity_ids: Vec<Uuid>) {
        if foreign_entity_ids.is_empty() {
            return;
        }
        if let Some(events) = &self.events {
            let update = GithubPullRequestUpdated {
                github_key: github_key.to_owned(),
                foreign_entity_ids,
            };
            let _ = events.publish_updated(update).await.inspect_err(|error| {
                tracing::error!(error=?error, github_key, "failed to publish committed PR update");
            });
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

    async fn refresh_record(
        &self,
        pull_request: &EnrichedGithubPullRequest,
        record: &ForeignEntity,
    ) -> Result<ForeignEntity, GithubPullRequestError> {
        let metadata = pull_request.foreign_entity_metadata(Some(&record.metadata))?;
        Ok(self
            .foreign_entity_service
            .patch_foreign_entity(
                record.id,
                PatchForeignEntity {
                    metadata: Some(metadata),
                    ..PatchForeignEntity::default()
                },
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

    /// Write supplied typed columns without collapsing omitted fields. Rows are derived data, so
    /// a failure is logged rather than failing the write of the record itself.
    async fn store_row(
        &self,
        pull_request: &EnrichedGithubPullRequest,
        records: &[ForeignEntity],
    ) -> bool {
        let Some(mut row) = GithubPullRequestWrite::from_enriched(pull_request) else {
            tracing::warn!("pull request metadata has no typed columns");
            return false;
        };
        row.initial_row = initialization_row(records, &row.github_key, row.number);

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

        let mut records = self.stored_records(&pull_request.github_key).await?;
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
        let changed = existing.is_none_or(|record| record.metadata != metadata);
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
        records.push(foreign_entity.clone());
        self.store_row(&pull_request, &records).await;
        if changed {
            self.publish_updated(&pull_request.github_key, vec![foreign_entity.id])
                .await;
        }

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
        let mut changed = false;
        let mut first_error = None;
        let mut records = self.stored_records(&pull_request.github_key).await?;
        for record in &records {
            match self.refresh_record(pull_request, record).await {
                Ok(refreshed_record) => {
                    changed |= refreshed_record.metadata != record.metadata;
                    refreshed.push(refreshed_record);
                }
                Err(error) => {
                    tracing::error!(
                        error=?error,
                        record_id=%record.id,
                        "failed to refresh pull request record"
                    );
                    first_error.get_or_insert(error);
                }
            }
        }
        // A successful subset can omit metadata held only by a failed record. Preserve the
        // existing typed row rather than replacing it with that incomplete projection.
        if let Some(error) = first_error {
            return Err(error);
        }
        if !refreshed.is_empty() {
            // Sparse serialization can clear optional source scalars. Keep the pre-refresh
            // records as initialization-only evidence; an existing typed row ignores them.
            records.extend(refreshed.iter().cloned());
            self.store_row(pull_request, &records).await;
        }
        if changed {
            // The typed row is shared by every source. Include records already refreshed by
            // an earlier partial attempt, since that attempt could not publish the shared row.
            self.publish_updated(
                &pull_request.github_key,
                refreshed.iter().map(|record| record.id).collect(),
            )
            .await;
        }
        Ok(refreshed)
    }

    #[tracing::instrument(err, skip(self, receipt))]
    async fn get_pull_request(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<StoredGithubPullRequest, GithubPullRequestError> {
        let record = self
            .foreign_entity_service
            .get_foreign_entity(receipt)
            .await?;
        if record.foreign_entity_source != GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE {
            return Err(GithubPullRequestError::NotFound(record.id));
        }
        let row = self
            .repo
            .pull_request_row(&record.foreign_entity_id)
            .await
            .map_err(repository_error)?;

        StoredGithubPullRequest::from_record(&record, row)
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
        sort_direction: GithubPullRequestSortDirection,
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
            sort_direction,
        )
        .await
        .map_err(repository_error)
    }
}

impl<F, R> GithubPullRequestFacetService for GithubPullRequestServiceImpl<F, R>
where
    F: ForeignEntityService,
    R: GithubPullRequestFacetRepository,
{
    #[tracing::instrument(err, skip(self, team))]
    async fn github_pull_request_facets(
        &self,
        user: MacroUserIdStr<'static>,
        team: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<GithubPullRequestFacets, GithubPullRequestError> {
        let mut source_ids = vec![SourceId::user(user.as_ref())];
        if let Some(team) = team {
            let entity = team.entity();
            if entity.entity_type != EntityType::Team {
                return Err(GithubPullRequestError::BadRequest(format!(
                    "expected Team receipt, got {:?}",
                    entity.entity_type
                )));
            }
            source_ids.push(SourceId::new(entity.entity_id.clone(), "team"));
        }

        GithubPullRequestFacetRepository::github_pull_request_facets(&self.repo, source_ids)
            .await
            .map_err(repository_error)
    }
}

/// Fold sparse source metadata in a stable order, retaining fields omitted by later sources.
fn initialization_row(
    records: &[ForeignEntity],
    github_key: &str,
    number: i64,
) -> Option<GithubPullRequestRow> {
    let mut records = records.iter().collect::<Vec<_>>();
    records.sort_by_key(|record| (record.updated_at, record.id));
    records
        .into_iter()
        .filter(|record| record.foreign_entity_id == github_key)
        .filter_map(|record| GithubPullRequestWrite::from_metadata(&record.metadata))
        .filter(|write| write.github_key == github_key && write.number == number)
        .fold(None, |row, write| Some(write.merge(row)))
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
