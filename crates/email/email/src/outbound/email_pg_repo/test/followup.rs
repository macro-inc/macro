use super::thread_unread::service;
use super::*;
use crate::domain::followup::{EmailFollowupMailbox, EmailFollowupRepo};
use crate::domain::models::EmailErr;
use crate::domain::models::mailbox_action::{MailboxAction, MailboxOperationState};

const OUTLOOK_LINK: Uuid = uuid::uuid!("0a000000-0000-0000-0000-000000000001");
const OUTLOOK_RECEIVED: Uuid = uuid::uuid!("0a000000-0000-0000-0000-0000000000a1");
const OUTLOOK_SENT_ONLY: Uuid = uuid::uuid!("0a000000-0000-0000-0000-0000000000a2");

async fn archive_operations(
    repo: &EmailPgRepo,
    thread: Uuid,
) -> anyhow::Result<Vec<(MailboxAction, bool)>> {
    Ok(repo
        .thread_mailbox_operations(OUTLOOK_LINK, thread)
        .await?
        .into_iter()
        .filter(|operation| matches!(operation.action, MailboxAction::Archived(_)))
        .map(|operation| {
            (
                operation.action,
                matches!(operation.state, MailboxOperationState::Pending),
            )
        })
        .collect())
}

async fn unavailable(
    mailbox: &impl EmailFollowupMailbox,
    owner: &MacroUserIdStr<'static>,
) -> anyhow::Result<bool> {
    Ok(mailbox
        .followup_thread(owner.clone(), OUTLOOK_RECEIVED)
        .await?
        .unwrap()
        .unavailable)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_outlook_threads"))
)]
async fn outlook_followup_moves_the_thread_through_mailbox_commands(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    let mailbox = service(pool.clone());
    let returned_at = Utc.with_ymd_and_hms(2026, 1, 2, 3, 4, 5).unwrap();
    let facts = mailbox
        .followup_thread(owner.clone(), OUTLOOK_RECEIVED)
        .await?
        .unwrap();
    assert_eq!(facts.link_id, OUTLOOK_LINK);
    assert!(facts.inbox_visible);
    assert!(!facts.unavailable);

    mailbox
        .set_followup_inbox(owner.clone(), OUTLOOK_RECEIVED, OUTLOOK_LINK, false, None)
        .await?;
    let archived = mailbox
        .email_repo
        .thread_by_id(OUTLOOK_RECEIVED)
        .await?
        .unwrap();
    assert!(!archived.inbox_visible);
    assert_eq!(
        archive_operations(&mailbox.email_repo, OUTLOOK_RECEIVED).await?,
        vec![(MailboxAction::Archived(true), true)]
    );

    mailbox
        .set_followup_inbox(
            owner.clone(),
            OUTLOOK_RECEIVED,
            OUTLOOK_LINK,
            true,
            Some(returned_at),
        )
        .await?;
    let returned = mailbox
        .email_repo
        .thread_by_id(OUTLOOK_RECEIVED)
        .await?
        .unwrap();
    assert!(returned.inbox_visible);
    assert_eq!(
        mailbox
            .email_repo
            .followup_returned_at(OUTLOOK_RECEIVED, OUTLOOK_LINK)
            .await?,
        Some(returned_at)
    );
    assert_eq!(
        archive_operations(&mailbox.email_repo, OUTLOOK_RECEIVED).await?,
        vec![(MailboxAction::Archived(false), true)]
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_outlook_threads"))
)]
async fn outlook_followup_returns_a_sent_only_thread_to_the_inbox(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    let mailbox = service(pool.clone());
    let facts = mailbox
        .followup_thread(owner.clone(), OUTLOOK_SENT_ONLY)
        .await?
        .unwrap();
    assert!(facts.messages.iter().all(|message| message.outgoing));
    assert!(!facts.inbox_visible);

    mailbox
        .set_followup_inbox(
            owner.clone(),
            OUTLOOK_SENT_ONLY,
            OUTLOOK_LINK,
            true,
            Some(Utc::now()),
        )
        .await?;
    let returned = mailbox
        .email_repo
        .thread_by_id(OUTLOOK_SENT_ONLY)
        .await?
        .unwrap();
    assert!(returned.inbox_visible);
    assert!(
        returned.latest_inbound_message_ts.is_none(),
        "must not invent an inbound message"
    );

    mailbox
        .set_followup_inbox(owner, OUTLOOK_SENT_ONLY, OUTLOOK_LINK, false, None)
        .await?;
    let archived = mailbox
        .email_repo
        .thread_by_id(OUTLOOK_SENT_ONLY)
        .await?
        .unwrap();
    assert!(!archived.inbox_visible);
    assert_eq!(
        mailbox
            .email_repo
            .followup_returned_at(OUTLOOK_SENT_ONLY, OUTLOOK_LINK)
            .await?,
        None
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_outlook_threads"))
)]
async fn outlook_followup_is_unavailable_in_trash_or_junk(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    let mailbox = service(pool.clone());
    sqlx::query!(
        r#"UPDATE email_messages SET mailbox_state = mailbox_state || '{"in_inbox":false,"in_trash":true}' WHERE thread_id = $1"#,
        OUTLOOK_RECEIVED
    )
    .execute(&pool)
    .await?;
    assert!(
        unavailable(&mailbox, &owner).await?,
        "synced into Deleted Items"
    );
    assert_return_refused(&mailbox, &mailbox.email_repo, &owner).await?;
    sqlx::query!(
        r#"UPDATE email_messages SET mailbox_state = mailbox_state || '{"in_inbox":true,"in_trash":false}' WHERE thread_id = $1"#,
        OUTLOOK_RECEIVED
    )
    .execute(&pool)
    .await?;
    assert!(!unavailable(&mailbox, &owner).await?);

    queue(&mailbox.email_repo, &owner, MailboxAction::Junk(true)).await?;
    assert!(
        unavailable(&mailbox, &owner).await?,
        "pending move to Junk Email"
    );
    assert_return_refused(&mailbox, &mailbox.email_repo, &owner).await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_outlook_threads"))
)]
async fn outlook_followup_ignores_a_category_named_trash(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    let mailbox = service(pool.clone());
    sqlx::query!(
        "INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type)
         VALUES ($1, $2, 'TRASH', 'TRASH', 'Show', 'LabelShow', 'User')",
        Uuid::now_v7(),
        OUTLOOK_LINK
    )
    .execute(&pool)
    .await?;
    queue(
        &mailbox.email_repo,
        &owner,
        MailboxAction::Category {
            name: "TRASH".into(),
            present: true,
        },
    )
    .await?;
    assert!(
        !unavailable(&mailbox, &owner).await?,
        "a category named TRASH is not the trash folder"
    );
    Ok(())
}

