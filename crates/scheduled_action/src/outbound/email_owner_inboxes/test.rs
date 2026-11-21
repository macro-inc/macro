use super::*;
use email::outbound::EmailPgRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

async fn user(pool: &PgPool, email: &str) -> MacroUserIdStr<'static> {
    let id = MacroUserIdStr::try_from_email(email).unwrap();
    let macro_user_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        macro_user_id,
        id.as_ref(),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        id.as_ref(),
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn inbox(pool: &PgPool, owner: &MacroUserIdStr<'static>, address: &str) -> Uuid {
    let link_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
         VALUES ($1, $2, $2, $3, 'GMAIL')",
        link_id,
        owner.as_ref(),
        address,
    )
    .execute(pool)
    .await
    .unwrap();
    link_id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_owner_receives_mail_in_their_inboxes_and_those_delegated_to_them(pool: PgPool) {
    let owner = user(&pool, "owner@example.com").await;
    let team = user(&pool, "team@example.com").await;
    let own = inbox(&pool, &owner, "owner@example.com").await;
    let shared = inbox(&pool, &team, "team@example.com").await;
    let unshared = inbox(&pool, &team, "team-private@example.com").await;
    sqlx::query!(
        "INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id) VALUES ($1, $2, $3)",
        owner.as_ref(),
        team.as_ref(),
        shared,
    )
    .execute(&pool)
    .await
    .unwrap();
    let inboxes = EmailOwnerInboxes(EmailPgRepo::new(pool));
    let all = [own, shared, unshared, macro_uuid::generate_uuid_v7()];

    let mut theirs = inboxes.among(&owner, &all).await.unwrap();
    theirs.sort_unstable();
    let mut expected = vec![own, shared];
    expected.sort_unstable();
    assert_eq!(theirs, expected);
    // Delegation runs one way: the team account doesn't receive the owner's mail.
    let mut team_inboxes = inboxes.among(&team, &all).await.unwrap();
    team_inboxes.sort_unstable();
    let mut expected = vec![shared, unshared];
    expected.sort_unstable();
    assert_eq!(team_inboxes, expected);
    assert!(inboxes.among(&owner, &[unshared]).await.unwrap().is_empty());
}
