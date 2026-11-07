use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use entity_access::domain::models::{
    AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EntityAccessReceipt,
    EntityPermission, EntityType, RequiredPermission, TeamRole, UserTeamInfo, ViewAccessLevel,
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use models_pagination::{Query, SimpleSortMethod};
use serde_json::json;
use uuid::Uuid;

use crate::domain::ports::ForeignEntityListQuery;

use super::*;

type CreateForeignEntityEdit = fn(&mut CreateForeignEntity);

#[derive(Debug, Clone)]
struct ListForeignEntitiesCall {
    source_ids: Vec<SourceId>,
    limit: u32,
    sort_method: String,
    cursor_id: Option<Uuid>,
    cursor_value: Option<DateTime<Utc>>,
}

#[derive(Clone, Default)]
struct FakeForeignEntityRepository {
    records: Arc<Mutex<HashMap<Uuid, ForeignEntity>>>,
    list_calls: Arc<Mutex<Vec<ListForeignEntitiesCall>>>,
    fail_listings: Arc<Mutex<bool>>,
}

impl FakeForeignEntityRepository {
    fn records(&self) -> std::sync::MutexGuard<'_, HashMap<Uuid, ForeignEntity>> {
        self.records
            .lock()
            .expect("fake foreign entity repository lock poisoned")
    }

    fn list_calls(&self) -> Vec<ListForeignEntitiesCall> {
        self.list_calls
            .lock()
            .expect("fake foreign entity repository list call lock poisoned")
            .clone()
    }

    fn fail_listings(&self) {
        *self
            .fail_listings
            .lock()
            .expect("fake foreign entity repository failure lock poisoned") = true;
    }
}

impl ForeignEntityRepository for FakeForeignEntityRepository {
    type Err = anyhow::Error;

    async fn get_foreign_entity_by_id(&self, id: Uuid) -> Result<Option<ForeignEntity>, Self::Err> {
        Ok(self.records().get(&id).cloned())
    }

    async fn get_foreign_entities_by_foreign_entity_id(
        &self,
        foreign_entity_id: &str,
        foreign_entity_source: Option<&str>,
    ) -> Result<Vec<ForeignEntity>, Self::Err> {
        let records = self
            .records()
            .values()
            .filter(|record| {
                record.foreign_entity_id == foreign_entity_id
                    && foreign_entity_source
                        .map(|source| record.foreign_entity_source == source)
                        .unwrap_or(true)
            })
            .cloned()
            .collect();

        Ok(records)
    }

    async fn get_foreign_entities_for_user(
        &self,
        _requesting_user: Option<String>,
        source_ids: Vec<SourceId>,
        limit: u32,
        query: ForeignEntityListQuery,
    ) -> Result<Vec<ForeignEntity>, Self::Err> {
        if *self
            .fail_listings
            .lock()
            .expect("fake foreign entity repository failure lock poisoned")
        {
            anyhow::bail!("listing failed");
        }

        let (cursor_id, cursor_value) = query.vals();
        self.list_calls
            .lock()
            .expect("fake foreign entity repository list call lock poisoned")
            .push(ListForeignEntitiesCall {
                source_ids: source_ids.clone(),
                limit,
                sort_method: query.sort_method().to_string(),
                cursor_id: cursor_id.copied(),
                cursor_value: cursor_value.copied(),
            });

        let records = self
            .records()
            .values()
            .filter(|record| {
                source_ids.iter().any(|source_id| {
                    record.stored_for_id.as_str() == source_id.id.as_str()
                        && record.stored_for_auth_entity.as_str() == source_id.auth_entity.as_str()
                })
            })
            .take(limit as usize)
            .cloned()
            .collect();

        Ok(records)
    }

    async fn create_foreign_entity(
        &self,
        id: Uuid,
        create: CreateForeignEntity,
    ) -> Result<ForeignEntity, Self::Err> {
        let now = Utc::now();
        let entity = ForeignEntity {
            id,
            foreign_entity_id: create.foreign_entity_id,
            foreign_entity_source: create.foreign_entity_source,
            metadata: create.metadata,
            stored_for_id: create.stored_for_id,
            stored_for_auth_entity: create.stored_for_auth_entity,
            created_at: now,
            updated_at: now,
        };

        self.records().insert(id, entity.clone());

        Ok(entity)
    }

