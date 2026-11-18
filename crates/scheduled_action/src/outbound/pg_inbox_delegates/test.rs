use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

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

async fn delegate(
    pool: &PgPool,
    primary: &MacroUserIdStr<'static>,
    child: &MacroUserIdStr<'static>,
    link_id: Uuid,
) {
    sqlx::query!(
        "INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id) VALUES ($1, $2, $3)",
        primary.as_ref(),
        child.as_ref(),
        link_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_inbox_is_read_by_the_accounts_it_is_delegated_to(pool: PgPool) {
    let team_inbox = user(&pool, "team-inbox@example.com").await;
    let reader = user(&pool, "reader@example.com").await;
    let other = user(&pool, "other@example.com").await;
    let shared = inbox(&pool, &team_inbox, "team-inbox@example.com").await;
    let private = inbox(&pool, &team_inbox, "team-inbox-private@example.com").await;
    let readers_own = inbox(&pool, &reader, "reader@example.com").await;
    delegate(&pool, &reader, &team_inbox, shared).await;
    delegate(&pool, &other, &team_inbox, shared).await;
    // The reverse edge: the team inbox account reads the reader's inbox.
    delegate(&pool, &team_inbox, &reader, readers_own).await;
    let delegates = PgInboxDelegates::new(pool);

    let mut shared_readers = delegates.delegates(&team_inbox, shared).await.unwrap();
    shared_readers.sort_by(|a, b| a.as_ref().cmp(b.as_ref()));
    assert_eq!(shared_readers, vec![other, reader.clone()]);
    // Delegation is per inbox: the owner's other inbox stays theirs alone.
    assert!(
        delegates
            .delegates(&team_inbox, private)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        delegates.delegates(&reader, readers_own).await.unwrap(),
        vec![team_inbox.clone()]
    );
    // A link only counts for the owner the event names.
    assert!(
        delegates
            .delegates(&reader, shared)
            .await
            .unwrap()
            .is_empty()
    );
}
