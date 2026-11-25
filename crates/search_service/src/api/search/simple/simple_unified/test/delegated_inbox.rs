//! Email search by someone delegated one of another person's inboxes, sent
//! through the search routes to Postgres and an OpenSearch with the search
//! indices. The unified route is also the internal one the AI search tools,
//! skills and routine drafting call.

use super::*;
use axum::body::Body;
use axum::http::Request;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_search::SimpleSearchResponse;
use models_search::unified::{
    UnifiedSearchIndex, UnifiedSearchResponse, entity_filters_from_include,
};
use opensearch_client::date_format::EpochMillis;
use opensearch_client::upsert::email::UpsertEmailArgs;
use sqlx::PgPool;
use std::collections::BTreeSet;
use tower::ServiceExt as _;

const OWNER: &str = "macro|owner@delegation.example";
const DELEGATE: &str = "macro|delegate@delegation.example";
const INTERNAL_KEY: &str = "test-internal-key";
/// A word only these messages hold, so other mail in the index never matches.
const WORD: &str = "zephyrquorum";

async fn insert_user(pool: &PgPool, macro_id: &str, email: &str) -> anyhow::Result<()> {
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id)
           VALUES ($1, $2, $3, $2)"#,
        macro_user_id,
        macro_id,
        email,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        macro_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_inbox(pool: &PgPool, macro_id: &str, email: &str) -> anyhow::Result<Uuid> {
    let link_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $2, $3, 'GMAIL')"#,
        link_id,
        macro_id,
        email,
    )
    .execute(pool)
    .await?;
    Ok(link_id)
}

/// A thread of one message in `link_id`, in Postgres and in the index under
/// the inbox's owner, as search-processing writes it.
async fn insert_thread(
    pool: &PgPool,
    index: &opensearch_client::OpensearchClient,
    link_id: Uuid,
    owner: &str,
    subject: &str,
) -> anyhow::Result<Uuid> {
    let thread_id = Uuid::now_v7();
    let contact_id = Uuid::now_v7();
    let message_id = Uuid::now_v7();
    let sender = format!("{subject}@delegation.example");
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id) VALUES ($1, $2)",
        thread_id,
        link_id,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO email_contacts (id, link_id, email_address) VALUES ($1, $2, $3)",
        contact_id,
        link_id,
        sender,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, subject, sent_at)
           VALUES ($1, $2, $3, $4, $5, now())"#,
        message_id,
        thread_id,
        link_id,
        contact_id,
        subject,
    )
    .execute(pool)
    .await?;

    let now = EpochMillis::new(chrono::Utc::now().timestamp_millis())?;
    let document = UpsertEmailArgs {
        thread_id: thread_id.to_string(),
        message_id: message_id.to_string(),
        sender,
        sender_name: None,
        reply_to: None,
        recipients: Vec::new(),
        recipient_names: Vec::new(),
        cc: Vec::new(),
        cc_names: Vec::new(),
        bcc: Vec::new(),
        bcc_names: Vec::new(),
        labels: Vec::new(),
        link_id: link_id.to_string(),
        user_id: owner.to_string(),
        updated_at_millis: now,
        subject: Some(subject.to_string()),
        sent_at_millis: Some(now),
        content: format!("{subject} {WORD}"),
        properties: Vec::new(),
    };
    // Email writes are fenced, so a seed carries a version later than any
    // delete of the same document, as a real writer's lease grant does.
    let version = u64::try_from(chrono::Utc::now().timestamp_micros())?;
    let writes = index
        .write_email_documents(version, &[document], &[], None)
        .await?;
    anyhow::ensure!(writes.indexed == 1, "the seeded message was not written");
    Ok(thread_id)
}

