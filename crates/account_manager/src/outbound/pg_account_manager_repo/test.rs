use chrono::{Duration, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use super::*;

const AGENT: &str = "macro|agent@example.com";
const PERSON: &str = "macro|person@example.com";

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

async fn seed_users(pool: &PgPool) {
    for (id, email, is_agent) in [
        (AGENT, "agent@example.com", true),
        (PERSON, "person@example.com", false),
    ] {
        let macro_user_id = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
            macro_user_id,
            email,
            format!("stripe_{macro_user_id}"),
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query!(
            r#"INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES ($1, $2, $3, $4)"#,
            id,
            email,
            macro_user_id,
            is_agent,
        )
        .execute(pool)
        .await
        .unwrap();
    }
}

async fn open(repo: &PgAccountManagerRepo, expires_at: DateTime<Utc>) -> OpenedRequest {
    repo.open_request(
        Uuid::now_v7(),
        &user(PERSON),
        &user(AGENT),
        AccountManagerRole::Manager,
        expires_at,
    )
    .await
    .unwrap()
}

async fn approve(repo: &PgAccountManagerRepo, id: Uuid) {
    let now = Utc::now();
    repo.respond(
        id,
        AccountManagerDecision::Approve,
        now + Duration::days(7),
        now,
    )
    .await
    .unwrap()
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn is_agent_reads_the_account_flag(pool: PgPool) {
    seed_users(&pool).await;
    let repo = PgAccountManagerRepo::new(pool);

    assert_eq!(repo.is_agent(&user(AGENT)).await.unwrap(), Some(true));
    assert_eq!(repo.is_agent(&user(PERSON)).await.unwrap(), Some(false));
    assert_eq!(
        repo.is_agent(&user("macro|nobody@example.com"))
            .await
            .unwrap(),
        None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_pending_request_per_pair_until_it_expires(pool: PgPool) {
    seed_users(&pool).await;
    let repo = PgAccountManagerRepo::new(pool.clone());

    let first = open(&repo, Utc::now() + Duration::days(7)).await;
    let second = open(&repo, Utc::now() + Duration::days(7)).await;
    assert!(first.created);
    assert!(!second.created);
    assert_eq!(first.grant.id, second.grant.id);

    sqlx::query!(
        "UPDATE account_manager_grants SET expires_at = now() - interval '1 minute' WHERE id = $1",
        first.grant.id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let third = open(&repo, Utc::now() + Duration::days(7)).await;
    assert!(third.created);
    let lapsed = repo.get(first.grant.id).await.unwrap().unwrap();
    assert_eq!(lapsed.status, AccountManagerGrantStatus::Expired);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_lapsed_request_cannot_be_approved(pool: PgPool) {
    seed_users(&pool).await;
    let repo = PgAccountManagerRepo::new(pool);
    let grant = open(&repo, Utc::now() - Duration::minutes(1)).await.grant;

    let now = Utc::now();
    let response = repo
        .respond(grant.id, AccountManagerDecision::Approve, now, now)
        .await
        .unwrap();

    assert!(response.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_claim_works_once_and_replaces_the_pairs_earlier_credential(pool: PgPool) {
    seed_users(&pool).await;
    let repo = PgAccountManagerRepo::new(pool);

    let earlier = open(&repo, Utc::now() + Duration::days(7)).await.grant;
    approve(&repo, earlier.id).await;
    let active = repo
        .claim(earlier.id, &[1; 32], Utc::now())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(active.status, AccountManagerGrantStatus::Active);
    assert!(
        repo.claim(earlier.id, &[2; 32], Utc::now())
            .await
            .unwrap()
            .is_none()
    );

    let later = open(&repo, Utc::now() + Duration::days(7)).await.grant;
    approve(&repo, later.id).await;

    // Approving alone leaves the earlier credential working until the claim.
    let before_claim = repo.get(earlier.id).await.unwrap().unwrap();
    assert_eq!(before_claim.status, AccountManagerGrantStatus::Active);

    repo.claim(later.id, &[3; 32], Utc::now())
        .await
        .unwrap()
        .unwrap();

    let replaced = repo.get(earlier.id).await.unwrap().unwrap();
    assert_eq!(replaced.status, AccountManagerGrantStatus::Revoked);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn racing_claims_issue_exactly_one_credential(pool: PgPool) {
    seed_users(&pool).await;
    let repo = PgAccountManagerRepo::new(pool.clone());
    let grant = open(&repo, Utc::now() + Duration::days(7)).await.grant;
    approve(&repo, grant.id).await;

    let now = Utc::now();
    let (first, second) = tokio::join!(
        repo.claim(grant.id, &[5; 32], now),
        repo.claim(grant.id, &[6; 32], now),
    );
    let first = first.unwrap();
    let second = second.unwrap();

    assert!(first.is_some() != second.is_some());
    let expected: &[u8] = if first.is_some() { &[5; 32] } else { &[6; 32] };
    let stored = sqlx::query_scalar!(
        "SELECT key_hash FROM account_manager_grants WHERE id = $1",
        grant.id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored.as_deref(), Some(expected));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn revoking_clears_the_credential_hash_and_list_hides_it(pool: PgPool) {
    seed_users(&pool).await;
    let repo = PgAccountManagerRepo::new(pool.clone());
    let grant = open(&repo, Utc::now() + Duration::days(7)).await.grant;
    approve(&repo, grant.id).await;
    repo.claim(grant.id, &[4; 32], Utc::now())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(repo.list_for_managed(&user(PERSON)).await.unwrap().len(), 1);

    repo.revoke(grant.id).await.unwrap().unwrap();

    let hash = sqlx::query_scalar!(
        "SELECT key_hash FROM account_manager_grants WHERE id = $1",
        grant.id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(hash.is_none());
    assert!(
        repo.list_for_managed(&user(PERSON))
            .await
            .unwrap()
            .is_empty()
    );
    assert!(repo.revoke(grant.id).await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_either_account_removes_the_grant(pool: PgPool) {
    seed_users(&pool).await;
    let repo = PgAccountManagerRepo::new(pool.clone());
    let grant = open(&repo, Utc::now() + Duration::days(7)).await.grant;

    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, AGENT)
        .execute(&pool)
        .await
        .unwrap();

    assert!(repo.get(grant.id).await.unwrap().is_none());
}
