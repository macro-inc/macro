use email::outbound::EmailPgRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::*;
use crate::outbound::pg_suggestion_repo::test::insert_user;

const OWNER: &str = "macro|drafts-owner@example.com";
const TEAMMATE: &str = "macro|drafts-teammate@example.com";

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

/// An inbox of `owner`'s.
async fn inbox(pool: &PgPool, owner: &str) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $3, $4, 'GMAIL')"#,
        id,
        owner,
        owner,
        owner,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

/// A message in a new thread of `inbox`, and that thread.
async fn message(pool: &PgPool, inbox: Uuid, draft: bool) -> (Uuid, Uuid) {
    let (thread, message) = (Uuid::now_v7(), Uuid::now_v7());
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id) VALUES ($1, $2)",
        thread,
        inbox,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO email_messages (id, thread_id, link_id, is_draft, is_sent)
           VALUES ($1, $2, $3, $4, NOT $4)"#,
        message,
        thread,
        inbox,
        draft,
    )
    .execute(pool)
    .await
    .unwrap();
    (message, thread)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_an_unsent_draft_in_the_persons_own_inbox_counts(pool: PgPool) {
    for id in [OWNER, TEAMMATE] {
        insert_user(&pool, id).await;
    }
    let own = inbox(&pool, OWNER).await;
    let delegated = inbox(&pool, TEAMMATE).await;
    // The teammate's inbox is delegated to the owner.
    sqlx::query!(
        r#"INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
           VALUES ($1, $2, $3)"#,
        OWNER,
        TEAMMATE,
        delegated,
    )
    .execute(&pool)
    .await
    .unwrap();
    let (draft, thread) = message(&pool, own, true).await;
    let (sent, _) = message(&pool, own, false).await;
    let (delegated_draft, _) = message(&pool, delegated, true).await;
    let drafts = EmailSuggestionDrafts(EmailPgRepo::new(pool.clone()));

    let thread_of = |who: &'static str, id: Uuid| {
        let drafts = &drafts;
        async move { drafts.email_draft_thread(&user(who), id).await.unwrap() }
    };
    assert_eq!(thread_of(OWNER, draft).await, Some(thread));
    assert_eq!(thread_of(OWNER, sent).await, None);
    assert_eq!(thread_of(OWNER, delegated_draft).await, None);
    assert_eq!(thread_of(OWNER, Uuid::now_v7()).await, None);
    assert_eq!(thread_of(TEAMMATE, draft).await, None);
}