    async fn delete_foreign_entity(&self, id: Uuid) -> Result<bool, Self::Err> {
        Ok(self.records().remove(&id).is_some())
    }

    async fn patch_foreign_entity(
        &self,
        id: Uuid,
        patch: PatchForeignEntity,
    ) -> Result<Option<ForeignEntity>, Self::Err> {
        let mut records = self.records();
        let Some(entity) = records.get_mut(&id) else {
            return Ok(None);
        };

        if let Some(foreign_entity_id) = patch.foreign_entity_id {
            entity.foreign_entity_id = foreign_entity_id;
        }
        if let Some(foreign_entity_source) = patch.foreign_entity_source {
            entity.foreign_entity_source = foreign_entity_source;
        }
        if let Some(metadata) = patch.metadata {
            entity.metadata = metadata;
        }
        if let Some(stored_for_id) = patch.stored_for_id {
            entity.stored_for_id = stored_for_id;
        }
        if let Some(stored_for_auth_entity) = patch.stored_for_auth_entity {
            entity.stored_for_auth_entity = stored_for_auth_entity;
        }

        entity.updated_at = Utc::now();

        Ok(Some(entity.clone()))
    }
}

fn service() -> ForeignEntityServiceImpl<FakeForeignEntityRepository> {
    ForeignEntityServiceImpl::new(FakeForeignEntityRepository::default())
}

fn valid_create() -> CreateForeignEntity {
    CreateForeignEntity {
        foreign_entity_id: "external-entity-1".to_string(),
        foreign_entity_source: "linear".to_string(),
        metadata: json!({ "team": "engineering" }),
        stored_for_id: "document-1".to_string(),
        stored_for_auth_entity: "document".to_string(),
    }
}

fn foreign_entity_for_source(stored_for_id: &str, stored_for_auth_entity: &str) -> ForeignEntity {
    let now = Utc::now();

    ForeignEntity {
        id: Uuid::new_v4(),
        foreign_entity_id: format!("external-{stored_for_id}"),
        foreign_entity_source: "github_pull_request".to_string(),
        metadata: json!({}),
        stored_for_id: stored_for_id.to_string(),
        stored_for_auth_entity: stored_for_auth_entity.to_string(),
        created_at: now,
        updated_at: now,
    }
}

fn listing_query(sort_method: SimpleSortMethod) -> ForeignEntityListQuery {
    Query::Sort(sort_method, None)
}

fn foreign_entity_receipt(entity_id: &str) -> EntityAccessReceipt<ViewAccessLevel> {
    receipt_for_type(entity_id, EntityType::ForeignEntity)
}

fn receipt_for_type(
    entity_id: &str,
    entity_type: EntityType,
) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_internal_user(entity_id, entity_type)
}

fn assert_bad_request(error: ForeignEntityError, expected_message: &str) {
    let ForeignEntityError::BadRequest(message) = error else {
        panic!("expected bad request error, got {error:?}");
    };

    assert!(
        message.contains(expected_message),
        "expected bad request message '{message}' to contain '{expected_message}'"
    );
}

fn assert_not_found(error: ForeignEntityError, expected_id: Uuid) {
    let ForeignEntityError::NotFound(actual_id) = error else {
        panic!("expected not found error, got {error:?}");
    };

    assert_eq!(actual_id, expected_id);
}

#[tokio::test]
async fn create_persists_foreign_entity_with_generated_id() {
    let service = service();

    let created = service
        .create_foreign_entity(valid_create())
        .await
        .expect("valid foreign entity should be created");

    assert_ne!(created.id, Uuid::nil());
    assert_eq!(created.foreign_entity_id, "external-entity-1");
    assert_eq!(created.foreign_entity_source, "linear");
    assert_eq!(created.metadata, json!({ "team": "engineering" }));
    assert_eq!(created.stored_for_id, "document-1");
    assert_eq!(created.stored_for_auth_entity, "document");

    let fetched = service
        .get_foreign_entity_by_id(created.id)
        .await
        .expect("created foreign entity should be fetched");

    assert_eq!(fetched, created);
}

