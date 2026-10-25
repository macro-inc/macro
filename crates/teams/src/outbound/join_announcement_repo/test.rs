use std::collections::HashSet;

use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;

const TEAM1: Uuid = Uuid::from_u128(0x1111_1111_1111_1111_1111_1111_1111_1111);

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

fn users(emails: &[&str]) -> Vec<MacroUserIdStr<'static>> {
    emails.iter().map(|email| user(email)).collect()
}

fn team1_claims(emails: &[&str]) -> Vec<(String, String)> {
    emails
        .iter()
        .map(|email| (format!("macro|{email}"), "team1".to_owned()))
        .collect()
}

async fn claim(repo: &JoinAnnouncementRepositoryImpl, emails: &[&str]) -> Vec<(String, String)> {
    repo.claim(TEAM1, &users(emails), 25)
        .await
        .unwrap()
        .into_iter()
        .map(|claimed| (claimed.recipient.to_string(), claimed.team_name))
        .collect()
}

async fn set_auto_join_domain(pool: &PgPool, domain: &str) {
    sqlx::query!(
        "UPDATE team SET auto_join_domain = $2 WHERE id = $1",
        TEAM1,
        domain
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn ledger(pool: &PgPool) -> Vec<String> {
    sqlx::query_scalar!(
        "SELECT email FROM team_joined_macro_email WHERE team_id = $1 ORDER BY email",
        TEAM1
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn a_team_without_an_auto_join_domain_claims_nobody(pool: PgPool) {
    let repo = JoinAnnouncementRepositoryImpl::new(pool.clone());

    assert!(claim(&repo, &["new@user.com"]).await.is_empty());
    assert!(ledger(&pool).await.is_empty());

    set_auto_join_domain(&pool, "user.com").await;
    assert_eq!(
        claim(&repo, &["new@user.com"]).await,
        team1_claims(&["new@user.com"])
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn only_same_domain_outsiders_without_an_invite_are_claimed(pool: PgPool) {
    set_auto_join_domain(&pool, "user.com").await;
    let repo = JoinAnnouncementRepositoryImpl::new(pool.clone());

    let claims = claim(
        &repo,
        &[
            "new@user.com",
            "outsider@other.com",
            "nested@eng.user.com",
            "user2@user.com",
            "user3@user.com",
        ],
    )
    .await;

    assert_eq!(claims, team1_claims(&["new@user.com"]));
    assert_eq!(ledger(&pool).await, vec!["new@user.com".to_owned()]);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn an_address_is_claimed_once_per_team(pool: PgPool) {
    set_auto_join_domain(&pool, "user.com").await;
    let repo = JoinAnnouncementRepositoryImpl::new(pool.clone());

    assert_eq!(
        claim(&repo, &["new@user.com"]).await,
        team1_claims(&["new@user.com"])
    );
    assert_eq!(
        claim(&repo, &["new@user.com", "other@user.com"]).await,
        team1_claims(&["other@user.com"])
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn concurrent_claims_never_share_an_address(pool: PgPool) {
    set_auto_join_domain(&pool, "user.com").await;
    let left_repo = JoinAnnouncementRepositoryImpl::new(pool.clone());
    let right_repo = JoinAnnouncementRepositoryImpl::new(pool.clone());
    let emails: Vec<String> = (0..50)
        .map(|i| format!("colleague{i:02}@user.com"))
        .collect();
    let candidates: Vec<MacroUserIdStr<'static>> = emails.iter().map(|email| user(email)).collect();

    let (left, right) = tokio::join!(
        left_repo.claim(TEAM1, &candidates, 25),
        right_repo.claim(TEAM1, &candidates, 25)
    );

    let left: HashSet<String> = left
        .unwrap()
        .into_iter()
        .map(|claimed| claimed.recipient.to_string())
        .collect();
    let right: HashSet<String> = right
        .unwrap()
        .into_iter()
        .map(|claimed| claimed.recipient.to_string())
        .collect();
    assert!(left.is_disjoint(&right));
    assert_eq!(left.len() + right.len(), 50);
    assert_eq!(ledger(&pool).await, emails);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn a_released_address_can_be_claimed_again(pool: PgPool) {
    set_auto_join_domain(&pool, "user.com").await;
    let repo = JoinAnnouncementRepositoryImpl::new(pool.clone());
    claim(&repo, &["new@user.com", "other@user.com"]).await;

    repo.release(TEAM1, &user("new@user.com")).await.unwrap();

    assert_eq!(ledger(&pool).await, vec!["other@user.com".to_owned()]);
    assert_eq!(
        claim(&repo, &["new@user.com", "other@user.com"]).await,
        team1_claims(&["new@user.com"])
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn deleting_the_team_deletes_its_claims(pool: PgPool) {
    set_auto_join_domain(&pool, "user.com").await;
    let repo = JoinAnnouncementRepositoryImpl::new(pool.clone());
    claim(&repo, &["new@user.com"]).await;
    assert_eq!(ledger(&pool).await, vec!["new@user.com".to_owned()]);

    sqlx::query!("DELETE FROM team WHERE id = $1", TEAM1)
        .execute(&pool)
        .await
        .unwrap();

    assert!(ledger(&pool).await.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn people_already_on_macro_are_not_claimed(pool: PgPool) {
    set_auto_join_domain(&pool, "user.com").await;
    let macro_user_id = Uuid::from_u128(0xe1);
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email) VALUES ($1, $2, $2)"#,
        macro_user_id,
        "Existing@user.com",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        "macro|Existing@user.com",
        "Existing@user.com",
        macro_user_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = JoinAnnouncementRepositoryImpl::new(pool.clone());

    assert_eq!(
        claim(&repo, &["existing@user.com", "new@user.com"]).await,
        team1_claims(&["new@user.com"])
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn claims_stop_at_the_team_limit_across_calls(pool: PgPool) {
    set_auto_join_domain(&pool, "user.com").await;
    let repo = JoinAnnouncementRepositoryImpl::new(pool.clone());

    let first = repo
        .claim(TEAM1, &users(&["a@user.com", "b@user.com"]), 3)
        .await
        .unwrap();
    let second = repo
        .claim(TEAM1, &users(&["a@user.com", "c@user.com", "d@user.com"]), 3)
        .await
        .unwrap();

    assert_eq!(first.len(), 2);
    assert_eq!(second.len(), 1);
    assert_eq!(
        ledger(&pool).await,
        vec!["a@user.com", "b@user.com", "c@user.com"]
    );
}
