use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use foreign_entity::domain::{
    models::{
        CreateForeignEntity, ForeignEntity, ForeignEntityError, PatchForeignEntity, SourceId,
    },
    ports::{ForeignEntityListQuery, ForeignEntityService},
};
use models_pagination::{Cursor, CursorVal, Query, SimpleSortMethod};
use uuid::Uuid;

use super::GithubPullRequestServiceImpl;
use crate::domain::{
    models::{
        EnrichedGithubPullRequest, GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
        GithubPullRequestError, GithubPullRequestRow, GithubPullRequestStatus,
        GithubRepositoryIdentity, UpsertGithubPullRequest,
    },
    ports::{
        GithubPullRequestIndexRepository, GithubPullRequestIndexer, GithubPullRequestListing,
        GithubPullRequestListingRepository, GithubPullRequestRepository, GithubPullRequestService,
    },
};

const GITHUB_KEY: &str = "macro/app/pull/7";
const USER_ID: &str = "macro|user@example.com";
const TEAM_ID: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

#[derive(Clone, Default)]
struct StubForeignEntityService {
    state: Arc<Mutex<StubState>>,
}

#[derive(Default)]
struct StubState {
    records: Vec<ForeignEntity>,
    creates: Vec<CreateForeignEntity>,
    patches: Vec<(Uuid, PatchForeignEntity)>,
}

impl StubForeignEntityService {
    fn with_records(records: Vec<ForeignEntity>) -> Self {
        let service = Self::default();
        service.state.lock().unwrap().records = records;
        service
    }

    fn records(&self) -> Vec<ForeignEntity> {
        self.state.lock().unwrap().records.clone()
    }

    fn creates(&self) -> Vec<CreateForeignEntity> {
        self.state.lock().unwrap().creates.clone()
    }

    fn patches(&self) -> Vec<(Uuid, PatchForeignEntity)> {
        self.state.lock().unwrap().patches.clone()
    }
}

impl ForeignEntityService for StubForeignEntityService {
    async fn get_foreign_entity(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        unreachable!("pull request storage does not read records by receipt")
    }

    async fn get_foreign_entity_by_id(
        &self,
        id: Uuid,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        self.records()
            .into_iter()
            .find(|record| record.id == id)
            .ok_or(ForeignEntityError::NotFound(id))
    }

    async fn get_foreign_entities_by_foreign_entity_id(
        &self,
        foreign_entity_id: &str,
        foreign_entity_source: Option<&str>,
    ) -> Result<Vec<ForeignEntity>, ForeignEntityError> {
        Ok(self
            .records()
            .into_iter()
            .filter(|record| {
                record.foreign_entity_id == foreign_entity_id
                    && foreign_entity_source
                        .is_none_or(|source| record.foreign_entity_source == source)
            })
            .collect())
    }

    async fn get_foreign_entities_for_user(
        &self,
        _requesting_user: Option<String>,
        _source_ids: Vec<SourceId>,
        _limit: u32,
        _query: ForeignEntityListQuery,
    ) -> Result<Vec<ForeignEntity>, ForeignEntityError> {
        unreachable!("pull request storage does not list records")
    }

    async fn create_foreign_entity(
        &self,
        create: CreateForeignEntity,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        let now = Utc::now();
        let record = ForeignEntity {
            id: Uuid::new_v4(),
            foreign_entity_id: create.foreign_entity_id.clone(),
            foreign_entity_source: create.foreign_entity_source.clone(),
            metadata: create.metadata.clone(),
            stored_for_id: create.stored_for_id.clone(),
            stored_for_auth_entity: create.stored_for_auth_entity.clone(),
            created_at: now,
            updated_at: now,
        };
        let mut state = self.state.lock().unwrap();
        state.creates.push(create);
        state.records.push(record.clone());
        Ok(record)
    }

    async fn delete_foreign_entity(&self, _id: Uuid) -> Result<(), ForeignEntityError> {
        unreachable!("pull request storage does not delete records")
    }

    async fn patch_foreign_entity(
        &self,
        id: Uuid,
        patch: PatchForeignEntity,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        let mut state = self.state.lock().unwrap();
        state.patches.push((id, patch.clone()));
        let record = state
            .records
            .iter_mut()
            .find(|record| record.id == id)
            .ok_or(ForeignEntityError::NotFound(id))?;
        if let Some(foreign_entity_id) = patch.foreign_entity_id {
            record.foreign_entity_id = foreign_entity_id;
        }
        if let Some(metadata) = patch.metadata {
            record.metadata = metadata;
        }
        record.updated_at = Utc::now();
        Ok(record.clone())
    }
}