fn state(
    pool: PgPool,
    index: std::sync::Arc<opensearch_client::OpensearchClient>,
) -> SearchHandlerState {
    SearchHandlerState {
        db: readonly_pool::ReadOnlyPool(pool.clone()),
        crm_db: pool.clone(),
        opensearch_client: index,
        entity_access_service: std::sync::Arc::new(
            entity_access::domain::service::EntityAccessServiceImpl::new(
                entity_access::outbound::PgAccessRepository::new(pool),
            ),
        ),
        authorization_state: macro_authorization::MacroAuthorizationState::new(
            std::sync::Arc::new(macro_authorization::MacroAuthorizationServiceImpl::new(
                macro_authorization::MacroAuthJwtValidator::new(
                    macro_auth::middleware::decode_jwt::JwtValidationArgs::new_testing(),
                ),
                macro_authorization::InternalAuthConfig {
                    api_key: INTERNAL_KEY.to_string(),
                    default_user_id: None,
                },
                macro_authorization::NoBotAuthorizer,
                macro_authorization::NoUserApiKeyAuthorizer,
            )),
        ),
        agent_session_search_metadata: std::sync::Arc::new(NoSessions),
        calendar_search_enabled: false,
        calendar_event_labels: std::sync::Arc::new(NoLabels),
        term_matching_rollout: std::sync::Arc::new(crate::LocalTermMatching),
        search_lanes: std::sync::Arc::new(one_at_a_time()),
        api_key_search_buckets: std::sync::Arc::new(FixedBucket::answering(Some(
            rate_limit::TokenBucketResult::Taken { remaining: 200 },
        ))),
    }
}

/// An email search for [`WORD`], in only the given inboxes when any are named.
fn email_search(
    link_ids: &[Uuid],
    shared: item_filters::SharedEmailFilter,
) -> UnifiedSearchRequest {
    let mut filters =
        entity_filters_from_include(vec![UnifiedSearchIndex::Emails], Default::default());
    filters.email_filters.link_ids = link_ids.iter().map(Uuid::to_string).collect();
    filters.email_filters.shared = shared;
    UnifiedSearchRequest {
        filters,
        ..search_request(WORD)
    }
}

async fn post(
    ctx: &SearchHandlerState,
    route: &str,
    user: &str,
    request: &UnifiedSearchRequest,
) -> anyhow::Result<Vec<u8>> {
    let response = crate::api::router()
        .with_state(ctx.clone())
        .oneshot(
            Request::post(route)
                .header("content-type", "application/json")
                .header(macro_authorization::INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
                .header(macro_authorization::INTERNAL_MACRO_USER_ID_HEADER, user)
                .body(Body::from(serde_json::to_vec(request)?))?,
        )
        .await?;
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX).await?;
    anyhow::ensure!(
        status.is_success(),
        "{route} answered {status}: {}",
        String::from_utf8_lossy(&body)
    );
    Ok(body.to_vec())
}

/// The email threads `/search` returns to `user`.
async fn unified_threads(
    ctx: &SearchHandlerState,
    user: &str,
    request: &UnifiedSearchRequest,
) -> anyhow::Result<BTreeSet<Uuid>> {
    let body = post(ctx, "/", user, request).await?;
    let response: UnifiedSearchResponse = serde_json::from_slice(&body)?;
    Ok(response.results.iter().map(|r| r.entity_id()).collect())
}

/// The email threads `/search/simple` returns to `user`.
async fn simple_threads(
    ctx: &SearchHandlerState,
    user: &str,
    request: &UnifiedSearchRequest,
) -> anyhow::Result<BTreeSet<Uuid>> {
    let body = post(ctx, "/simple", user, request).await?;
    let response: SimpleSearchResponse = serde_json::from_slice(&body)?;
    Ok(response.results.iter().map(|r| r.entity_id).collect())
}

/// Removes the test's mail from the index, whatever an earlier run left.
async fn clear_index(index: &opensearch_client::OpensearchClient) -> anyhow::Result<()> {
    index.delete_email_messages_by_user_id(OWNER).await?;
    index.delete_email_messages_by_user_id(DELEGATE).await?;
    index.refresh_email_index().await?;
    Ok(())
}

