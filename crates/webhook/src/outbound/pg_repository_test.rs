use super::*;
use crate::domain::{
    models::{WebhookFilter, WebhookScope, WebhookStatus},
    ports::{WebhookRepo, WebhookWorkspaceResolver},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;
use sqlx::{PgPool, types::Uuid};

const USER_ID: &str = "macro|webhook-owner@example.com";
const SECOND_USER_ID: &str = "macro|webhook-reader@example.com";
const TEAM_ID: &str = "11111111-1111-1111-1111-111111111111";
const UNRELATED_TEAM_ID: &str = "22222222-2222-2222-2222-222222222222";
const OTHER_WORKSPACE_ID: &str = "workspace_other";

fn macro_user_id(user_id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(user_id.to_string()).expect("valid macro user id")
}

fn user_id() -> MacroUserIdStr<'static> {
    macro_user_id(USER_ID)
}

fn second_user_id() -> MacroUserIdStr<'static> {
    macro_user_id(SECOND_USER_ID)
}

fn create_request() -> CreateWebhookRequest {
    create_request_with_namespace("build-events")
}

fn create_request_with_namespace(namespace: &str) -> CreateWebhookRequest {
    CreateWebhookRequest {
        scope: WebhookScope::User,
        namespace: namespace.to_string(),
        name: "Build events".to_string(),
        endpoint_url: "https://example.com/webhook".to_string(),
        headers: None,
        filters: vec![WebhookFilter {
            events: vec!["build.created".to_string()],
            ids: None,
        }],
    }
}

