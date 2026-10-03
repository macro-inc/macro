use super::thread_unread::service;
use super::*;
use crate::domain::followup::EmailFollowupMailbox;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_thread_labels", "email_thread_unread", "email_thread_archive")
    )
)]
async fn followup_return_authorizes_the_thread_inbox_and_supports_sent_only(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let thread = uuid::uuid!("11111111-1111-1111-1111-111111111111");
    let link = uuid::uuid!("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    let mailbox = service(pool.clone());
    sqlx::query!(
        "UPDATE email_messages SET is_sent = true WHERE thread_id = $1",
        thread
    )
    .execute(&pool)
    .await?;
    sqlx::query!("UPDATE email_threads SET latest_inbound_message_ts = NULL, inbox_visible = false WHERE id = $1", thread).execute(&pool).await?;
    let before = mailbox
        .followup_thread(owner.clone(), thread)
        .await?
        .unwrap();
    assert_eq!(before.link_id, link);
    assert!(before.messages.iter().all(|message| message.outgoing));
    assert!(!before.has_reply(&before.baseline(Utc::now())));
    assert!(
        mailbox
            .set_followup_inbox(
                owner.clone(),
                thread,
                Uuid::now_v7(),
                true,
                Some(Utc::now())
            )
            .await
            .is_err()
    );
    assert!(
        mailbox
            .followup_thread(MacroUserIdStr::try_from_email("outsider@test.com")?, thread)
            .await?
            .is_none()
    );
    mailbox
        .set_followup_inbox(owner.clone(), thread, link, true, Some(Utc::now()))
        .await?;
    let returned = sqlx::query!("SELECT inbox_visible, latest_inbound_message_ts, reminder_returned_at FROM email_threads WHERE id = $1", thread).fetch_one(&pool).await?;
    assert!(returned.inbox_visible);
    assert!(
        returned.latest_inbound_message_ts.is_none(),
        "must not invent an inbound message"
    );
    assert!(returned.reminder_returned_at.is_some());
    mailbox
        .set_followup_inbox(owner, thread, link, false, None)
        .await?;
    assert!(
        !mailbox
            .email_repo
            .thread_by_id(thread)
            .await?
            .unwrap()
            .inbox_visible
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_thread_labels", "email_thread_unread", "email_thread_archive")
    )
)]
async fn followup_uses_delegated_inbox_and_rechecks_revocation(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let thread = uuid::uuid!("11111111-1111-1111-1111-111111111111");
    let link = uuid::uuid!("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    sqlx::query!(r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
        ('d1000000-0000-0000-0000-000000000001', 'owner', 'user1@test.com', 'followup_owner'),
        ('d1000000-0000-0000-0000-000000000002', 'delegate', 'delegate@test.com', 'followup_delegate')"#).execute(&pool).await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES
        ('macro|user1@test.com', 'user1@test.com', 'd1000000-0000-0000-0000-000000000001'),
        ('macro|delegate@test.com', 'delegate@test.com', 'd1000000-0000-0000-0000-000000000002')"#
    )
    .execute(&pool)
    .await?;
    sqlx::query!("INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id) VALUES ('macro|delegate@test.com', 'macro|user1@test.com', $1)", link).execute(&pool).await?;
    let mailbox = service(pool.clone());
    let delegate = MacroUserIdStr::try_from_email("delegate@test.com")?;
    assert_eq!(
        mailbox
            .followup_thread(delegate.clone(), thread)
            .await?
            .unwrap()
            .link_id,
        link
    );
    mailbox
        .set_followup_inbox(delegate.clone(), thread, link, false, None)
        .await?;
    mailbox
        .set_followup_inbox(delegate.clone(), thread, link, true, Some(Utc::now()))
        .await?;
    sqlx::query!(
        "DELETE FROM macro_user_links WHERE primary_macro_id = $1",
        delegate.as_ref()
    )
    .execute(&pool)
    .await?;
    assert!(
        mailbox
            .followup_thread(delegate.clone(), thread)
            .await?
            .is_none()
    );
    assert!(
        mailbox
            .set_followup_inbox(delegate, thread, link, true, Some(Utc::now()))
            .await
            .is_err()
    );
    Ok(())
}
