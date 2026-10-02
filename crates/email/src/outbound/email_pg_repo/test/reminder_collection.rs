use super::thread_unread::service;
use super::*;
use crate::domain::followup::{EmailFollowupMailbox, ReminderAttachmentKind, ReminderThreadFilter};
use entity_access::{
    domain::{
        models::{EntityAccessReceipt, ViewAccessLevel},
        ports::EntityAccessService,
        service::EntityAccessServiceImpl,
    },
    outbound::PgAccessRepository,
};

async fn receipts(
    pool: &Pool<Postgres>,
    user: &MacroUserIdStr<'_>,
    ids: &[Uuid],
) -> Vec<EntityAccessReceipt<ViewAccessLevel>> {
    EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone()))
        .generate_email_thread_view_access_receipts(
            user,
            None,
            &ids.iter().map(ToString::to_string).collect::<Vec<_>>(),
        )
        .await
        .into_values()
        .filter_map(Result::ok)
        .collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts(
            "email_dynamic_query",
            "email_dynamic_query_multi_inbox",
            "email_dynamic_query_calendar",
            "email_dynamic_query_properties"
        )
    )
)]
async fn reminder_collection_applies_current_inbox_and_all_email_facets(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let mailbox = service(pool.clone());
    let user = MacroUserIdStr::try_from_email("user1@test.com")?;
    let first = uuid::uuid!("20000001-0000-0000-0000-000000000001");
    let second = uuid::uuid!("20000201-0000-0000-0000-000000000201");
    let pdf = uuid::uuid!("20000005-0000-0000-0000-000000000005");
    let ids = [first, second, pdf];
    let cases = [
        (
            ReminderThreadFilter {
                inbox_ids: Some(vec![uuid::uuid!("dddddddd-dddd-dddd-dddd-dddddddddddd")]),
                ..Default::default()
            },
            vec![second],
        ),
        (
            ReminderThreadFilter {
                inbox_ids: Some(vec![]),
                ..Default::default()
            },
            vec![],
        ),
        (
            ReminderThreadFilter {
                done: Some(true),
                read: Some(true),
                ..Default::default()
            },
            vec![second],
        ),
        (
            ReminderThreadFilter {
                calendar: true,
                ..Default::default()
            },
            vec![first, pdf],
        ),
        (
            ReminderThreadFilter {
                tags: vec![(
                    uuid::uuid!("bb111111-1111-1111-1111-111111111111"),
                    uuid::uuid!("0bb11111-1111-1111-1111-111111111111"),
                )],
                ..Default::default()
            },
            vec![first],
        ),
        (
            ReminderThreadFilter {
                attachments: vec![ReminderAttachmentKind::Pdf],
                ..Default::default()
            },
            vec![pdf],
        ),
        (
            ReminderThreadFilter {
                attachments: vec![ReminderAttachmentKind::Image],
                ..Default::default()
            },
            vec![],
        ),
    ];
    for (filters, mut expected) in cases {
        let mut actual = mailbox
            .reminder_threads(user.clone(), receipts(&pool, &user, &ids).await, &filters)
            .await?;
        actual.sort();
        expected.sort();
        assert_eq!(actual, expected, "filters: {filters:?}");
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_dynamic_query_multi_inbox")
    )
)]
async fn reminder_collection_rechecks_delegation_after_receipt_minting(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let thread = uuid::uuid!("20000201-0000-0000-0000-000000000201");
    let link = uuid::uuid!("dddddddd-dddd-dddd-dddd-dddddddddddd");
    sqlx::query!(r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ('d1000000-0000-0000-0000-000000000002', 'delegate', 'delegate@test.com', 'collection_delegate')"#).execute(&pool).await?;
    sqlx::query!(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|delegate@test.com', 'delegate@test.com', 'd1000000-0000-0000-0000-000000000002')"#).execute(&pool).await?;
    sqlx::query!("INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id) VALUES ('macro|delegate@test.com', 'macro|user1@test.com', $1)", link).execute(&pool).await?;
    let user = MacroUserIdStr::try_from_email("delegate@test.com")?;
    let mailbox = service(pool.clone());
    let filters = ReminderThreadFilter {
        inbox_ids: Some(vec![link]),
        ..Default::default()
    };
    let before = receipts(&pool, &user, &[thread]).await;
    assert_eq!(before.len(), 1);
    assert_eq!(
        mailbox
            .reminder_threads(user.clone(), before, &filters)
            .await?,
        vec![thread]
    );
    let stale = receipts(&pool, &user, &[thread]).await;
    sqlx::query!(
        "DELETE FROM macro_user_links WHERE primary_macro_id = $1",
        user.as_ref()
    )
    .execute(&pool)
    .await?;
    assert!(
        mailbox
            .reminder_threads(user.clone(), stale, &filters)
            .await?
            .is_empty()
    );
    assert!(receipts(&pool, &user, &[thread]).await.is_empty());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn reminder_collection_excludes_shared_rows_outside_mail_inboxes(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let thread = uuid::uuid!("20000001-0000-0000-0000-000000000001");
    let user = MacroUserIdStr::try_from_email("shared-viewer@test.com")?;
    sqlx::query!(r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ('d2000000-0000-0000-0000-000000000002', 'shared-viewer', 'shared-viewer@test.com', 'collection_shared')"#).execute(&pool).await?;
    sqlx::query!(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|shared-viewer@test.com', 'shared-viewer@test.com', 'd2000000-0000-0000-0000-000000000002')"#).execute(&pool).await?;
    sqlx::query!("INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, 'email_thread', $2, 'user', 'view')", thread, user.as_ref()).execute(&pool).await?;
    let mailbox = service(pool.clone());
    assert_eq!(receipts(&pool, &user, &[thread]).await.len(), 1);
    assert!(
        mailbox
            .reminder_threads(
                user.clone(),
                receipts(&pool, &user, &[thread]).await,
                &ReminderThreadFilter::default()
            )
            .await?
            .is_empty()
    );
    sqlx::query!(
        "DELETE FROM entity_access WHERE entity_id = $1 AND source_id = $2",
        thread,
        user.as_ref()
    )
    .execute(&pool)
    .await?;
    assert!(receipts(&pool, &user, &[thread]).await.is_empty());
    Ok(())
}