#[tokio::test]
async fn get_foreign_entity_returns_matching_record_from_receipt() {
    let service = service();
    let created = service
        .create_foreign_entity(valid_create())
        .await
        .expect("valid foreign entity should be created");

    let fetched = service
        .get_foreign_entity(foreign_entity_receipt(&created.id.to_string()))
        .await
        .expect("created foreign entity should be fetched by receipt");

    assert_eq!(fetched, created);
}

#[tokio::test]
async fn get_foreign_entity_missing_row_returns_not_found() {
    let service = service();
    let id = Uuid::new_v4();

    let error = service
        .get_foreign_entity(foreign_entity_receipt(&id.to_string()))
        .await
        .expect_err("missing foreign entity should return not found");

    assert_not_found(error, id);
}

#[tokio::test]
async fn get_foreign_entity_rejects_invalid_uuid_receipt() {
    let service = service();

    let error = service
        .get_foreign_entity(foreign_entity_receipt("not-a-uuid"))
        .await
        .expect_err("invalid receipt UUID should be rejected");

    assert_bad_request(error, "valid UUID");
}

#[tokio::test]
async fn get_foreign_entity_rejects_wrong_entity_type_receipt() {
    let service = service();
    let id = Uuid::new_v4();

    let error = service
        .get_foreign_entity(receipt_for_type(&id.to_string(), EntityType::Document))
        .await
        .expect_err("wrong receipt entity type should be rejected");

    assert_bad_request(error, "ForeignEntity");
}

#[tokio::test]
async fn get_by_foreign_entity_id_returns_all_matching_records() {
    let service = service();
    let mut second_create = valid_create();
    second_create.foreign_entity_source = "github".to_string();

    service
        .create_foreign_entity(valid_create())
        .await
        .expect("first foreign entity should be created");
    service
        .create_foreign_entity(second_create)
        .await
        .expect("second foreign entity should be created");

    let all_matches = service
        .get_foreign_entities_by_foreign_entity_id("external-entity-1", None)
        .await
        .expect("matching foreign entities should be returned");
    let source_matches = service
        .get_foreign_entities_by_foreign_entity_id("external-entity-1", Some("github"))
        .await
        .expect("source-filtered foreign entities should be returned");

    assert_eq!(all_matches.len(), 2);
    assert_eq!(source_matches.len(), 1);
    assert_eq!(source_matches[0].foreign_entity_source, "github");
}

