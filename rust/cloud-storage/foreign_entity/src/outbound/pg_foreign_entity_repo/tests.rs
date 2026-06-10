use std::sync::Arc;

use chrono::Utc;
use filter_ast::Expr;
use item_filters::ast::{LiteralTree, foreign_entity::ForeignEntityLiteral};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_pagination::{Cursor, CursorVal, Query, SimpleSortMethod};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::PgForeignEntityRepo;
use crate::domain::models::{CreateForeignEntity, ForeignEntity, PatchForeignEntity, SourceId};
use crate::domain::ports::{ForeignEntityListQuery, ForeignEntityRepository};

fn create_request_for_source(
    foreign_entity_id: impl Into<String>,
    foreign_entity_source: impl Into<String>,
    stored_for_id: impl Into<String>,
    stored_for_auth_entity: impl Into<String>,
) -> CreateForeignEntity {
    CreateForeignEntity {
        foreign_entity_id: foreign_entity_id.into(),
        foreign_entity_source: foreign_entity_source.into(),
        metadata: json!({ "origin": "test" }),
        stored_for_id: stored_for_id.into(),
        stored_for_auth_entity: stored_for_auth_entity.into(),
    }
}

async fn insert_foreign_entity(
    repo: &PgForeignEntityRepo,
    foreign_entity_id: &str,
    foreign_entity_source: &str,
) -> ForeignEntity {
    insert_foreign_entity_for_source(
        repo,
        foreign_entity_id,
        foreign_entity_source,
        "document-1",
        "document",
    )
    .await
}

async fn insert_foreign_entity_for_source(
    repo: &PgForeignEntityRepo,
    foreign_entity_id: &str,
    foreign_entity_source: &str,
    stored_for_id: &str,
    stored_for_auth_entity: &str,
) -> ForeignEntity {
    repo.create_foreign_entity(
        Uuid::now_v7(),
        create_request_for_source(
            foreign_entity_id,
            foreign_entity_source,
            stored_for_id,
            stored_for_auth_entity,
        ),
    )
    .await
    .expect("foreign entity should be inserted")
}

fn list_query(sort_method: SimpleSortMethod) -> ForeignEntityListQuery {
    Query::Sort(sort_method, None)
}

fn cursor_query(entity: &ForeignEntity, sort_method: SimpleSortMethod) -> ForeignEntityListQuery {
    let last_val = match sort_method {
        SimpleSortMethod::CreatedAt => entity.created_at,
        SimpleSortMethod::ViewedAt
        | SimpleSortMethod::UpdatedAt
        | SimpleSortMethod::ViewedUpdated => entity.updated_at,
    };

    Query::Cursor(Cursor {
        id: entity.id,
        limit: 2,
        val: CursorVal {
            sort_type: sort_method,
            last_val,
        },
        filter: None,
    })
}

fn filter_query(filter: LiteralTree<ForeignEntityLiteral>) -> ForeignEntityListQuery {
    Query::Sort(SimpleSortMethod::UpdatedAt, filter)
}

fn ids(entities: &[ForeignEntity]) -> Vec<Uuid> {
    entities.iter().map(|entity| entity.id).collect()
}

