use super::*;
use crate::domain::mcp::models::{McpDeliveryProfile, McpPreviousSecret, McpSubscriptionKey};
use crate::domain::mcp::service::SWEEP_BATCH;
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

fn upsert(
    user_id: &str,
    url: &str,
    query: &str,
    events: &[&str],
    expires_in: Duration,
) -> McpSubscriptionUpsert {
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
        read_secret: None,
        previous_secret: None,
        profile: McpDeliveryProfile::Mcp,
        expires_at: Utc::now() + expires_in,
    }
}

const MAX: u32 = 50;

/// Store `upsert` as the service does: decided against the row as read now.
async fn store(
    repo: &PgMcpSubscriptionRepository,
    mut upsert: McpSubscriptionUpsert,
) -> anyhow::Result<McpEventSubscription> {
    upsert.read_secret = repo
        .get(&upsert.key.user_id, &upsert.subscription_id)
        .await?
        .map(|row| row.secret.ciphertext);
    match repo.store_within_quota(upsert, MAX).await? {
        McpStoreOutcome::Stored(row) => Ok(*row),
        outcome => anyhow::bail!("unexpected {outcome:?}"),
    }
}

async fn candidates(
    repo: &PgMcpSubscriptionRepository,
    users: &[&str],
    event_name: &str,
) -> anyhow::Result<Vec<Uuid>> {
    let users: Vec<String> = users.iter().map(|user| (*user).to_owned()).collect();
    let mut ids: Vec<Uuid> = repo
        .list_match_candidates(&users, event_name)
        .await?
        .into_iter()
        .map(|candidate| candidate.id)
        .collect();
    ids.sort();
    Ok(ids)
}