#[tokio::test]
async fn get_foreign_entities_for_user_returns_matching_sources() {
    let repo = FakeForeignEntityRepository::default();
    let matching_user = foreign_entity_for_source("macro|user@example.com", "user");
    let matching_team = foreign_entity_for_source("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "team");
    let unrelated = foreign_entity_for_source("macro|other@example.com", "user");

    repo.records()
        .insert(matching_user.id, matching_user.clone());
    repo.records()
        .insert(matching_team.id, matching_team.clone());
    repo.records().insert(unrelated.id, unrelated);

    let service = ForeignEntityServiceImpl::new(repo);
    let entities = service
        .get_foreign_entities_for_user(
            None,
            vec![
                SourceId::user("macro|user@example.com"),
                SourceId::new("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "team"),
            ],
            10,
            listing_query(SimpleSortMethod::UpdatedAt),
        )
        .await
        .expect("matching foreign entities should be returned");

    let mut ids = entities.iter().map(|entity| entity.id).collect::<Vec<_>>();
    ids.sort_unstable();
    let mut expected_ids = vec![matching_user.id, matching_team.id];
    expected_ids.sort_unstable();

    assert_eq!(ids, expected_ids);
}

#[tokio::test]
async fn get_foreign_entities_for_user_empty_sources_returns_empty_without_repo_call() {
    let repo = FakeForeignEntityRepository::default();
    let service = ForeignEntityServiceImpl::new(repo.clone());

    let entities = service
        .get_foreign_entities_for_user(
            None,
            Vec::new(),
            10,
            listing_query(SimpleSortMethod::UpdatedAt),
        )
        .await
        .expect("empty source list should return an empty listing");

    assert!(entities.is_empty());
    assert!(repo.list_calls().is_empty());
}

#[tokio::test]
async fn get_foreign_entities_for_user_forwards_limit_and_query() {
    let repo = FakeForeignEntityRepository::default();
    let service = ForeignEntityServiceImpl::new(repo.clone());
    let cursor_id = Uuid::new_v4();
    let cursor_value = Utc::now();

    service
        .get_foreign_entities_for_user(
            None,
            vec![SourceId::user("macro|user@example.com")],
            37,
            Query::Cursor(models_pagination::Cursor {
                id: cursor_id,
                limit: 37,
                val: models_pagination::CursorVal {
                    sort_type: SimpleSortMethod::CreatedAt,
                    last_val: cursor_value,
                },
                filter: None,
            }),
        )
        .await
        .expect("listing should be forwarded to repository");

    let calls = repo.list_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].source_ids,
        vec![SourceId::user("macro|user@example.com")]
    );
    assert_eq!(calls[0].limit, 37);
    assert_eq!(calls[0].sort_method, "created_at");
    assert_eq!(calls[0].cursor_id, Some(cursor_id));
    assert_eq!(calls[0].cursor_value, Some(cursor_value));
}

#[tokio::test]
async fn get_foreign_entities_for_user_maps_repo_errors_to_internal() {
    let repo = FakeForeignEntityRepository::default();
    repo.fail_listings();
    let service = ForeignEntityServiceImpl::new(repo);

    let error = service
        .get_foreign_entities_for_user(
            None,
            vec![SourceId::user("macro|user@example.com")],
            10,
            listing_query(SimpleSortMethod::UpdatedAt),
        )
        .await
        .expect_err("repository errors should map to internal errors");

    let ForeignEntityError::Internal(error) = error else {
        panic!("expected internal error, got {error:?}");
    };
    assert!(error.to_string().contains("listing failed"));
}

#[tokio::test]
async fn get_missing_foreign_entity_by_id_returns_not_found() {
    let service = service();
    let id = Uuid::new_v4();

    let error = service
        .get_foreign_entity_by_id(id)
        .await
        .expect_err("missing foreign entity should return not found");

    assert_not_found(error, id);
}

#[tokio::test]
async fn create_rejects_blank_required_fields() {
    let service = service();
    let cases: Vec<(&str, CreateForeignEntityEdit)> = vec![
        ("foreignEntityId", |create| {
            create.foreign_entity_id = " \t".to_string();
        }),
        ("foreignEntitySource", |create| {
            create.foreign_entity_source = "\n".to_string();
        }),
        ("storedForId", |create| {
            create.stored_for_id = " ".to_string();
        }),
        ("storedForAuthEntity", |create| {
            create.stored_for_auth_entity = "\r\n".to_string();
        }),
    ];

    for (field_name, make_blank) in cases {
        let mut create = valid_create();
        make_blank(&mut create);

        let error = service
            .create_foreign_entity(create)
            .await
            .expect_err("blank create field should be rejected");

        assert_bad_request(error, field_name);
    }
}

#[tokio::test]
async fn patch_rejects_empty_patch() {
    let service = service();

    let error = service
        .patch_foreign_entity(Uuid::new_v4(), PatchForeignEntity::default())
        .await
        .expect_err("empty patch should be rejected");

    assert_bad_request(error, "at least one field");
}