#[derive(Clone, Default)]
struct StubPullRequestRows {
    rows: Arc<Mutex<Vec<GithubPullRequestRow>>>,
    /// Stored pull request metadata by repository owner and name.
    stored: Arc<Mutex<Vec<(String, String, serde_json::Value)>>>,
    listing_calls: Arc<Mutex<Vec<ListingCall>>>,
    fail_listings: Arc<Mutex<bool>>,
}

#[derive(Debug, Clone, PartialEq)]
struct ListingCall {
    requesting_user: Option<String>,
    source_ids: Vec<SourceId>,
    limit: u32,
    sort_method: String,
    cursor_id: Option<Uuid>,
    cursor_value: Option<DateTime<Utc>>,
}

impl StubPullRequestRows {
    fn rows(&self) -> Vec<GithubPullRequestRow> {
        self.rows.lock().unwrap().clone()
    }

    fn listing_calls(&self) -> Vec<ListingCall> {
        self.listing_calls.lock().unwrap().clone()
    }
}

impl GithubPullRequestRepository for StubPullRequestRows {
    type Err = Infallible;

    async fn github_key_for(
        &self,
        repository_id: i64,
        number: i64,
    ) -> Result<Option<String>, Self::Err> {
        Ok(self
            .rows()
            .into_iter()
            .find(|row| row.repository_id == Some(repository_id) && row.number == number)
            .map(|row| row.github_key))
    }

    async fn upsert_row(&self, row: &GithubPullRequestRow) -> Result<(), Self::Err> {
        let mut rows = self.rows.lock().unwrap();
        match rows
            .iter_mut()
            .find(|existing| existing.github_key == row.github_key)
        {
            Some(existing) => {
                let repository_id = row.repository_id.or(existing.repository_id);
                *existing = GithubPullRequestRow {
                    repository_id,
                    ..row.clone()
                };
            }
            None => rows.push(row.clone()),
        }
        Ok(())
    }

    async fn rename_row(&self, from: &str, to: &str) -> Result<(), Self::Err> {
        let mut rows = self.rows.lock().unwrap();
        if rows.iter().any(|row| row.github_key == to) {
            rows.retain(|row| row.github_key != from);
        } else if let Some(row) = rows.iter_mut().find(|row| row.github_key == from) {
            row.github_key = to.to_owned();
        }
        Ok(())
    }
}

impl GithubPullRequestIndexRepository for StubPullRequestRows {
    type Err = Infallible;

    async fn latest_pull_request_metadata(
        &self,
        owner: &str,
        name: &str,
    ) -> Result<Vec<serde_json::Value>, Self::Err> {
        Ok(self
            .stored
            .lock()
            .unwrap()
            .iter()
            .filter(|(stored_owner, stored_name, _)| stored_owner == owner && stored_name == name)
            .map(|(_, _, metadata)| metadata.clone())
            .collect())
    }
}

impl GithubPullRequestListingRepository for StubPullRequestRows {
    type Err = anyhow::Error;

    async fn list_pull_requests(
        &self,
        requesting_user: Option<String>,
        source_ids: Vec<SourceId>,
        limit: u32,
        query: ForeignEntityListQuery,
    ) -> Result<Vec<ForeignEntity>, Self::Err> {
        if *self.fail_listings.lock().unwrap() {
            anyhow::bail!("listing failed");
        }
        let (cursor_id, cursor_value) = query.vals();
        self.listing_calls.lock().unwrap().push(ListingCall {
            requesting_user,
            source_ids,
            limit,
            sort_method: query.sort_method().to_string(),
            cursor_id: cursor_id.copied(),
            cursor_value: cursor_value.copied(),
        });
        Ok(Vec::new())
    }
}

type TestService = GithubPullRequestServiceImpl<StubForeignEntityService, StubPullRequestRows>;

fn service(foreign_entities: &StubForeignEntityService, rows: &StubPullRequestRows) -> TestService {
    GithubPullRequestServiceImpl::new(foreign_entities.clone(), rows.clone())
}