async fn index_rows(pool: &PgPool) -> anyhow::Result<i64> {
    Ok(
        sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM mcp_event_subscription_event"#)
            .fetch_one(pool)
            .await?,
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn store_inserts_then_refreshes_in_place(pool: PgPool) -> anyhow::Result<()> {
    let repo = setup(&pool).await?;
    let first = upsert(
        ME,
        URL,
        "mentions",
        &["message.mentioned"],
        Duration::hours(1),
    );
    let stored = store(&repo, first.clone()).await?;
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
    let previous = McpPreviousSecret {
        secret: first.secret.clone(),
        expires_at: Utc::now() + Duration::minutes(10),
    };
    refresh.previous_secret = Some(previous.clone());
    refresh.profile = McpDeliveryProfile::Chatgpt;
    let refreshed = store(&repo, refresh.clone()).await?;
    assert_eq!(refreshed.id, first.id, "the row keeps its id");
    assert_eq!(refreshed.secret.ciphertext, vec![9]);
    assert_eq!(refreshed.profile, McpDeliveryProfile::Chatgpt);
    let stored_previous = refreshed.previous_secret.clone().expect("kept");
    assert_eq!(stored_previous.secret, previous.secret);
    assert_eq!(
        stored_previous.expires_at.timestamp_micros(),
        previous.expires_at.timestamp_micros()
    );
    assert_eq!(repo.get_live(first.id).await?, Some(refreshed.clone()));
    assert_eq!(refreshed.filter, refresh.filter);
    assert!(refreshed.expires_at > stored.expires_at);

    assert_eq!(
        candidates(&repo, &[ME], "message.posted").await?,
        vec![first.id],
        "events follow the refreshed filter"
    );
    assert!(
        candidates(&repo, &[ME], "message.mentioned")
            .await?
            .is_empty()
    );
    assert_eq!(index_rows(&pool).await?, 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn candidates_carry_the_owner_and_filter(pool: PgPool) -> anyhow::Result<()> {
    let repo = setup(&pool).await?;
    let stored = store(
        &repo,
        upsert(
            ME,
            URL,
            "mentions",
            &["message.mentioned", "message.posted"],
            Duration::hours(1),
        ),
    )
    .await?;
    let found = repo
        .list_match_candidates(&[ME.to_owned()], "message.posted")
        .await?;
    assert_eq!(
        found,
        vec![McpMatchCandidate {
            id: stored.id,
            user_id: user(ME),
            filter: stored.filter,
        }]
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn expired_rows_are_not_live(pool: PgPool) -> anyhow::Result<()> {
    let repo = setup(&pool).await?;
    let live = store(
        &repo,
        upsert(ME, URL, "new", &["message.posted"], Duration::hours(1)),
    )
    .await?;
    let expired = store(
        &repo,
        upsert(ME, URL, "old", &["message.posted"], -Duration::minutes(1)),
    )
    .await?;

    assert!(
        repo.get(&user(ME), &expired.subscription_id)
            .await?
            .is_some()
    );
    assert_eq!(repo.get_live(expired.id).await?, None);
    assert_eq!(repo.get_live(live.id).await?, Some(live.clone()));
    assert_eq!(
        candidates(&repo, &[ME], "message.posted").await?,
        vec![live.id]
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sweeping_deletes_expired_rows_in_batches(pool: PgPool) -> anyhow::Result<()> {
    let repo = setup(&pool).await?;
    let live = store(
        &repo,
        upsert(ME, URL, "live", &["message.posted"], Duration::hours(1)),
    )
    .await?;
    for (owner, query) in [(ME, "a"), (ME, "b"), (OTHER, "c")] {
        store(
            &repo,
            upsert(
                owner,
                URL,
                query,
                &["message.posted"],
                -Duration::minutes(1),
            ),
        )
        .await?;
    }
    assert_eq!(index_rows(&pool).await?, 4);
    // More than one batch: copies of an expired row under new ids.
    let extra = u64::from(SWEEP_BATCH) - 1;
    sqlx::query!(
        r#"
        INSERT INTO mcp_event_subscription (
            id, user_id, subscription_id, event_type, arguments, filter,
            endpoint_url, secret_ciphertext, secret_kms_key_id,
            secret_encryption_version, expires_at
        )
        SELECT gen_random_uuid(), user_id, subscription_id || '_' || n, event_type,
            arguments, filter, endpoint_url, secret_ciphertext, secret_kms_key_id,
            secret_encryption_version, expires_at
        FROM mcp_event_subscription
        CROSS JOIN generate_series(1, $1::bigint) AS n
        WHERE user_id = $2 AND expires_at <= now()
        "#,
        i64::try_from(extra)?,
        OTHER,
    )
    .execute(&pool)
    .await?;

    assert_eq!(repo.delete_expired_batch().await?, u64::from(SWEEP_BATCH));
    assert_eq!(repo.delete_expired_batch().await?, 2);
    assert_eq!(repo.delete_expired_batch().await?, 0);
    assert_eq!(repo.get_live(live.id).await?, Some(live));
    assert_eq!(index_rows(&pool).await?, 1, "index rows go with their row");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_renamed_user_keeps_matching(pool: PgPool) -> anyhow::Result<()> {
    let repo = setup(&pool).await?;
    let stored = store(
        &repo,
        upsert(ME, URL, "mine", &["message.posted"], Duration::hours(1)),
    )
    .await?;
    let renamed = "macro|renamed@example.com";
    sqlx::query!(r#"UPDATE "User" SET id = $1 WHERE id = $2"#, renamed, ME)
        .execute(&pool)
        .await?;

    assert_eq!(
        candidates(&repo, &[renamed], "message.posted").await?,
        vec![stored.id]
    );
    assert!(candidates(&repo, &[ME], "message.posted").await?.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_quota_counts_live_rows_but_not_a_refresh(pool: PgPool) -> anyhow::Result<()> {
    let repo = setup(&pool).await?;
    let first = upsert(ME, URL, "a", &["message.posted"], Duration::hours(1));
    for subscription in [
        first.clone(),
        upsert(ME, URL, "b", &["message.posted"], Duration::hours(1)),
    ] {
        assert!(matches!(
            repo.store_within_quota(subscription, 2).await?,
            McpStoreOutcome::Stored(_)
        ));
    }
    assert_eq!(
        repo.store_within_quota(
            upsert(ME, URL, "c", &["message.posted"], Duration::hours(1)),
            2
        )
        .await?,
        McpStoreOutcome::QuotaExceeded
    );
    let mut refresh = first.clone();
    refresh.read_secret = Some(first.secret.ciphertext.clone());
    assert!(matches!(
        repo.store_within_quota(refresh, 2).await?,
        McpStoreOutcome::Stored(_)
    ));
    assert!(
        matches!(
            repo.store_within_quota(
                upsert(OTHER, URL, "c", &["message.posted"], Duration::hours(1)),
                2
            )
            .await?,
            McpStoreOutcome::Stored(_)
        ),
        "the quota is per user"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn expired_rows_free_their_quota(pool: PgPool) -> anyhow::Result<()> {
    let repo = setup(&pool).await?;
    store(
        &repo,
        upsert(ME, URL, "old", &["message.posted"], -Duration::minutes(1)),
    )
    .await?;
    assert!(matches!(
        repo.store_within_quota(
            upsert(ME, URL, "new", &["message.posted"], Duration::hours(1)),
            1
        )
        .await?,
        McpStoreOutcome::Stored(_)
    ));
    assert_eq!(
        index_rows(&pool).await?,
        2,
        "the expired row waits for the sweep"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_stores_cannot_pass_the_quota_together(pool: PgPool) -> anyhow::Result<()> {
    let repo = setup(&pool).await?;
    let attempts = (0..8).map(|index| {
        let repo = repo.clone();
        let subscription = upsert(
            ME,
            URL,
            &format!("query {index}"),
            &["message.posted"],
            Duration::hours(1),
        );
        tokio::spawn(async move { repo.store_within_quota(subscription, 1).await })
    });
    let mut stored = 0;
    for attempt in futures::future::join_all(attempts).await {
        if matches!(attempt??, McpStoreOutcome::Stored(_)) {
            stored += 1;
        }
    }
    assert_eq!(stored, 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_is_scoped_to_the_user(pool: PgPool) -> anyhow::Result<()> {
    let repo = setup(&pool).await?;
    let mine = store(
        &repo,
        upsert(
            ME,
            URL,
            "mentions",
            &["message.mentioned"],
            Duration::hours(1),
        ),
    )
    .await?;
    assert!(!repo.delete(&user(OTHER), &mine.subscription_id).await?);
    assert!(repo.delete(&user(ME), &mine.subscription_id).await?);
    assert!(!repo.delete(&user(ME), &mine.subscription_id).await?);
    assert_eq!(index_rows(&pool).await?, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn live_endpoint_is_per_user_and_url(pool: PgPool) -> anyhow::Result<()> {
    let repo = setup(&pool).await?;
    store(
        &repo,
        upsert(
            ME,
            URL,
            "mentions",
            &["message.mentioned"],
            Duration::hours(1),
        ),
    )
    .await?;
    store(
        &repo,
        upsert(
            ME,
            "https://hooks.example.com/expired",
            "mentions",
            &["message.mentioned"],
            -Duration::minutes(1),
        ),
    )
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
    let mine = store(
        &repo,
        upsert(
            ME,
            URL,
            "mentions",
            &["message.mentioned"],
            Duration::hours(1),
        ),
    )
    .await?;
    let theirs = store(
        &repo,
        upsert(
            OTHER,
            URL,
            "mentions",
            &["message.mentioned"],
            Duration::hours(1),
        ),
    )
    .await?;

    assert_eq!(
        candidates(
            &repo,
            &[ME, "11111111-1111-1111-1111-111111111111"],
            "message.mentioned"
        )
        .await?,
        vec![mine.id]
    );
    let mut both = vec![mine.id, theirs.id];
    both.sort();
    assert_eq!(
        candidates(&repo, &[ME, OTHER], "message.mentioned").await?,
        both
    );
    assert!(
        candidates(&repo, &[ME], "document.created")
            .await?
            .is_empty()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn live_subscribers_are_the_owners_of_live_rows(pool: PgPool) -> anyhow::Result<()> {
    let repo = setup(&pool).await?;
    for query in ["one", "two"] {
        store(
            &repo,
            upsert(ME, URL, query, &["message.posted"], Duration::hours(1)),
        )
        .await?;
    }
    store(
        &repo,
        upsert(
            OTHER,
            URL,
            "old",
            &["message.posted"],
            -Duration::minutes(1),
        ),
    )
    .await?;

    let mut owners = repo.list_live_subscriber_ids().await?;
    owners.sort();
    assert_eq!(owners, vec![ME.to_owned(), ME.to_owned()]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_refresh_decided_against_a_changed_row_is_not_written(
    pool: PgPool,
) -> anyhow::Result<()> {
    let repo = setup(&pool).await?;
    let first = upsert(
        ME,
        URL,
        "mentions",
        &["message.mentioned"],
        Duration::hours(1),
    );
    store(&repo, first.clone()).await?;
    let mut won = first.clone();
    won.secret.ciphertext = vec![7];
    let won = store(&repo, won).await?;

    // Read before `won` committed: it names the first secret.
    let mut lost = first.clone();
    lost.secret.ciphertext = vec![8];
    lost.read_secret = Some(first.secret.ciphertext.clone());
    assert_eq!(
        repo.store_within_quota(lost, MAX).await?,
        McpStoreOutcome::Changed
    );
    assert_eq!(
        repo.get(&user(ME), &first.subscription_id).await?,
        Some(won),
        "the row is the winner's"
    );

    // A first subscribe that raced another one finds the row there.
    let mut late = first.clone();
    late.read_secret = None;
    assert_eq!(
        repo.store_within_quota(late, MAX).await?,
        McpStoreOutcome::Changed
    );
    Ok(())
}