#[tokio::test]
async fn patch_rejects_blank_string_fields() {
    let service = service();
    let cases = vec![
        (
            "foreignEntityId",
            PatchForeignEntity {
                foreign_entity_id: Some(" ".to_string()),
                ..Default::default()
            },
        ),
        (
            "foreignEntitySource",
            PatchForeignEntity {
                foreign_entity_source: Some("\t".to_string()),
                ..Default::default()
            },
        ),
        (
            "storedForId",
            PatchForeignEntity {
                stored_for_id: Some("\n".to_string()),
                ..Default::default()
            },
        ),
        (
            "storedForAuthEntity",
            PatchForeignEntity {
                stored_for_auth_entity: Some("\r\n".to_string()),
                ..Default::default()
            },
        ),
    ];

    for (field_name, patch) in cases {
        let error = service
            .patch_foreign_entity(Uuid::new_v4(), patch)
            .await
            .expect_err("blank patch field should be rejected");

        assert_bad_request(error, field_name);
    }
}

#[tokio::test]
async fn patch_missing_foreign_entity_returns_not_found() {
    let service = service();
    let id = Uuid::new_v4();

    let error = service
        .patch_foreign_entity(
            id,
            PatchForeignEntity {
                metadata: Some(json!({ "status": "updated" })),
                ..Default::default()
            },
        )
        .await
        .expect_err("missing foreign entity should return not found");

    assert_not_found(error, id);
}

#[tokio::test]
async fn delete_returns_ok_when_deleted_and_not_found_when_missing() {
    let service = service();
    let created = service
        .create_foreign_entity(valid_create())
        .await
        .expect("valid foreign entity should be created");

    service
        .delete_foreign_entity(created.id)
        .await
        .expect("existing foreign entity should be deleted");

    let error = service
        .delete_foreign_entity(created.id)
        .await
        .expect_err("second delete should return not found");

    assert_not_found(error, created.id);
}

/// Entity access stub that grants view access to an explicit allow list and
/// answers `Unauthorized` — the way the real service reports "no access" — for
/// everything else.
#[derive(Clone, Default)]
struct FakeEntityAccessService {
    viewable: Arc<Mutex<HashSet<(String, String)>>>,
}

impl FakeEntityAccessService {
    fn with_viewable(entries: impl IntoIterator<Item = (String, String)>) -> Self {
        Self {
            viewable: Arc::new(Mutex::new(entries.into_iter().collect())),
        }
    }
}

impl EntityAccessService for FakeEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unreachable!("by-source lookups check permissions, they do not mint receipts")
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unreachable!("by-source lookups do not accept bot credentials")
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        unreachable!("by-source lookups use get_entity_permission")
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unreachable!("by-source lookups use get_entity_permission")
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unreachable!("by-source lookups use get_entity_permission")
    }

    async fn get_entity_permission(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        assert_eq!(entity_type, EntityType::ForeignEntity);

        let user_id = user_id
            .expect("by-source lookups only check permissions for authenticated users")
            .as_ref()
            .to_string();
        let viewable = self
            .viewable
            .lock()
            .expect("fake entity access service lock poisoned");

        if viewable.contains(&(user_id, entity_id.to_string())) {
            return Ok(EntityPermission::AccessLevel {
                access_level: AccessLevel::View,
            });
        }

        Err(AccessError::Unauthorized)
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        unreachable!("foreign entities are not CRM entities")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        unreachable!("by-source lookups do not list entity users")
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unreachable!("by-source lookups do not resolve call channels")
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unreachable!("by-source lookups do not resolve call channels")
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        unreachable!("by-source lookups do not resolve user teams")
    }
}

const TEST_USER_ID: &str = "macro|user@macro.com";
const PULL_REQUEST_SOURCE: &str = "github_pull_request";
const PULL_REQUEST_KEY: &str = "macro/app/pull/42";

fn caller_user(user_id: &str) -> ForeignEntityLookupCaller {
    ForeignEntityLookupCaller::User(
        MacroUserIdStr::try_from(user_id.to_string()).expect("test user id should parse"),
    )
}