fn pull_request(status: GithubPullRequestStatus) -> EnrichedGithubPullRequest {
    EnrichedGithubPullRequest {
        github_key: GITHUB_KEY.to_string(),
        owner: "macro".to_string(),
        repo: "app".to_string(),
        repository_id: None,
        number: 7,
        url: "https://github.com/macro/app/pull/7".to_string(),
        display_name: "macro/app#7".to_string(),
        name: Some("Add pull request storage".to_string()),
        status: Some(status),
        additions: Some(10),
        deletions: Some(2),
        author_login: None,
        author_id: None,
        description: None,
        comments: None,
        checks: None,
        participant_github_user_ids: Some(vec!["42".to_string()]),
        draft: None,
        requested_reviewer_github_user_ids: None,
        github_updated_at: None,
    }
}

fn stored_record(stored_for: &SourceId, metadata: serde_json::Value) -> ForeignEntity {
    let now = Utc::now();
    ForeignEntity {
        id: Uuid::new_v4(),
        foreign_entity_id: GITHUB_KEY.to_string(),
        foreign_entity_source: GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE.to_string(),
        metadata,
        stored_for_id: stored_for.id.clone(),
        stored_for_auth_entity: stored_for.auth_entity.clone(),
        created_at: now,
        updated_at: now,
    }
}

fn team() -> SourceId {
    SourceId::new(TEAM_ID, "team")
}

fn user() -> SourceId {
    SourceId::user(USER_ID)
}

#[tokio::test]
async fn upsert_creates_the_record_for_a_source_without_one() {
    let foreign_entities = StubForeignEntityService::default();
    let rows = StubPullRequestRows::default();
    let service = service(&foreign_entities, &rows);

    let upserted = service
        .upsert_pull_request(UpsertGithubPullRequest {
            pull_request: pull_request(GithubPullRequestStatus::Open),
            stored_for: team(),
        })
        .await
        .unwrap();

    let creates = foreign_entities.creates();
    assert_eq!(creates.len(), 1);
    assert_eq!(creates[0].foreign_entity_id, GITHUB_KEY);
    assert_eq!(
        creates[0].foreign_entity_source,
        GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE
    );
    assert_eq!(creates[0].stored_for_id, TEAM_ID);
    assert_eq!(creates[0].stored_for_auth_entity, "team");
    assert_eq!(upserted.previous_status, None);
    assert_eq!(upserted.participant_github_user_ids, vec!["42".to_string()]);
    assert_eq!(foreign_entities.records(), vec![upserted.foreign_entity]);
}

#[tokio::test]
async fn upsert_merges_into_the_sources_own_record() {
    let team_record = stored_record(
        &team(),
        serde_json::json!({
            "status": "open",
            "comments": [{ "id": 1, "body": "kept", "source": "issue_comment" }],
            "participantGithubUserIds": ["7"],
        }),
    );
    let user_record = stored_record(&user(), serde_json::json!({ "status": "closed" }));
    let foreign_entities =
        StubForeignEntityService::with_records(vec![user_record.clone(), team_record.clone()]);
    let rows = StubPullRequestRows::default();
    let service = service(&foreign_entities, &rows);

    let upserted = service
        .upsert_pull_request(UpsertGithubPullRequest {
            pull_request: pull_request(GithubPullRequestStatus::Merged),
            stored_for: team(),
        })
        .await
        .unwrap();

    assert!(foreign_entities.creates().is_empty());
    assert_eq!(upserted.foreign_entity.id, team_record.id);
    assert_eq!(
        upserted.previous_status,
        Some(GithubPullRequestStatus::Open)
    );
    assert_eq!(
        upserted.participant_github_user_ids,
        vec!["42".to_string(), "7".to_string()]
    );
    assert_eq!(upserted.foreign_entity.metadata["status"], "merged");
    assert_eq!(
        upserted.foreign_entity.metadata["comments"],
        team_record.metadata["comments"]
    );
    let patches = foreign_entities.patches();
    assert_eq!(patches.len(), 1);
    assert_eq!(patches[0].0, team_record.id);
}

#[tokio::test]
async fn a_sources_first_record_starts_from_another_sources_metadata() {
    let team_record = stored_record(
        &team(),
        serde_json::json!({
            "status": "open",
            "participantGithubUserIds": ["7"],
        }),
    );
    let foreign_entities = StubForeignEntityService::with_records(vec![team_record]);
    let rows = StubPullRequestRows::default();
    let service = service(&foreign_entities, &rows);

    let upserted = service
        .upsert_pull_request(UpsertGithubPullRequest {
            pull_request: pull_request(GithubPullRequestStatus::Open),
            stored_for: user(),
        })
        .await
        .unwrap();

    assert_eq!(foreign_entities.creates().len(), 1);
    assert_eq!(upserted.foreign_entity.stored_for_id, USER_ID);
    assert_eq!(upserted.previous_status, None);
    assert_eq!(
        upserted.participant_github_user_ids,
        vec!["42".to_string(), "7".to_string()]
    );
}

