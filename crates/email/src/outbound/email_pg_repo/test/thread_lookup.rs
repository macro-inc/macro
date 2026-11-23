use super::*;
use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    ViewAccessLevel,
};
use macro_user_id::cowlike::CowLike;

const GMAIL: Uuid = uuid::uuid!("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const OUTLOOK: Uuid = uuid::uuid!("0a000000-0000-0000-0000-000000000001");

/// `email_all_mail`'s threads of one inbox: (thread, the preview a lookup by
/// id must show). Spam-only and trash-only threads are outside All Mail; the
/// mixed thread keeps its All Mail preview over its newer spam and trash.
fn lookups(link: Uuid) -> [(Uuid, &'static str); 3] {
    let prefix = if link == GMAIL { 100 } else { 200 };
    let id = |suffix: u32| {
        Uuid::parse_str(&format!("0b000000-0000-0000-0000-{:012}", prefix + suffix)).unwrap()
    };
    [
        (id(4), "Spam only"),
        (id(3), "Trash only"),
        (id(2), "Mixed normal mail"),
    ]
}

fn receipt(viewer: &MacroUserIdStr<'static>, id: Uuid) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::try_new(
        EntityAccessAuth::Authenticated(viewer.clone()),
        Entity {
            entity_type: EntityType::EmailThread,
            entity_id: id.to_string(),
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap()
}

async fn set_unread(pool: &Pool<Postgres>, thread: Uuid) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_threads SET is_read = false WHERE id = $1",
        thread
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "UPDATE email_messages SET is_read = false WHERE thread_id = $1",
        thread
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_outlook_threads", "email_all_mail")
    )
)]
async fn threads_opened_by_id_render_outside_all_mail(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let service = super::thread_unread::service(pool.clone());
    let viewer = MacroUserIdStr::parse_from_str("macro|mail@example.com")?.into_owned();
    for link in [GMAIL, OUTLOOK] {
        for (thread, subject) in lookups(link) {
            for unread in [false, true] {
                if unread {
                    set_unread(&pool, thread).await?;
                }
                let previews = service
                    .get_email_thread_previews_by_receipts_impl(
                        viewer.clone(),
                        vec![receipt(&viewer, thread)],
                    )
                    .await?;
                assert_eq!(
                    previews
                        .iter()
                        .map(|p| (p.thread.id, p.thread.name.as_deref(), p.thread.is_read))
                        .collect::<Vec<_>>(),
                    [(thread, Some(subject), !unread)],
                    "{subject} in {link}, unread: {unread}"
                );
            }
        }

        // One batch renders each thread once, in its own folder's preview.
        let mut batch = service
            .get_email_thread_previews_by_receipts_impl(
                viewer.clone(),
                lookups(link)
                    .iter()
                    .map(|(thread, _)| receipt(&viewer, *thread))
                    .collect(),
            )
            .await?
            .into_iter()
            .map(|p| (p.thread.id, p.thread.name))
            .collect::<Vec<_>>();
        batch.sort();
        let mut expected = lookups(link)
            .iter()
            .map(|(thread, subject)| (*thread, Some(subject.to_string())))
            .collect::<Vec<_>>();
        expected.sort();
        assert_eq!(batch, expected);
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_outlook_threads", "email_all_mail")
    )
)]
async fn read_state_writes_reload_threads_outside_all_mail(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // Gmail read state moves through the inbox's UNREAD label.
    sqlx::query!(
        "INSERT INTO email_labels (id, link_id, provider_label_id, name, type)
         VALUES ('10000013-0000-0000-0000-000000000013', $1, 'UNREAD', 'UNREAD', 'System')",
        GMAIL
    )
    .execute(&pool)
    .await?;
    let service = super::thread_unread::service(pool.clone());
    let owner = MacroUserIdStr::parse_from_str("macro|mail@example.com")?.into_owned();
    for link in [GMAIL, OUTLOOK] {
        for (thread, subject) in lookups(link) {
            set_unread(&pool, thread).await?;
            if link == GMAIL {
                sqlx::query!(
                    "INSERT INTO email_message_labels (message_id, label_id)
                     SELECT id, '10000013-0000-0000-0000-000000000013' FROM email_messages
                     WHERE thread_id = $1",
                    thread
                )
                .execute(&pool)
                .await?;
            }
            service.mark_thread_seen_impl(owner.clone(), thread).await?;
            let seen = service
                .get_owned_email_thread_preview_impl(owner.clone(), thread)
                .await?
                .expect("the reply to a mark-read write");
            assert_eq!(
                (seen.thread.id, seen.thread.name.as_deref()),
                (thread, Some(subject)),
                "mark read, {link}"
            );

            service
                .mark_thread_unread_impl(owner.clone(), thread)
                .await?;
            let unread = service
                .get_owned_email_thread_preview_impl(owner.clone(), thread)
                .await?
                .expect("the reply to a mark-unread write");
            assert_eq!(
                (unread.thread.id, unread.thread.name.as_deref()),
                (thread, Some(subject)),
                "mark unread, {link}"
            );
            if link == GMAIL {
                assert!(seen.thread.is_read, "{subject}");
                assert!(!unread.thread.is_read, "{subject}");
            }
        }
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_outlook_threads", "email_all_mail")
    )
)]
async fn moving_a_thread_to_spam_or_trash_reloads_it_from_there(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    use crate::domain::models::mailbox_action::MailboxAction;

    let service = super::thread_unread::service(pool.clone());
    let owner = MacroUserIdStr::parse_from_str("macro|mail@example.com")?.into_owned();
    for (link, archived) in [
        (GMAIL, uuid::uuid!("0b000000-0000-0000-0000-000000000101")),
        (OUTLOOK, uuid::uuid!("0b000000-0000-0000-0000-000000000201")),
    ] {
        for (action, restore) in [
            (MailboxAction::Junk(true), MailboxAction::Junk(false)),
            (MailboxAction::Trashed(true), MailboxAction::Trashed(false)),
        ] {
            for write in [action, restore] {
                service
                    .change_thread_mailbox_state_impl(owner.clone(), archived, write.clone())
                    .await?;
                let reloaded = service
                    .get_owned_email_thread_preview_impl(owner.clone(), archived)
                    .await?
                    .map(|preview| (preview.thread.id, preview.thread.name));
                assert_eq!(
                    reloaded,
                    Some((archived, Some("Archived mail".to_string()))),
                    "{write:?} in {link}"
                );
            }
        }
    }

    // Ownership stays the service's check: another user's lookup finds nothing.
    let stranger = MacroUserIdStr::parse_from_str("macro|user1@example.com")?.into_owned();
    for (thread, _) in lookups(GMAIL) {
        assert!(
            service
                .get_owned_email_thread_preview_impl(stranger.clone(), thread)
                .await?
                .is_none()
        );
    }
    Ok(())
}