async fn store_pull_request_mapping(
    service: &ForeignEntityServiceImpl<FakeForeignEntityRepository>,
    stored_for_id: &str,
) -> ForeignEntity {
    service
        .create_foreign_entity(CreateForeignEntity {
            foreign_entity_id: PULL_REQUEST_KEY.to_string(),
            foreign_entity_source: PULL_REQUEST_SOURCE.to_string(),
            metadata: json!({ "number": 42 }),
            stored_for_id: stored_for_id.to_string(),
            stored_for_auth_entity: "document".to_string(),
        })
        .await
        .expect("pull request mapping should be created")
}

fn assert_not_found_for_source(error: ForeignEntityError) {
    let ForeignEntityError::NotFoundForSource {
        foreign_entity_source,
        foreign_entity_id,
    } = error
    else {
        panic!("expected not found for source error, got {error:?}");
    };

    assert_eq!(foreign_entity_source, PULL_REQUEST_SOURCE);
    assert_eq!(foreign_entity_id, PULL_REQUEST_KEY);
}

#[tokio::test]
async fn by_source_returns_the_record_an_internal_caller_asked_for() {
    let service = service();
    let stored = store_pull_request_mapping(&service, "document-1").await;

    let found = get_visible_foreign_entity_by_source(
        &service,
        &FakeEntityAccessService::default(),
        &ForeignEntityLookupCaller::Internal,
        PULL_REQUEST_SOURCE,
        PULL_REQUEST_KEY,
    )
    .await
    .expect("internal callers should see every mapping");

    assert_eq!(found, stored);
}

#[tokio::test]
async fn by_source_returns_the_first_record_the_user_may_view() {
    let service = service();
    let hidden = store_pull_request_mapping(&service, "document-hidden").await;
    let visible = store_pull_request_mapping(&service, "document-visible").await;
    let entity_access = FakeEntityAccessService::with_viewable([(
        TEST_USER_ID.to_string(),
        visible.id.to_string(),
    )]);

    let found = get_visible_foreign_entity_by_source(
        &service,
        &entity_access,
        &caller_user(TEST_USER_ID),
        PULL_REQUEST_SOURCE,
        PULL_REQUEST_KEY,
    )
    .await
    .expect("the mapping the user may view should be returned");

    assert_eq!(found, visible);
    assert_ne!(found.id, hidden.id);
}

#[tokio::test]
async fn by_source_hides_records_the_user_may_not_view() {
    let service = service();
    store_pull_request_mapping(&service, "document-hidden").await;

    let error = get_visible_foreign_entity_by_source(
        &service,
        &FakeEntityAccessService::default(),
        &caller_user(TEST_USER_ID),
        PULL_REQUEST_SOURCE,
        PULL_REQUEST_KEY,
    )
    .await
    .expect_err("a mapping the user cannot view should read as not found");

    assert_not_found_for_source(error);
}

#[tokio::test]
async fn by_source_returns_not_found_when_nothing_matches() {
    let service = service();

    let error = get_visible_foreign_entity_by_source(
        &service,
        &FakeEntityAccessService::default(),
        &ForeignEntityLookupCaller::Internal,
        PULL_REQUEST_SOURCE,
        PULL_REQUEST_KEY,
    )
    .await
    .expect_err("an unsynced pull request should read as not found");

    assert_not_found_for_source(error);
}

#[tokio::test]
async fn by_source_ignores_records_from_another_source() {
    let service = service();
    service
        .create_foreign_entity(CreateForeignEntity {
            foreign_entity_id: PULL_REQUEST_KEY.to_string(),
            foreign_entity_source: "linear".to_string(),
            metadata: json!({}),
            stored_for_id: "document-1".to_string(),
            stored_for_auth_entity: "document".to_string(),
        })
        .await
        .expect("linear mapping should be created");

    let error = get_visible_foreign_entity_by_source(
        &service,
        &FakeEntityAccessService::default(),
        &ForeignEntityLookupCaller::Internal,
        PULL_REQUEST_SOURCE,
        PULL_REQUEST_KEY,
    )
    .await
    .expect_err("a mapping from another source should not match");

    assert_not_found_for_source(error);
}