#[tokio::test]
async fn refresh_updates_every_stored_record() {
    let team_record = stored_record(&team(), serde_json::json!({ "status": "open" }));
    let user_record = stored_record(&user(), serde_json::json!({ "status": "open" }));
    let foreign_entities =
        StubForeignEntityService::with_records(vec![team_record.clone(), user_record.clone()]);
    let rows = StubPullRequestRows::default();
    let service = service(&foreign_entities, &rows);

    let refreshed = service
        .refresh_pull_request(&pull_request(GithubPullRequestStatus::Closed))
        .await
        .unwrap();

    assert_eq!(
        refreshed.iter().map(|record| record.id).collect::<Vec<_>>(),
        vec![team_record.id, user_record.id]
    );
    assert!(
        refreshed
            .iter()
            .all(|record| record.metadata["status"] == "closed")
    );
    assert!(foreign_entities.creates().is_empty());
}

#[tokio::test]
async fn refresh_without_stored_records_does_nothing() {
    let foreign_entities = StubForeignEntityService::default();
    let rows = StubPullRequestRows::default();
    let service = service(&foreign_entities, &rows);

    let refreshed = service
        .refresh_pull_request(&pull_request(GithubPullRequestStatus::Open))
        .await
        .unwrap();

    assert!(refreshed.is_empty());
    assert!(foreign_entities.patches().is_empty());
}

#[tokio::test]
async fn upsert_writes_the_row_from_the_merged_metadata() {
    let foreign_entities = StubForeignEntityService::default();
    let rows = StubPullRequestRows::default();
    let service = service(&foreign_entities, &rows);

    service
        .upsert_pull_request(UpsertGithubPullRequest {
            pull_request: EnrichedGithubPullRequest {
                repository_id: Some(99),
                draft: Some(true),
                requested_reviewer_github_user_ids: Some(vec!["8".to_string()]),
                ..pull_request(GithubPullRequestStatus::Open)
            },
            stored_for: user(),
        })
        .await
        .unwrap();

    assert_eq!(
        rows.rows(),
        vec![GithubPullRequestRow {
            github_key: GITHUB_KEY.to_string(),
            repository_id: Some(99),
            number: 7,
            owner: "macro".to_string(),
            repo: "app".to_string(),
            title: Some("Add pull request storage".to_string()),
            status: Some(GithubPullRequestStatus::Open),
            draft: true,
            author_github_user_id: None,
            author_login: None,
            requested_reviewer_github_user_ids: vec!["8".to_string()],
            participant_github_user_ids: vec!["42".to_string()],
            github_updated_at: None,
        }]
    );
}

#[tokio::test]
async fn upsert_after_a_repository_rename_moves_every_record_and_the_row() {
    let old_metadata = serde_json::to_value(EnrichedGithubPullRequest {
        repository_id: Some(99),
        ..pull_request(GithubPullRequestStatus::Open)
    })
    .unwrap();
    let team_record = stored_record(&team(), old_metadata.clone());
    let user_record = stored_record(&user(), old_metadata.clone());
    let foreign_entities =
        StubForeignEntityService::with_records(vec![team_record.clone(), user_record.clone()]);
    let rows = StubPullRequestRows::default();
    rows.rows
        .lock()
        .unwrap()
        .push(GithubPullRequestRow::from_metadata(&old_metadata).unwrap());
    let service = service(&foreign_entities, &rows);

    let upserted = service
        .upsert_pull_request(UpsertGithubPullRequest {
            pull_request: EnrichedGithubPullRequest {
                github_key: "macro/renamed/pull/7".to_string(),
                repo: "renamed".to_string(),
                url: "https://github.com/macro/renamed/pull/7".to_string(),
                display_name: "macro/renamed#7".to_string(),
                repository_id: Some(99),
                ..pull_request(GithubPullRequestStatus::Merged)
            },
            stored_for: team(),
        })
        .await
        .unwrap();

    assert!(foreign_entities.creates().is_empty());
    assert_eq!(upserted.foreign_entity.id, team_record.id);
    assert_eq!(
        upserted.previous_status,
        Some(GithubPullRequestStatus::Open)
    );
    assert!(
        foreign_entities
            .records()
            .iter()
            .all(|record| record.foreign_entity_id == "macro/renamed/pull/7")
    );
    let stored_rows = rows.rows();
    assert_eq!(stored_rows.len(), 1);
    assert_eq!(stored_rows[0].github_key, "macro/renamed/pull/7");
    assert_eq!(stored_rows[0].repo, "renamed");
    assert_eq!(stored_rows[0].status, Some(GithubPullRequestStatus::Merged));
}

