use super::*;
use crate::domain::mcp::models::McpSubscriptionKey;
use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const ME: &str = "macro|mcp-subscriber@example.com";
const OTHER: &str = "macro|mcp-other@example.com";
const URL: &str = "https://hooks.example.com/events";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).expect("valid user id")
}

async fn insert_user(pool: &PgPool, user_id: &str) -> anyhow::Result<()> {
    let macro_user_id = macro_uuid::generate_uuid_v7();
    let email = user_id.trim_start_matches("macro|");
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
        macro_user_id,
        email,
        format!("stripe_{macro_user_id}"),
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn setup(pool: &PgPool) -> anyhow::Result<PgMcpSubscriptionRepository> {
    insert_user(pool, ME).await?;
    insert_user(pool, OTHER).await?;
    Ok(PgMcpSubscriptionRepository::new(pool.clone()))
}

fn upsert(user_id: &str, url: &str, query: &str, events: &[&str], expires_in: Duration) -> McpSubscriptionUpsert {
    let key = McpSubscriptionKey {
        user_id: user(user_id),
        endpoint_url: url.to_owned(),
        event_type: "macro.events".to_owned(),
        arguments: serde_json::json!({ "query": query }),
    };
    McpSubscriptionUpsert {
        id: Uuid::now_v7(),
        subscription_id: key.id(),
        key,
        filter: McpEventFilter::for_events(events.iter().map(|e| (*e).to_owned()).collect(), None),
        secret: McpSecretCiphertext {
            ciphertext: vec![1, 2, 3],
            kms_key_id: "alias/key".to_owned(),
            encryption_version: 1,
        },
        expires_at: Utc::now() + expires_in,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn upsert_inserts_then_refreshes_in_place(pool: PgPool) -> anyhow::Result<()> {
    let repo = setup(&pool).await?;
    let first = upsert(ME, URL, "mentions", &["message.mentioned"], Duration::hours(1));
    let stored = repo.upsert(first.clone()).await?;
    assert_eq!(stored.id, first.id);
    assert_eq!(stored.subscription_id, first.subscription_id);
    assert_eq!(stored.arguments, serde_json::json!({ "query": "mentions" }));
    assert_eq!(stored.filter, first.filter);
    assert_eq!(
        repo.get(&user(ME), &first.subscription_id).await?,
        Some(stored.clone())
    );

    let mut refresh = first.clone();
    refresh.id = Uuid::now_v7();
    refresh.secret.ciphertext = vec![9];
    refresh.filter = McpEventFilter::for_events(vec!["message.posted".to_owned()], None);
    refresh.expires_at = Utc::now() + Duration::hours(2);
    let refreshed = repo.upsert(refresh.clone()).await?;
    assert_eq!(refreshed.id, first.id, "the row keeps its id");
    assert_eq!(refreshed.secret.ciphertext, vec![9]);
    assert_eq!(refreshed.filter, refresh.filter);
    assert!(refreshed.expires_at > stored.expires_at);

    let matching = repo
        .list_live_matching(vec![ME.to_owned()], "message.posted")
        .await?;
    assert_eq!(matching.len(), 1, "events follow the refreshed filter");
    assert!(
        repo.list_live_matching(vec![ME.to_owned()], "message.mentioned")
            .await?
            .is_empty()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn expired_rows_are_not_live(pool: PgPool) -> anyhow::Result<()> {
    let repo = setup(&pool).await?;
    let expired = repo
        .upsert(upsert(ME, URL, "old", &["message.posted"], -Duration::minutes(1)))
        .await?;
    let live = repo
        .upsert(upsert(ME, URL, "new", &["message.posted"], Duration::hours(1)))
        .await?;

    assert!(repo.get(&user(ME), &expired.subscription_id).await?.is_some());
    assert_eq!(repo.get_live(expired.id).await?, None);
    assert_eq!(repo.get_live(live.id).await?, Some(live.clone()));
    assert_eq!(repo.count_live(&user(ME)).await?, 1);
    let matching = repo
        .list_live_matching(vec![ME.to_owned()], "message.posted")
        .await?;
    assert_eq!(matching, vec![live.clone()]);

    assert_eq!(repo.delete_expired(&user(ME)).await?, 1);
    assert!(repo.get(&user(ME), &expired.subscription_id).await?.is_none());
    assert_eq!(repo.delete_expired(&user(ME)).await?, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_is_scoped_to_the_user(pool: PgPool) -> anyhow::Result<()> {
    let repo = setup(&pool).await?;
    let mine = repo
        .upsert(upsert(ME, URL, "mentions", &["message.mentioned"], Duration::hours(1)))
        .await?;
    assert!(!repo.delete(&user(OTHER), &mine.subscription_id).await?);
    assert!(repo.delete(&user(ME), &mine.subscription_id).await?);
    assert!(!repo.delete(&user(ME), &mine.subscription_id).await?);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn live_endpoint_is_per_user_and_url(pool: PgPool) -> anyhow::Result<()> {
    let repo = setup(&pool).await?;
    repo.upsert(upsert(ME, URL, "mentions", &["message.mentioned"], Duration::hours(1)))
        .await?;
    repo.upsert(upsert(
        ME,
        "https://hooks.example.com/expired",
        "mentions",
        &["message.mentioned"],
        -Duration::minutes(1),
    ))
    .await?;
    assert!(repo.has_live_endpoint(&user(ME), URL).await?);
    assert!(!repo.has_live_endpoint(&user(OTHER), URL).await?);
    assert!(
        !repo
            .has_live_endpoint(&user(ME), "https://hooks.example.com/expired")
            .await?
    );
    assert!(
        !repo
            .has_live_endpoint(&user(ME), "https://hooks.example.com/other")
            .await?
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn matching_reads_only_the_audience(pool: PgPool) -> anyhow::Result<()> {
    let repo = setup(&pool).await?;
    let mine = repo
        .upsert(upsert(ME, URL, "mentions", &["message.mentioned"], Duration::hours(1)))
        .await?;
    let theirs = repo
        .upsert(upsert(OTHER, URL, "mentions", &["message.mentioned"], Duration::hours(1)))
        .await?;

    let only_me = repo
        .list_live_matching(
            vec![ME.to_owned(), "11111111-1111-1111-1111-111111111111".to_owned()],
            "message.mentioned",
        )
        .await?;
    assert_eq!(only_me, vec![mine.clone()]);

    let mut both = repo
        .list_live_matching(vec![ME.to_owned(), OTHER.to_owned()], "message.mentioned")
        .await?;
    both.sort_by_key(|subscription| subscription.id);
    let mut expected = vec![mine, theirs];
    expected.sort_by_key(|subscription| subscription.id);
    assert_eq!(both, expected);

    assert!(
        repo.list_live_matching(vec![ME.to_owned()], "document.created")
            .await?
            .is_empty()
    );
    Ok(())
}