async fn queue(
    repo: &EmailPgRepo,
    owner: &MacroUserIdStr<'static>,
    action: MailboxAction,
) -> anyhow::Result<()> {
    let messages = repo
        .mailbox_action_messages(OUTLOOK_LINK, OUTLOOK_RECEIVED)
        .await?;
    repo.enqueue_mailbox_action(
        OUTLOOK_LINK,
        owner.clone(),
        &action,
        &action.targets(&messages),
    )
    .await?;
    Ok(())
}

async fn assert_return_refused(
    mailbox: &impl EmailFollowupMailbox,
    repo: &EmailPgRepo,
    owner: &MacroUserIdStr<'static>,
) -> anyhow::Result<()> {
    assert!(matches!(
        mailbox
            .set_followup_inbox(
                owner.clone(),
                OUTLOOK_RECEIVED,
                OUTLOOK_LINK,
                true,
                Some(Utc::now()),
            )
            .await,
        Err(EmailErr::ThreadNotFound)
    ));
    assert!(archive_operations(repo, OUTLOOK_RECEIVED).await?.is_empty());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_thread_labels", "email_thread_unread", "email_thread_archive")
    )
)]
async fn gmail_followup_is_unavailable_with_trash_or_spam_labels(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let thread = uuid::uuid!("11111111-1111-1111-1111-111111111111");
    let link = uuid::uuid!("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    let message = uuid::uuid!("11111111-aaaa-aaaa-aaaa-111111111111");
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    let mailbox = service(pool.clone());
    assert!(
        !mailbox
            .followup_thread(owner.clone(), thread)
            .await?
            .unwrap()
            .unavailable
    );
    for system_label in ["TRASH", "SPAM"] {
        let label = sqlx::query_scalar!(
            "INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type)
             VALUES ($1, $2, $3, $4, 'Hide', 'LabelHide', 'System') RETURNING id",
            Uuid::now_v7(),
            link,
            system_label,
            system_label
        )
        .fetch_one(&pool)
        .await?;
        sqlx::query!(
            "INSERT INTO email_message_labels (message_id, label_id) VALUES ($1, $2)",
            message,
            label
        )
        .execute(&pool)
        .await?;
        assert!(
            mailbox
                .followup_thread(owner.clone(), thread)
                .await?
                .unwrap()
                .unavailable,
            "{system_label}"
        );
        assert!(matches!(
            mailbox
                .set_followup_inbox(owner.clone(), thread, link, true, Some(Utc::now()))
                .await,
            Err(EmailErr::ThreadNotFound)
        ));
        sqlx::query!("DELETE FROM email_labels WHERE id = $1", label)
            .execute(&pool)
            .await?;
    }
    Ok(())
}

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
    let metadata = mailbox.email_repo.thread_metadata_by_ids(&[thread]).await?;
    assert_eq!(metadata.len(), 1);
    assert_eq!(
        metadata[0].reminder_returned_at,
        returned.reminder_returned_at
    );
    assert!(metadata[0].latest_inbound_message_ts.is_none());
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