/// What each search returned and what it should have, by thread name.
type Searched = Vec<(String, BTreeSet<&'static str>)>;

/// The owner has two inboxes and has delegated one of them. The delegate's
/// search reaches their own inbox and the delegated one and, when it asks for
/// shared threads, a thread the owner shared with them from the other inbox,
/// never the rest of that inbox.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "needs an OpenSearch with the search indices at SEARCH_TEST_OPENSEARCH_URL"]
async fn a_delegate_searches_only_the_inboxes_delegated_to_them(
    pool: PgPool,
) -> anyhow::Result<()> {
    let url = std::env::var("SEARCH_TEST_OPENSEARCH_URL")?;
    let index = std::sync::Arc::new(opensearch_client::OpensearchClient::new(
        url,
        String::new(),
        String::new(),
    )?);
    clear_index(&index).await?;

    let outcome = seed_and_search(pool, std::sync::Arc::clone(&index)).await;
    clear_index(&index).await?;
    let (found, expected) = outcome?;
    assert_eq!(found, expected);
    Ok(())
}

async fn seed_and_search(
    pool: PgPool,
    index: std::sync::Arc<opensearch_client::OpensearchClient>,
) -> anyhow::Result<(Searched, Searched)> {
    insert_user(&pool, OWNER, "owner@delegation.example").await?;
    insert_user(&pool, DELEGATE, "delegate@delegation.example").await?;
    let owner_inbox = insert_inbox(&pool, OWNER, "owner@delegation.example").await?;
    let delegated_inbox = insert_inbox(&pool, OWNER, "support@delegation.example").await?;
    let delegate_inbox = insert_inbox(&pool, DELEGATE, "delegate@delegation.example").await?;
    sqlx::query!(
        "INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
         VALUES ($1, $2, $3)",
        DELEGATE,
        OWNER,
        delegated_inbox,
    )
    .execute(&pool)
    .await?;

    let mut names = std::collections::HashMap::new();
    for (inbox, owner, name) in [
        (owner_inbox, OWNER, "private"),
        (owner_inbox, OWNER, "shared"),
        (delegated_inbox, OWNER, "delegated"),
        (delegate_inbox, DELEGATE, "own"),
    ] {
        names.insert(
            insert_thread(&pool, &index, inbox, owner, name).await?,
            name,
        );
    }
    let shared = names
        .iter()
        .find_map(|(id, name)| (*name == "shared").then_some(*id))
        .ok_or_else(|| anyhow::anyhow!("no shared thread"))?;
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           VALUES ($1, 'email_thread', $2, 'user', 'view')"#,
        shared,
        DELEGATE,
    )
    .execute(&pool)
    .await?;
    index.refresh_email_index().await?;

    let ctx = state(pool, index);
    let own_only = item_filters::SharedEmailFilter::Exclude;
    let with_shared = item_filters::SharedEmailFilter::Include;
    let searches: [(&str, &str, Vec<Uuid>, _, &[&'static str]); 5] = [
        (
            "the delegate's search",
            DELEGATE,
            Vec::new(),
            own_only,
            &["delegated", "own"],
        ),
        (
            "the delegate's search with shared threads",
            DELEGATE,
            Vec::new(),
            with_shared,
            &["delegated", "own", "shared"],
        ),
        (
            "the delegate's search in the owner's other inbox",
            DELEGATE,
            vec![owner_inbox],
            own_only,
            &[],
        ),
        (
            "the delegate's search with shared threads in the owner's other inbox",
            DELEGATE,
            vec![owner_inbox],
            with_shared,
            &["shared"],
        ),
        (
            "the owner's search",
            OWNER,
            Vec::new(),
            own_only,
            &["delegated", "private", "shared"],
        ),
    ];

    let by_name = |threads: BTreeSet<Uuid>| -> BTreeSet<&'static str> {
        threads
            .iter()
            .map(|id| names.get(id).copied().unwrap_or("another thread"))
            .collect()
    };
    let mut found = Vec::new();
    let mut expected = Vec::new();
    for (search, user, link_ids, shared, threads) in &searches {
        let request = email_search(link_ids, *shared);
        let threads: BTreeSet<&'static str> = threads.iter().copied().collect();
        found.push((
            format!("{search} on /search/simple"),
            by_name(simple_threads(&ctx, user, &request).await?),
        ));
        expected.push((format!("{search} on /search/simple"), threads.clone()));
        found.push((
            format!("{search} on /search"),
            by_name(unified_threads(&ctx, user, &request).await?),
        ));
        expected.push((format!("{search} on /search"), threads));
    }
    Ok((found, expected))
}