#[tokio::test]
async fn index_writes_a_row_for_each_stored_pull_request_of_each_known_repository() {
    let metadata = |key: &str, number: u64, status: &str| {
        serde_json::json!({
            "githubKey": key,
            "owner": "Macro",
            "repo": "App",
            "number": number,
            "url": format!("https://github.com/{key}"),
            "displayName": key,
            "status": status,
        })
    };
    let rows = StubPullRequestRows::default();
    rows.stored.lock().unwrap().extend([
        (
            "macro".to_string(),
            "app".to_string(),
            metadata("Macro/App/pull/7", 7, "closed"),
        ),
        (
            "macro".to_string(),
            "app-web".to_string(),
            metadata("macro/app-web/pull/1", 1, "open"),
        ),
    ]);
    let service = service(&StubForeignEntityService::default(), &rows);

    let indexed = service
        .index_repositories(&[
            GithubRepositoryIdentity {
                id: 99,
                owner: "macro".to_string(),
                name: "app".to_string(),
            },
            GithubRepositoryIdentity {
                id: 0,
                owner: "macro".to_string(),
                name: "app-web".to_string(),
            },
        ])
        .await
        .unwrap();

    assert_eq!(indexed, 1);
    let stored_rows = rows.rows();
    assert_eq!(stored_rows.len(), 1);
    assert_eq!(stored_rows[0].github_key, "Macro/App/pull/7");
    assert_eq!(stored_rows[0].repository_id, Some(99));
    assert_eq!(stored_rows[0].status, Some(GithubPullRequestStatus::Closed));
}

fn listing_query() -> ForeignEntityListQuery {
    Query::Sort(SimpleSortMethod::UpdatedAt, None)
}

#[tokio::test]
async fn listing_without_sources_skips_the_repository() {
    let rows = StubPullRequestRows::default();
    let service = service(&StubForeignEntityService::default(), &rows);

    let listed = service
        .list_pull_requests(Some(USER_ID.to_string()), Vec::new(), 10, listing_query())
        .await
        .unwrap();

    assert!(listed.is_empty());
    assert!(rows.listing_calls().is_empty());
}

#[tokio::test]
async fn listing_forwards_the_caller_sources_limit_and_query() {
    let rows = StubPullRequestRows::default();
    let service = service(&StubForeignEntityService::default(), &rows);
    let cursor_id = Uuid::new_v4();
    let cursor_value = Utc::now();

    service
        .list_pull_requests(
            Some(USER_ID.to_string()),
            vec![user(), team()],
            37,
            Query::Cursor(Cursor {
                id: cursor_id,
                limit: 37,
                val: CursorVal {
                    sort_type: SimpleSortMethod::CreatedAt,
                    last_val: cursor_value,
                },
                filter: None,
            }),
        )
        .await
        .unwrap();

    assert_eq!(
        rows.listing_calls(),
        vec![ListingCall {
            requesting_user: Some(USER_ID.to_string()),
            source_ids: vec![user(), team()],
            limit: 37,
            sort_method: "created_at".to_string(),
            cursor_id: Some(cursor_id),
            cursor_value: Some(cursor_value),
        }]
    );
}

#[tokio::test]
async fn listing_rejects_blank_sources() {
    let rows = StubPullRequestRows::default();
    let service = service(&StubForeignEntityService::default(), &rows);

    let error = service
        .list_pull_requests(None, vec![SourceId::new(" ", "user")], 10, listing_query())
        .await
        .unwrap_err();

    assert!(
        matches!(
            error,
            GithubPullRequestError::ForeignEntity(ForeignEntityError::BadRequest(_))
        ),
        "{error:?}"
    );
    assert!(rows.listing_calls().is_empty());
}

#[tokio::test]
async fn listing_reports_repository_failures() {
    let rows = StubPullRequestRows::default();
    *rows.fail_listings.lock().unwrap() = true;
    let service = service(&StubForeignEntityService::default(), &rows);

    let error = service
        .list_pull_requests(None, vec![user()], 10, listing_query())
        .await
        .unwrap_err();

    let GithubPullRequestError::Repository(error) = error else {
        panic!("expected a repository error, got {error:?}");
    };
    assert!(error.to_string().contains("listing failed"));
}