async fn set_timestamps(
    pool: &PgPool,
    repo: &PgForeignEntityRepo,
    entity: &ForeignEntity,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
) -> ForeignEntity {
    sqlx::query!(
        r#"
        UPDATE foreign_entity
        SET created_at = $2, updated_at = $3
        WHERE id = $1
        "#,
        entity.id,
        created_at,
        updated_at,
    )
    .execute(pool)
    .await
    .expect("foreign entity timestamps should be updated");

    repo.get_foreign_entity_by_id(entity.id)
        .await
        .expect("updated foreign entity lookup should succeed")
        .expect("updated foreign entity should exist")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_inserts_row_and_returns_persisted_fields(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool.clone());
    let id = Uuid::now_v7();
    let create = CreateForeignEntity {
        foreign_entity_id: "external-entity-1".to_string(),
        foreign_entity_source: "linear".to_string(),
        metadata: json!({ "team": "engineering" }),
        stored_for_id: "document-1".to_string(),
        stored_for_auth_entity: "document".to_string(),
    };

    let entity = repo
        .create_foreign_entity(id, create)
        .await
        .expect("foreign entity should be created");

    assert_eq!(entity.id, id);
    assert_eq!(entity.foreign_entity_id, "external-entity-1");
    assert_eq!(entity.foreign_entity_source, "linear");
    assert_eq!(entity.metadata, json!({ "team": "engineering" }));
    assert_eq!(entity.stored_for_id, "document-1");
    assert_eq!(entity.stored_for_auth_entity, "document");
    assert!(entity.created_at <= chrono::Utc::now());
    assert!(entity.updated_at >= entity.created_at);

    let row = sqlx::query!(
        r#"
        SELECT COUNT(*) as "persisted_count!"
        FROM foreign_entity
        WHERE id = $1
        "#,
        id,
    )
    .fetch_one(&pool)
    .await
    .expect("persisted row count should be fetched");

    assert_eq!(row.persisted_count, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_by_id_returns_some_for_existing_and_none_for_missing(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool);
    let entity = insert_foreign_entity(&repo, "external-entity-1", "linear").await;

    let fetched = repo
        .get_foreign_entity_by_id(entity.id)
        .await
        .expect("existing foreign entity lookup should succeed");
    let missing = repo
        .get_foreign_entity_by_id(Uuid::now_v7())
        .await
        .expect("missing foreign entity lookup should succeed");

    assert_eq!(fetched, Some(entity));
    assert_eq!(missing, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_by_foreign_entity_id_returns_all_matches_and_supports_source_filter(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool);
    let first = insert_foreign_entity(&repo, "shared-external-id", "linear").await;
    let second = insert_foreign_entity(&repo, "shared-external-id", "github").await;
    insert_foreign_entity(&repo, "other-external-id", "linear").await;

    let all_matches = repo
        .get_foreign_entities_by_foreign_entity_id("shared-external-id", None)
        .await
        .expect("unfiltered lookup should succeed");
    let source_matches = repo
        .get_foreign_entities_by_foreign_entity_id("shared-external-id", Some("github"))
        .await
        .expect("source-filtered lookup should succeed");
    let missing_source_matches = repo
        .get_foreign_entities_by_foreign_entity_id("shared-external-id", Some("salesforce"))
        .await
        .expect("missing source lookup should succeed");

    let mut all_match_ids = all_matches
        .iter()
        .map(|entity| entity.id)
        .collect::<Vec<_>>();
    all_match_ids.sort_unstable();

    let mut expected_ids = vec![first.id, second.id];
    expected_ids.sort_unstable();

    assert_eq!(all_match_ids, expected_ids);
    assert_eq!(source_matches, vec![second]);
    assert!(missing_source_matches.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_for_user_returns_matching_user_and_team_sources(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool);
    let team_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();
    let user_entity = insert_foreign_entity_for_source(
        &repo,
        "user-visible-pr",
        "github_pull_request",
        "macro|user@example.com",
        "user",
    )
    .await;
    let team_entity = insert_foreign_entity_for_source(
        &repo,
        "team-visible-pr",
        "github_pull_request",
        &team_id.to_string(),
        "team",
    )
    .await;
    insert_foreign_entity_for_source(
        &repo,
        "unrelated-pr",
        "github_pull_request",
        "macro|other@example.com",
        "user",
    )
    .await;

    let entities = repo
        .get_foreign_entities_for_user(
            None,
            vec![
                SourceId::user("macro|user@example.com"),
                SourceId::team(team_id),
            ],
            10,
            list_query(SimpleSortMethod::UpdatedAt),
        )
        .await
        .expect("foreign entities should be listed for matching sources");

    let mut actual_ids = ids(&entities);
    actual_ids.sort_unstable();
    let mut expected_ids = vec![user_entity.id, team_entity.id];
    expected_ids.sort_unstable();

    assert_eq!(actual_ids, expected_ids);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_for_user_empty_sources_returns_empty(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool);
    insert_foreign_entity_for_source(
        &repo,
        "user-visible-pr",
        "github_pull_request",
        "macro|user@example.com",
        "user",
    )
    .await;

    let entities = repo
        .get_foreign_entities_for_user(
            None,
            Vec::new(),
            10,
            list_query(SimpleSortMethod::UpdatedAt),
        )
        .await
        .expect("empty source list should succeed");

    assert!(entities.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_for_user_dedupes_duplicate_source_grants(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool.clone());
    let team_id = Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb").unwrap();
    let older = insert_foreign_entity_for_source(
        &repo,
        "shared-pr",
        "github_pull_request",
        "macro|user@example.com",
        "user",
    )
    .await;
    let newer = insert_foreign_entity_for_source(
        &repo,
        "shared-pr",
        "github_pull_request",
        &team_id.to_string(),
        "team",
    )
    .await;

    let now = Utc::now();
    let older = set_timestamps(
        &pool,
        &repo,
        &older,
        now - chrono::Duration::minutes(2),
        now - chrono::Duration::minutes(2),
    )
    .await;
    let newer = set_timestamps(
        &pool,
        &repo,
        &newer,
        now - chrono::Duration::minutes(1),
        now - chrono::Duration::minutes(1),
    )
    .await;

    let entities = repo
        .get_foreign_entities_for_user(
            None,
            vec![
                SourceId::user("macro|user@example.com"),
                SourceId::team(team_id),
            ],
            10,
            list_query(SimpleSortMethod::UpdatedAt),
        )
        .await
        .expect("duplicate foreign entity grants should be listed once");

    assert_eq!(entities, vec![newer]);
    assert_ne!(entities[0].id, older.id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_for_user_paginates_by_created_at(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool.clone());
    let first = insert_foreign_entity_for_source(
        &repo,
        "first-pr",
        "github_pull_request",
        "macro|user@example.com",
        "user",
    )
    .await;
    let second = insert_foreign_entity_for_source(
        &repo,
        "second-pr",
        "github_pull_request",
        "macro|user@example.com",
        "user",
    )
    .await;
    let third = insert_foreign_entity_for_source(
        &repo,
        "third-pr",
        "github_pull_request",
        "macro|user@example.com",
        "user",
    )
    .await;
    let now = Utc::now();
    let first = set_timestamps(
        &pool,
        &repo,
        &first,
        now - chrono::Duration::minutes(1),
        now - chrono::Duration::minutes(30),
    )
    .await;
    let second = set_timestamps(
        &pool,
        &repo,
        &second,
        now - chrono::Duration::minutes(2),
        now - chrono::Duration::minutes(10),
    )
    .await;
    let third = set_timestamps(
        &pool,
        &repo,
        &third,
        now - chrono::Duration::minutes(3),
        now - chrono::Duration::minutes(20),
    )
    .await;

    let first_page = repo
        .get_foreign_entities_for_user(
            None,
            vec![SourceId::user("macro|user@example.com")],
            2,
            list_query(SimpleSortMethod::CreatedAt),
        )
        .await
        .expect("first created_at page should be fetched");
    let second_page = repo
        .get_foreign_entities_for_user(
            None,
            vec![SourceId::user("macro|user@example.com")],
            2,
            cursor_query(&first_page[1], SimpleSortMethod::CreatedAt),
        )
        .await
        .expect("second created_at page should be fetched");

    assert_eq!(first_page, vec![first, second]);
    assert_eq!(second_page, vec![third]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_for_user_paginates_by_updated_at(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool.clone());
    let first = insert_foreign_entity_for_source(
        &repo,
        "first-pr",
        "github_pull_request",
        "macro|user@example.com",
        "user",
    )
    .await;
    let second = insert_foreign_entity_for_source(
        &repo,
        "second-pr",
        "github_pull_request",
        "macro|user@example.com",
        "user",
    )
    .await;
    let third = insert_foreign_entity_for_source(
        &repo,
        "third-pr",
        "github_pull_request",
        "macro|user@example.com",
        "user",
    )
    .await;
    let now = Utc::now();
    let first = set_timestamps(
        &pool,
        &repo,
        &first,
        now - chrono::Duration::minutes(30),
        now - chrono::Duration::minutes(1),
    )
    .await;
    let second = set_timestamps(
        &pool,
        &repo,
        &second,
        now - chrono::Duration::minutes(10),
        now - chrono::Duration::minutes(2),
    )
    .await;
    let third = set_timestamps(
        &pool,
        &repo,
        &third,
        now - chrono::Duration::minutes(20),
        now - chrono::Duration::minutes(3),
    )
    .await;

    let first_page = repo
        .get_foreign_entities_for_user(
            None,
            vec![SourceId::user("macro|user@example.com")],
            2,
            list_query(SimpleSortMethod::UpdatedAt),
        )
        .await
        .expect("first updated_at page should be fetched");
    let second_page = repo
        .get_foreign_entities_for_user(
            None,
            vec![SourceId::user("macro|user@example.com")],
            2,
            cursor_query(&first_page[1], SimpleSortMethod::UpdatedAt),
        )
        .await
        .expect("second updated_at page should be fetched");

    assert_eq!(first_page, vec![first, second]);
    assert_eq!(second_page, vec![third]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_for_user_applies_foreign_entity_filters(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool);
    let github = insert_foreign_entity_for_source(
        &repo,
        "github-pr",
        "github_pull_request",
        "macro|user@example.com",
        "user",
    )
    .await;
    insert_foreign_entity_for_source(
        &repo,
        "linear-issue",
        "linear_issue",
        "macro|user@example.com",
        "user",
    )
    .await;

    let source_filter = Some(Arc::new(Expr::val(
        ForeignEntityLiteral::ForeignEntitySource("github_pull_request".to_string()),
    )));
    let source_matches = repo
        .get_foreign_entities_for_user(
            None,
            vec![SourceId::user("macro|user@example.com")],
            10,
            filter_query(source_filter),
        )
        .await
        .expect("foreign entity source filter should be applied");

    let not_linear_filter = Some(Arc::new(Expr::is_not(Expr::val(
        ForeignEntityLiteral::ForeignEntityId("linear-issue".to_string()),
    ))));
    let not_linear_matches = repo
        .get_foreign_entities_for_user(
            None,
            vec![SourceId::user("macro|user@example.com")],
            10,
            filter_query(not_linear_filter),
        )
        .await
        .expect("foreign entity negated filter should be applied");

    assert_eq!(source_matches, vec![github.clone()]);
    assert_eq!(not_linear_matches, vec![github]);
}

async fn insert_pr_with_participants(
    repo: &PgForeignEntityRepo,
    foreign_entity_id: &str,
    stored_for_id: &str,
    participant_github_user_ids: Option<&[&str]>,
) -> ForeignEntity {
    let mut metadata = json!({ "displayName": foreign_entity_id });
    if let Some(participants) = participant_github_user_ids {
        metadata["participantGithubUserIds"] = json!(participants);
    }

    repo.create_foreign_entity(
        Uuid::now_v7(),
        CreateForeignEntity {
            foreign_entity_id: foreign_entity_id.into(),
            foreign_entity_source: "github_pull_request".into(),
            metadata,
            stored_for_id: stored_for_id.into(),
            stored_for_auth_entity: "user".into(),
        },
    )
    .await
    .expect("pull request foreign entity should be inserted")
}

async fn insert_github_link(pool: &PgPool, macro_id: &str, github_user_id: &str) {
    let macro_user_id = Uuid::now_v7();
    let email = format!("{macro_user_id}@example.com");

    sqlx::query(
        r#"
        INSERT INTO public.macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(macro_user_id)
    .bind(macro_id)
    .bind(&email)
    .bind(format!("cus_{macro_user_id}"))
    .execute(pool)
    .await
    .expect("macro_user row should be inserted");

    sqlx::query(
        r#"
        INSERT INTO public."User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(macro_id)
    .bind(&email)
    .bind(macro_user_id)
    .execute(pool)
    .await
    .expect("User row should be inserted");

    sqlx::query(
        r#"
        INSERT INTO github_links (id, macro_id, fusionauth_user_id, github_username, github_user_id)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(Uuid::now_v7())
    .bind(macro_id)
    .bind(Uuid::now_v7())
    .bind(format!("gh-{github_user_id}"))
    .bind(github_user_id)
    .execute(pool)
    .await
    .expect("github_links row should be inserted");
}

fn includes_me_filter() -> LiteralTree<ForeignEntityLiteral> {
    Some(Arc::new(Expr::val(ForeignEntityLiteral::IncludesMe)))
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_for_user_includes_me_filters_to_participant_metadata(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool.clone());
    let macro_id = "macro|user@example.com";
    insert_github_link(&pool, macro_id, "42").await;

    let involved =
        insert_pr_with_participants(&repo, "involved-pr", macro_id, Some(&["7", "42"])).await;
    insert_pr_with_participants(&repo, "other-pr", macro_id, Some(&["7"])).await;
    insert_pr_with_participants(&repo, "legacy-pr", macro_id, None).await;

    let entities = repo
        .get_foreign_entities_for_user(
            Some(macro_id.to_string()),
            vec![SourceId::user(macro_id)],
            10,
            filter_query(includes_me_filter()),
        )
        .await
        .expect("includes_me filter should be applied");

    assert_eq!(entities, vec![involved]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_for_user_includes_me_without_github_link_returns_empty(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool);
    let macro_id = "macro|user@example.com";
    insert_pr_with_participants(&repo, "involved-pr", macro_id, Some(&["42"])).await;

    let entities = repo
        .get_foreign_entities_for_user(
            Some(macro_id.to_string()),
            vec![SourceId::user(macro_id)],
            10,
            filter_query(includes_me_filter()),
        )
        .await
        .expect("includes_me without a github link should succeed");

    assert!(entities.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_for_user_includes_me_without_requesting_user_returns_empty(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool.clone());
    let macro_id = "macro|user@example.com";
    insert_github_link(&pool, macro_id, "42").await;
    insert_pr_with_participants(&repo, "involved-pr", macro_id, Some(&["42"])).await;

    let entities = repo
        .get_foreign_entities_for_user(
            None,
            vec![SourceId::user(macro_id)],
            10,
            filter_query(includes_me_filter()),
        )
        .await
        .expect("includes_me without a requesting user should succeed");

    assert!(entities.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_for_user_includes_me_composes_with_other_filters(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool.clone());
    let macro_id = "macro|user@example.com";
    insert_github_link(&pool, macro_id, "42").await;

    let involved = insert_pr_with_participants(&repo, "involved-pr", macro_id, Some(&["42"])).await;
    insert_pr_with_participants(&repo, "other-pr", macro_id, Some(&["7"])).await;
    insert_foreign_entity_for_source(&repo, "linear-issue", "linear_issue", macro_id, "user").await;

    let filter = Some(Arc::new(Expr::and(
        Expr::val(ForeignEntityLiteral::ForeignEntitySource(
            "github_pull_request".to_string(),
        )),
        Expr::val(ForeignEntityLiteral::IncludesMe),
    )));
    let entities = repo
        .get_foreign_entities_for_user(
            Some(macro_id.to_string()),
            vec![SourceId::user(macro_id)],
            10,
            filter_query(filter),
        )
        .await
        .expect("includes_me composed with a source filter should be applied");

    assert_eq!(entities, vec![involved]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_for_user_includes_me_under_not_fails_closed(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool.clone());
    let macro_id = "macro|user@example.com";
    insert_github_link(&pool, macro_id, "42").await;
    insert_pr_with_participants(&repo, "involved-pr", macro_id, Some(&["42"])).await;
    insert_pr_with_participants(&repo, "other-pr", macro_id, Some(&["7"])).await;

    let filter = Some(Arc::new(Expr::is_not(Expr::val(
        ForeignEntityLiteral::IncludesMe,
    ))));
    let entities = repo
        .get_foreign_entities_for_user(
            Some(macro_id.to_string()),
            vec![SourceId::user(macro_id)],
            10,
            filter_query(filter),
        )
        .await
        .expect("unsupported includes_me placement should fail closed");

    assert!(entities.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn patch_updates_selected_fields_preserves_others_and_refreshes_updated_at(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool.clone());
    let entity = insert_foreign_entity(&repo, "external-entity-1", "linear").await;

    sqlx::query!(
        r#"
        UPDATE foreign_entity
        SET updated_at = NOW() - INTERVAL '1 hour'
        WHERE id = $1
        "#,
        entity.id,
    )
    .execute(&pool)
    .await
    .expect("updated_at should be backdated");

    let backdated = repo
        .get_foreign_entity_by_id(entity.id)
        .await
        .expect("backdated foreign entity lookup should succeed")
        .expect("backdated foreign entity should exist");

    let patched = repo
        .patch_foreign_entity(
            entity.id,
            PatchForeignEntity {
                foreign_entity_id: Some("external-entity-2".to_string()),
                metadata: Some(json!({ "patched": true })),
                ..Default::default()
            },
        )
        .await
        .expect("patch should succeed")
        .expect("existing foreign entity should be patched");

    assert_eq!(patched.id, entity.id);
    assert_eq!(patched.foreign_entity_id, "external-entity-2");
    assert_eq!(patched.foreign_entity_source, entity.foreign_entity_source);
    assert_eq!(patched.metadata, json!({ "patched": true }));
    assert_eq!(patched.stored_for_id, entity.stored_for_id);
    assert_eq!(
        patched.stored_for_auth_entity,
        entity.stored_for_auth_entity
    );
    assert_eq!(patched.created_at, entity.created_at);
    assert!(patched.updated_at > backdated.updated_at);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn patch_missing_id_returns_none(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool);

    let result = repo
        .patch_foreign_entity(
            Uuid::now_v7(),
            PatchForeignEntity {
                foreign_entity_source: Some("github".to_string()),
                ..Default::default()
            },
        )
        .await
        .expect("missing patch should succeed");

    assert_eq!(result, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_returns_true_once_and_false_when_repeated(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool);
    let entity = insert_foreign_entity(&repo, "external-entity-1", "linear").await;

    let first_delete = repo
        .delete_foreign_entity(entity.id)
        .await
        .expect("first delete should succeed");
    let second_delete = repo
        .delete_foreign_entity(entity.id)
        .await
        .expect("second delete should succeed");
    let fetched = repo
        .get_foreign_entity_by_id(entity.id)
        .await
        .expect("deleted foreign entity lookup should succeed");

    assert!(first_delete);
    assert!(!second_delete);
    assert_eq!(fetched, None);
}
