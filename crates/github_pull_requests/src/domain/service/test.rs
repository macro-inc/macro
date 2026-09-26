use std::sync::{Arc, Mutex};

use chrono::Utc;
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use foreign_entity::domain::{
    models::{
        CreateForeignEntity, ForeignEntity, ForeignEntityError, PatchForeignEntity, SourceId,
    },
    ports::{ForeignEntityListQuery, ForeignEntityService},
};
use uuid::Uuid;

use super::GithubPullRequestServiceImpl;
use crate::domain::{
    models::{
        EnrichedGithubPullRequest, GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
        GithubPullRequestStatus, UpsertGithubPullRequest,
    },
    ports::GithubPullRequestService,
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
        if let Some(metadata) = patch.metadata {
            record.metadata = metadata;
        }
        record.updated_at = Utc::now();
        Ok(record.clone())
    }
}

fn pull_request(status: GithubPullRequestStatus) -> EnrichedGithubPullRequest {
    EnrichedGithubPullRequest {
        github_key: GITHUB_KEY.to_string(),
        owner: "macro".to_string(),
        repo: "app".to_string(),
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
    let service = GithubPullRequestServiceImpl::new(foreign_entities.clone());

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
    let service = GithubPullRequestServiceImpl::new(foreign_entities.clone());

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
    let service = GithubPullRequestServiceImpl::new(foreign_entities.clone());

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
    let service = GithubPullRequestServiceImpl::new(foreign_entities.clone());

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
    let service = GithubPullRequestServiceImpl::new(foreign_entities.clone());

    let refreshed = service
        .refresh_pull_request(&pull_request(GithubPullRequestStatus::Open))
        .await
        .unwrap();

    assert!(refreshed.is_empty());
    assert!(foreign_entities.patches().is_empty());
}