async fn insert_user_with_id(pool: &PgPool, user_id: &str, email: &str) -> anyhow::Result<()> {
    let macro_user_id = macro_uuid::generate_uuid_v7();
    let stripe_customer_id = format!("stripe_{macro_user_id}");
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING
        "#,
        macro_user_id,
        email,
        email,
        stripe_customer_id
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
        "#,
        user_id,
        email,
        macro_user_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_user(pool: &PgPool) -> anyhow::Result<()> {
    insert_user_with_id(pool, USER_ID, "webhook-owner@example.com").await
}

async fn insert_team(pool: &PgPool, team_id: Uuid, owner_id: &str) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO team (id, owner_id, name) VALUES ($1, $2, $3)"#,
        team_id,
        owner_id,
        team_id.to_string(),
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_team_member(pool: &PgPool, user_id: &str, team_id: Uuid) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')"#,
        user_id,
        team_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn create_webhook(repo: &PgRepository) -> Webhook {
    create_webhook_in_workspace(repo, USER_ID, create_request()).await
}

async fn create_webhook_in_workspace(
    repo: &PgRepository,
    workspace_id: &str,
    request: CreateWebhookRequest,
) -> Webhook {
    match try_create_webhook(repo, workspace_id, request).await {
        CreateWebhookOutcome::Created(webhook) => *webhook,
        CreateWebhookOutcome::NamespaceConflict => panic!("unexpected namespace conflict"),
    }
}

async fn try_create_webhook(
    repo: &PgRepository,
    workspace_id: &str,
    request: CreateWebhookRequest,
) -> CreateWebhookOutcome {
    repo.create_webhook(
        user_id(),
        workspace_id.to_string(),
        request,
        "signing-secret".to_string(),
        json!({ "X-Test": "true" }),
    )
    .await
    .expect("create webhook")
}

fn webhook_filter(events: &[&str], ids: Option<&[&str]>) -> WebhookFilter {
    WebhookFilter {
        events: events.iter().map(|event| (*event).to_string()).collect(),
        ids: ids.map(|ids| ids.iter().map(|id| (*id).to_string()).collect()),
    }
}

fn webhook_ids(webhooks: &[Webhook]) -> Vec<&str> {
    webhooks.iter().map(|webhook| webhook.id.as_str()).collect()
}

async fn insert_webhook_for_matching(
    pool: &PgPool,
    id: &str,
    workspace_id: &str,
    filters: Vec<WebhookFilter>,
    status: WebhookStatus,
    is_valid: bool,
    deleted: bool,
) -> anyhow::Result<()> {
    let deleted_at = deleted.then(chrono::Utc::now);
    let endpoint_url = format!("https://example.com/{id}");
    let filters = serde_json::to_value(filters)?;
    let name = format!("{id} webhook");
    let status = status.as_str();

    sqlx::query!(
        r#"
        INSERT INTO webhook (
            id, workspace_id, namespace, name, endpoint_url, signing_secret,
            filters, status, is_valid, created_by_user_id, deleted_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        "#,
        id,
        workspace_id,
        id,
        name,
        endpoint_url,
        "signing-secret",
        filters,
        status,
        is_valid,
        USER_ID,
        deleted_at
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_inserts_webhook_with_filters(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool).await?;
    let repo = PgRepository::new(pool.clone());

    let webhook = create_webhook(&repo).await;

    assert!(webhook.id.starts_with("wh_"));
    assert_eq!(webhook.namespace, "build-events");
    assert_eq!(
        webhook.filters,
        vec![WebhookFilter {
            events: vec!["build.created".to_string()],
            ids: None,
        }]
    );
    assert!(!webhook.is_valid);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_with_taken_namespace_returns_conflict(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool).await?;
    let repo = PgRepository::new(pool.clone());
    let first = create_webhook(&repo).await;

    let outcome = try_create_webhook(&repo, USER_ID, create_request()).await;

    assert!(matches!(outcome, CreateWebhookOutcome::NamespaceConflict));
    let webhooks = repo
        .list_webhooks_for_workspaces(vec![USER_ID.to_string()])
        .await?;
    assert_eq!(webhook_ids(&webhooks), vec![first.id.as_str()]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_with_same_namespace_in_another_workspace_succeeds(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool).await?;
    let repo = PgRepository::new(pool.clone());
    create_webhook(&repo).await;

    let webhook = create_webhook_in_workspace(&repo, OTHER_WORKSPACE_ID, create_request()).await;

    assert_eq!(webhook.workspace_id, OTHER_WORKSPACE_ID);
    assert_eq!(webhook.namespace, "build-events");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn namespace_is_reusable_after_soft_delete(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool).await?;
    let repo = PgRepository::new(pool.clone());
    let deleted = create_webhook(&repo).await;
    repo.delete_webhook(deleted.id.clone()).await?;

    let webhook = create_webhook(&repo).await;

    assert_ne!(webhook.id, deleted.id);
    assert_eq!(webhook.namespace, "build-events");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn object_shaped_filters_are_rejected_by_check_constraint(
    pool: PgPool,
) -> anyhow::Result<()> {
    let result = sqlx::query!(
        r#"
        INSERT INTO webhook (
            id, workspace_id, namespace, name, endpoint_url, signing_secret,
            filters, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
        "wh_object_filters",
        USER_ID,
        "object-filters",
        "Object filters",
        "https://example.com/webhook",
        "signing-secret",
        json!({ "events": ["x"] }),
        USER_ID
    )
    .execute(&pool)
    .await;

    let err = result.expect_err("object-shaped filters should violate array check");
    assert_eq!(
        err.as_database_error().and_then(|db| db.constraint()),
        Some("webhook_filters_is_array")
    );
    Ok(())
}

// EXPLAIN output is planner text rather than application data, so the SQLx
// macros have no types to check here.
#[allow(
    clippy::disallowed_methods,
    reason = "EXPLAIN output is planner text; the macros have nothing to validate"
)]
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn containment_query_uses_filters_gin_index(pool: PgPool) -> anyhow::Result<()> {
    let mut connection = pool.acquire().await?;
    sqlx::query("SET enable_seqscan = off")
        .execute(&mut *connection)
        .await?;

    // EXPLAIN output is planner text rather than application data, so the SQLx
    // macros do not add useful type validation for this assertion.
    let plan_lines = sqlx::query_scalar::<_, String>(
        r#"
        EXPLAIN SELECT id
        FROM webhook
        WHERE filters @> '[{"events": ["document.created"]}]'
        "#,
    )
    .fetch_all(&mut *connection)
    .await?;
    let plan_text = plan_lines.join("\n");

    assert!(
        plan_text.contains("webhook_filters_gin_idx"),
        "expected webhook_filters_gin_idx in plan:\n{plan_text}"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_matching_event_treats_missing_ids_as_wildcard(pool: PgPool) -> anyhow::Result<()> {
    insert_webhook_for_matching(
        &pool,
        "wh_all_ids",
        USER_ID,
        vec![webhook_filter(&["document.created"], None)],
        WebhookStatus::Active,
        true,
        false,
    )
    .await?;
    let repo = PgRepository::new(pool);

    let doc_1_webhooks = repo
        .list_active_webhooks_matching_event(
            vec![USER_ID.to_string()],
            "document.created".to_string(),
            "doc_1".to_string(),
        )
        .await?;
    let doc_2_webhooks = repo
        .list_active_webhooks_matching_event(
            vec![USER_ID.to_string()],
            "document.created".to_string(),
            "doc_2".to_string(),
        )
        .await?;
    let non_matching_event_webhooks = repo
        .list_active_webhooks_matching_event(
            vec![USER_ID.to_string()],
            "document.deleted".to_string(),
            "doc_1".to_string(),
        )
        .await?;

    assert_eq!(webhook_ids(&doc_1_webhooks), vec!["wh_all_ids"]);
    assert_eq!(webhook_ids(&doc_2_webhooks), vec!["wh_all_ids"]);
    assert!(non_matching_event_webhooks.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_matching_event_requires_id_in_same_filter_element(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_webhook_for_matching(
        &pool,
        "wh_doc_1_only",
        USER_ID,
        vec![webhook_filter(&["document.created"], Some(&["doc_1"]))],
        WebhookStatus::Active,
        true,
        false,
    )
    .await?;
    insert_webhook_for_matching(
        &pool,
        "wh_same_element",
        USER_ID,
        vec![
            webhook_filter(&["channel.created"], None),
            webhook_filter(&["document.created"], Some(&["doc_1"])),
        ],
        WebhookStatus::Active,
        true,
        false,
    )
    .await?;
    let repo = PgRepository::new(pool);

    let doc_1_webhooks = repo
        .list_active_webhooks_matching_event(
            vec![USER_ID.to_string()],
            "document.created".to_string(),
            "doc_1".to_string(),
        )
        .await?;
    let doc_2_webhooks = repo
        .list_active_webhooks_matching_event(
            vec![USER_ID.to_string()],
            "document.created".to_string(),
            "doc_2".to_string(),
        )
        .await?;

    assert_eq!(
        webhook_ids(&doc_1_webhooks),
        vec!["wh_doc_1_only", "wh_same_element"]
    );
    assert!(doc_2_webhooks.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_matching_event_excludes_ineligible_webhooks(pool: PgPool) -> anyhow::Result<()> {
    let matching_filter = vec![webhook_filter(&["document.created"], None)];
    insert_webhook_for_matching(
        &pool,
        "wh_active_valid",
        USER_ID,
        matching_filter.clone(),
        WebhookStatus::Active,
        true,
        false,
    )
    .await?;
    insert_webhook_for_matching(
        &pool,
        "wh_paused",
        USER_ID,
        matching_filter.clone(),
        WebhookStatus::Paused,
        true,
        false,
    )
    .await?;
    insert_webhook_for_matching(
        &pool,
        "wh_invalid",
        USER_ID,
        matching_filter.clone(),
        WebhookStatus::Active,
        false,
        false,
    )
    .await?;
    insert_webhook_for_matching(
        &pool,
        "wh_deleted",
        USER_ID,
        matching_filter.clone(),
        WebhookStatus::Active,
        true,
        true,
    )
    .await?;
    insert_webhook_for_matching(
        &pool,
        "wh_other_workspace",
        OTHER_WORKSPACE_ID,
        matching_filter,
        WebhookStatus::Active,
        true,
        false,
    )
    .await?;
    let repo = PgRepository::new(pool);

    let webhooks = repo
        .list_active_webhooks_matching_event(
            vec![USER_ID.to_string()],
            "document.created".to_string(),
            "doc_1".to_string(),
        )
        .await?;

    assert_eq!(webhook_ids(&webhooks), vec!["wh_active_valid"]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_workspaces_returns_every_status_except_deleted(
    pool: PgPool,
) -> anyhow::Result<()> {
    let filter = vec![webhook_filter(&["document.created"], None)];
    // Management view: paused and invalid webhooks are included, unlike the delivery view.
    insert_webhook_for_matching(
        &pool,
        "wh_active",
        USER_ID,
        filter.clone(),
        WebhookStatus::Active,
        true,
        false,
    )
    .await?;
    insert_webhook_for_matching(
        &pool,
        "wh_paused",
        USER_ID,
        filter.clone(),
        WebhookStatus::Paused,
        false,
        false,
    )
    .await?;
    insert_webhook_for_matching(
        &pool,
        "wh_team",
        TEAM_ID,
        filter.clone(),
        WebhookStatus::Active,
        true,
        false,
    )
    .await?;
    // Excluded: soft-deleted, and a workspace the caller does not own.
    insert_webhook_for_matching(
        &pool,
        "wh_deleted",
        USER_ID,
        filter.clone(),
        WebhookStatus::Active,
        true,
        true,
    )
    .await?;
    insert_webhook_for_matching(
        &pool,
        "wh_other_workspace",
        OTHER_WORKSPACE_ID,
        filter,
        WebhookStatus::Active,
        true,
        false,
    )
    .await?;
    let repo = PgRepository::new(pool);

    let webhooks = repo
        .list_webhooks_for_workspaces(vec![USER_ID.to_string(), TEAM_ID.to_string()])
        .await?;

    let mut ids = webhook_ids(&webhooks);
    ids.sort_unstable();
    assert_eq!(ids, vec!["wh_active", "wh_paused", "wh_team"]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn resolved_workspaces_match_personal_and_related_team_webhooks(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool).await?;
    insert_user_with_id(&pool, SECOND_USER_ID, "webhook-reader@example.com").await?;

    let team_id = Uuid::parse_str(TEAM_ID)?;
    let unrelated_team_id = Uuid::parse_str(UNRELATED_TEAM_ID)?;
    insert_team(&pool, team_id, USER_ID).await?;
    insert_team(&pool, unrelated_team_id, SECOND_USER_ID).await?;
    insert_team_member(&pool, USER_ID, team_id).await?;
    insert_team_member(&pool, SECOND_USER_ID, team_id).await?;

    let matching_filter = vec![webhook_filter(&["document.created"], None)];
    insert_webhook_for_matching(
        &pool,
        "wh_personal",
        USER_ID,
        matching_filter.clone(),
        WebhookStatus::Active,
        true,
        false,
    )
    .await?;
    insert_webhook_for_matching(
        &pool,
        "wh_team",
        TEAM_ID,
        matching_filter.clone(),
        WebhookStatus::Active,
        true,
        false,
    )
    .await?;
    insert_webhook_for_matching(
        &pool,
        "wh_unrelated_team",
        UNRELATED_TEAM_ID,
        matching_filter,
        WebhookStatus::Active,
        true,
        false,
    )
    .await?;

    let repo = PgRepository::new(pool);
    let workspace_ids = repo
        .resolve_workspace_ids(vec![
            second_user_id(),
            user_id(),
            second_user_id(),
            user_id(),
        ])
        .await?;

    assert_eq!(
        workspace_ids,
        vec![
            TEAM_ID.to_string(),
            USER_ID.to_string(),
            SECOND_USER_ID.to_string(),
        ]
    );

    let webhooks = repo
        .list_active_webhooks_matching_event(
            workspace_ids,
            "document.created".to_string(),
            "doc_1".to_string(),
        )
        .await?;

    assert_eq!(webhook_ids(&webhooks), vec!["wh_personal", "wh_team"]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn resolve_workspace_ids_returns_empty_for_no_people(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgRepository::new(pool.clone());
    pool.close().await;

    assert!(repo.resolve_workspace_ids(Vec::new()).await?.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn patch_updates_endpoint_and_resets_validity(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool).await?;
    let repo = PgRepository::new(pool.clone());
    let webhook = create_webhook(&repo).await;
    repo.set_webhook_validity(webhook.id.clone(), true).await?;

    let patched = repo
        .patch_webhook(
            webhook.id,
            PatchWebhookRequest {
                name: Some("Deploy events".to_string()),
                endpoint_url: Some("https://example.com/deploy".to_string()),
                headers: None,
                filters: None,
                status: None,
            },
        )
        .await?
        .expect("patched webhook");

    assert_eq!(patched.name, "Deploy events");
    assert_eq!(patched.endpoint_url, "https://example.com/deploy");
    assert!(!patched.is_valid);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_webhook_validity_marks_valid_and_invalid(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool).await?;
    let repo = PgRepository::new(pool);
    let webhook = create_webhook(&repo).await;

    let valid = repo
        .set_webhook_validity(webhook.id.clone(), true)
        .await?
        .expect("valid webhook");
    let invalid = repo
        .set_webhook_validity(webhook.id, false)
        .await?
        .expect("invalid webhook");

    assert!(valid.is_valid);
    assert!(!invalid.is_valid);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_webhook_excludes_deleted_rows(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool).await?;
    let repo = PgRepository::new(pool.clone());
    let webhook = create_webhook(&repo).await;

    sqlx::query!(
        "UPDATE webhook SET deleted_at = now() WHERE id = $1",
        webhook.id
    )
    .execute(&pool)
    .await?;

    assert!(repo.get_webhook(webhook.id).await?.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_user_team_workspace_id_returns_team_membership(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool).await?;
    let team_id = Uuid::parse_str(TEAM_ID)?;
    insert_team(&pool, team_id, USER_ID).await?;
    insert_team_member(&pool, USER_ID, team_id).await?;
    let repo = PgRepository::new(pool);

    assert_eq!(
        WebhookRepo::get_user_team_workspace_id(&repo, user_id()).await?,
        Some(TEAM_ID.to_string())
    );
    assert_eq!(
        WebhookWorkspaceResolver::get_user_team_workspace_id(&repo, user_id()).await?,
        Some(TEAM_ID.to_string())
    );
    Ok(())
}
