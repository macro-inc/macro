use super::*;
use crate::domain::models::{NotifiedHydratableTypes, NotifiedPagePosition};
use foreign_entity::domain::models::SourceId;
use item_filters::ast::EntityFilterAst;
use item_filters::ast::chat::ChatLiteral;
use item_filters::ast::document::DocumentLiteral;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Pool, Postgres};
use std::sync::Arc;
use uuid::Uuid;

const USER_1: &str = "macro|user-1@test.com";
const DOC_A: &str = "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CHAT_A: &str = "22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_A: &str = "aaaaaaaa-ffff-ffff-ffff-ffffffffffff";
const CHANNEL_X: &str = "33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const THREAD_M: &str = "99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const THREAD_Z: &str = "44444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EVENT_E1: &str = "66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EVENT_E3: &str = "66666666-cccc-cccc-cccc-cccccccccccc";
const PR_F1: &str = "77777777-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PR_F3: &str = "77777777-cccc-cccc-cccc-cccccccccccc";
const REMINDER_R1: &str = "88888888-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LINK_1: &str = "55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TEAM_T: &str = "eeeeeeee-1111-1111-1111-111111111111";
const CHANNEL_X_INVITE: &str = "0190a000-0000-7000-8000-000000000000";
const THREAD_M_MENTION: &str = "0190a000-0000-7000-8000-000000000006";
const PR_F1_EVENT: &str = "0190a000-0000-7000-8000-000000000003";

const EVERYTHING: NotifiedHydratableTypes = NotifiedHydratableTypes {
    channels: true,
    channel_threads: true,
    email_threads: true,
    foreign_entities: true,
    reminders: true,
};

fn sources() -> Vec<SourceId> {
    vec![
        SourceId::user(USER_1),
        SourceId::team(Uuid::parse_str(TEAM_T).unwrap()),
    ]
}

fn req<'a>(
    filter: Option<&'a EntityFilterAst>,
    link_ids: &'a [Uuid],
    sources: &'a [SourceId],
    hydratable: NotifiedHydratableTypes,
) -> NotifiedSoupRequest<'a> {
    NotifiedSoupRequest {
        user_id: MacroUserIdStr::parse_from_str(USER_1).unwrap(),
        limit: 50,
        after: None,
        filter,
        link_ids,
        foreign_entity_sources: sources,
        hydratable,
    }
}

fn keys(page: &[NotifiedEntity]) -> Vec<(EntityType, String)> {
    page.iter()
        .map(|n| (n.entity.entity_type, n.entity.entity_id.to_string()))
        .collect()
}

fn minutes(page: &[NotifiedEntity]) -> Vec<u32> {
    use chrono::Timelike;
    page.iter().map(|n| n.notified_at.minute()).collect()
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("notified_at")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn feed_orders_by_latest_notification(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let page = notified_soup_page(&pool, req(None, &link_ids, &sources, EVERYTHING)).await?;

    // Exactly the visible entities user-1 holds a live notification for —
    // the deleted-row, deleted-doc, no-access, left-channel, foreign-inbox,
    // other-owner, call and malformed-id rows are all absent — latest
    // notification first. Delegated events and team-stored foreign entities
    // are visible through those access paths. doc-A's older mention must
    // not move it, user-2's newer notification about doc-A must not move
    // it, and chat-A's done row still counts. The thread mention is keyed on
    // its thread root, separately from the channel-level notification on
    // the same channel.
    assert_eq!(
        keys(&page),
        vec![
            (EntityType::CalendarEvent, EVENT_E3.to_string()),
            (EntityType::ForeignEntity, PR_F3.to_string()),
            (EntityType::Document, DOC_A.to_string()),
            (EntityType::Chat, CHAT_A.to_string()),
            (EntityType::Project, PROJECT_A.to_string()),
            (EntityType::ChannelMessage, THREAD_M.to_string()),
            (EntityType::CalendarEvent, EVENT_E1.to_string()),
            (EntityType::EmailThread, THREAD_Z.to_string()),
            (EntityType::ForeignEntity, PR_F1.to_string()),
            (EntityType::Reminder, REMINDER_R1.to_string()),
            (EntityType::Channel, CHANNEL_X.to_string()),
        ]
    );
    assert_eq!(minutes(&page), vec![20, 19, 9, 8, 7, 6, 5, 4, 3, 2, 0]);

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("notified_at")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn keyset_paginates_without_overlap_or_gaps(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();

    let mut all = Vec::new();
    let mut after = None;
    loop {
        let mut request = req(None, &link_ids, &sources, EVERYTHING);
        request.limit = 3;
        request.after = after;
        let page = notified_soup_page(&pool, request).await?;
        let full = page.len() == 3;
        all.extend(page);
        if !full {
            break;
        }
        let last = all.last().unwrap();
        after = Some(NotifiedPagePosition {
            notified_at: last.notified_at,
            entity_id: last.entity.entity_id.to_string(),
        });
    }

    // Walking in pages of 3 yields the same feed as one big page.
    let one_page = notified_soup_page(&pool, req(None, &link_ids, &sources, EVERYTHING)).await?;
    assert_eq!(keys(&all), keys(&one_page));
    assert_eq!(all.len(), 11);

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("notified_at")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn inactive_legs_drop_their_types(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let page = notified_soup_page(
        &pool,
        req(
            None,
            &link_ids,
            &sources,
            NotifiedHydratableTypes::default(),
        ),
    )
    .await?;

    // Only the soup-hydrated types remain when every domain leg is off.
    assert_eq!(
        keys(&page),
        vec![
            (EntityType::CalendarEvent, EVENT_E3.to_string()),
            (EntityType::Document, DOC_A.to_string()),
            (EntityType::Chat, CHAT_A.to_string()),
            (EntityType::Project, PROJECT_A.to_string()),
            (EntityType::CalendarEvent, EVENT_E1.to_string()),
        ]
    );

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("notified_at")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn done_filters_exclude_without_moving_the_sort_key(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();

    // Not-done gates per type: chat-A's only notification is done, so it
    // drops; doc-A keeps its T9 key even though its T1 mention is done.
    let filter = EntityFilterAst {
        document_filter: Some(Arc::new(filter_ast::Expr::val(
            DocumentLiteral::NotificationDone(false),
        ))),
        chat_filter: Some(Arc::new(filter_ast::Expr::val(
            ChatLiteral::NotificationDone(false),
        ))),
        ..EntityFilterAst::default()
    };
    let page =
        notified_soup_page(&pool, req(Some(&filter), &link_ids, &sources, EVERYTHING)).await?;
    let keys = keys(&page);
    assert_eq!(keys[2], (EntityType::Document, DOC_A.to_string()));
    assert_eq!(minutes(&page)[2], 9);
    assert!(!keys.contains(&(EntityType::Chat, CHAT_A.to_string())));
    assert_eq!(page.len(), 10);

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("notified_at")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn calendar_filter_folds_notification_state(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();

    // Neither alarm is done, so asking for done calendar events drops both.
    let filter = EntityFilterAst {
        calendar_event_filter: Some(Arc::new(filter_ast::Expr::val(
            CalendarEventLiteral::NotificationDone(true),
        ))),
        ..EntityFilterAst::default()
    };
    let page =
        notified_soup_page(&pool, req(Some(&filter), &link_ids, &sources, EVERYTHING)).await?;
    assert!(!keys(&page).contains(&(EntityType::CalendarEvent, EVENT_E1.to_string())));
    assert!(!keys(&page).contains(&(EntityType::CalendarEvent, EVENT_E3.to_string())));
    assert_eq!(page.len(), 9);

    // Naming an event keeps it and drops the other.
    let filter = EntityFilterAst {
        calendar_event_filter: Some(Arc::new(filter_ast::Expr::val(CalendarEventLiteral::Id(
            Uuid::parse_str(EVENT_E1)?,
        )))),
        ..EntityFilterAst::default()
    };
    let page =
        notified_soup_page(&pool, req(Some(&filter), &link_ids, &sources, EVERYTHING)).await?;
    assert!(keys(&page).contains(&(EntityType::CalendarEvent, EVENT_E1.to_string())));
    assert!(!keys(&page).contains(&(EntityType::CalendarEvent, EVENT_E3.to_string())));
    assert_eq!(page.len(), 10);

    Ok(())
}

/// Email and channel trees fold at hydration, but the conjuncts they imply
/// (importance, notification state) pre-filter the candidates so the page
/// does not spend slots on rows hydration would drop. `Or` trees imply
/// nothing and leave the candidates alone.
#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("notified_at")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn email_and_channel_conjuncts_prefilter_candidates(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    use item_filters::ast::EmailFilterAst;
    use item_filters::ast::channel::ChannelLiteral;
    use item_filters::ast::email::EmailLiteral;

    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let thread = (EntityType::EmailThread, THREAD_Z.to_string());
    let channel = (EntityType::Channel, CHANNEL_X.to_string());
    let email_tree = |tree: filter_ast::Expr<EmailLiteral>| EmailFilterAst {
        tree: Some(Arc::new(tree)),
        crm_scope: None,
    };

    // Signal-shaped: not done AND important. thread-Z is signal and its
    // notification is live, so it stays.
    let filter = EntityFilterAst {
        email_filter: email_tree(filter_ast::Expr::and(
            filter_ast::Expr::val(EmailLiteral::NotificationDone(false)),
            filter_ast::Expr::val(EmailLiteral::Importance(true)),
        )),
        ..EntityFilterAst::default()
    };
    let page =
        notified_soup_page(&pool, req(Some(&filter), &link_ids, &sources, EVERYTHING)).await?;
    assert!(keys(&page).contains(&thread));

    // Noise-shaped: not done AND not important. thread-Z is signal, so the
    // importance conjunct drops it before hydration.
    let filter = EntityFilterAst {
        email_filter: email_tree(filter_ast::Expr::and(
            filter_ast::Expr::val(EmailLiteral::NotificationDone(false)),
            filter_ast::Expr::val(EmailLiteral::Importance(false)),
        )),
        ..EntityFilterAst::default()
    };
    let page =
        notified_soup_page(&pool, req(Some(&filter), &link_ids, &sources, EVERYTHING)).await?;
    assert!(!keys(&page).contains(&thread));
    assert_eq!(page.len(), 10);

    // Done-only channels: channel-X's channel-level notification is live, so
    // the channel row drops; the thread row is gated by the thread tree, so
    // it stays.
    let filter = EntityFilterAst {
        channel_filter: Some(Arc::new(filter_ast::Expr::val(
            ChannelLiteral::NotificationDone(true),
        ))),
        ..EntityFilterAst::default()
    };
    let page =
        notified_soup_page(&pool, req(Some(&filter), &link_ids, &sources, EVERYTHING)).await?;
    assert!(!keys(&page).contains(&channel));
    assert!(keys(&page).contains(&(EntityType::ChannelMessage, THREAD_M.to_string())));
    assert_eq!(page.len(), 10);

    // An `Or` implies neither branch, so nothing is pre-filtered.
    let filter = EntityFilterAst {
        email_filter: email_tree(filter_ast::Expr::or(
            filter_ast::Expr::val(EmailLiteral::Importance(false)),
            filter_ast::Expr::val(EmailLiteral::NotificationDone(true)),
        )),
        ..EntityFilterAst::default()
    };
    let page =
        notified_soup_page(&pool, req(Some(&filter), &link_ids, &sources, EVERYTHING)).await?;
    assert!(keys(&page).contains(&thread));
    assert_eq!(page.len(), 11);

    Ok(())
}

/// The channel gate's notification conjuncts see channel-level notifications
/// only: a mention names its thread as the secondary item and is that
/// thread row's notification, so once the channel's own notifications are
/// done a still-live mention must not keep the channel row in a not-done
/// feed — the mention shows once, on the thread row.
#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("notified_at")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_conjuncts_ignore_thread_scoped_notifications(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    use item_filters::ast::channel::ChannelLiteral;

    sqlx::query("UPDATE user_notification SET done = TRUE WHERE notification_id = $1::uuid")
        .bind(CHANNEL_X_INVITE)
        .execute(&pool)
        .await?;

    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let filter = EntityFilterAst {
        channel_filter: Some(Arc::new(filter_ast::Expr::val(
            ChannelLiteral::NotificationDone(false),
        ))),
        ..EntityFilterAst::default()
    };
    let page =
        notified_soup_page(&pool, req(Some(&filter), &link_ids, &sources, EVERYTHING)).await?;
    assert!(!keys(&page).contains(&(EntityType::Channel, CHANNEL_X.to_string())));
    assert!(keys(&page).contains(&(EntityType::ChannelMessage, THREAD_M.to_string())));
    assert_eq!(page.len(), 10);

    Ok(())
}

/// Channel-thread and foreign-entity trees fold at hydration, but the
/// notification-state conjuncts they imply pre-filter the candidates over
/// the rows their folds predicate on: the thread's own notifications (not
/// its channel's) and the foreign entity's notifications.
#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("notified_at")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn thread_and_foreign_entity_conjuncts_prefilter_candidates(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    use item_filters::ast::channel::ChannelThreadLiteral;

    sqlx::query("UPDATE user_notification SET done = TRUE WHERE notification_id = ANY($1::uuid[])")
        .bind(vec![
            Uuid::parse_str(THREAD_M_MENTION)?,
            Uuid::parse_str(PR_F1_EVENT)?,
        ])
        .execute(&pool)
        .await?;

    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let thread = (EntityType::ChannelMessage, THREAD_M.to_string());
    let pr_f1 = (EntityType::ForeignEntity, PR_F1.to_string());
    let pr_f3 = (EntityType::ForeignEntity, PR_F3.to_string());

    // Not-done trees drop the done mention and the done pull request; the
    // channel's live invite does not keep the thread row.
    let filter = EntityFilterAst {
        channel_thread_filter: Some(Arc::new(filter_ast::Expr::val(
            ChannelThreadLiteral::NotificationDone(false),
        ))),
        foreign_entity_filter: Some(Arc::new(filter_ast::Expr::val(
            ForeignEntityLiteral::NotificationDone(false),
        ))),
        ..EntityFilterAst::default()
    };
    let page =
        notified_soup_page(&pool, req(Some(&filter), &link_ids, &sources, EVERYTHING)).await?;
    assert!(!keys(&page).contains(&thread));
    assert!(!keys(&page).contains(&pr_f1));
    assert!(keys(&page).contains(&pr_f3));
    assert!(keys(&page).contains(&(EntityType::Channel, CHANNEL_X.to_string())));
    assert_eq!(page.len(), 9);

    // Done trees keep them and drop the live pull request instead.
    let filter = EntityFilterAst {
        channel_thread_filter: Some(Arc::new(filter_ast::Expr::val(
            ChannelThreadLiteral::NotificationDone(true),
        ))),
        foreign_entity_filter: Some(Arc::new(filter_ast::Expr::val(
            ForeignEntityLiteral::NotificationDone(true),
        ))),
        ..EntityFilterAst::default()
    };
    let page =
        notified_soup_page(&pool, req(Some(&filter), &link_ids, &sources, EVERYTHING)).await?;
    assert!(keys(&page).contains(&thread));
    assert!(keys(&page).contains(&pr_f1));
    assert!(!keys(&page).contains(&pr_f3));
    assert_eq!(page.len(), 10);

    Ok(())
}

#[test]
fn every_type_with_every_leg_active() {
    let link_ids = [Uuid::from_u128(1)];
    let sources = sources();
    let types = included_types(&req(None, &link_ids, &sources, EVERYTHING));
    assert_eq!(
        types,
        vec![
            "document",
            "chat",
            "project",
            "channel",
            "channel_message",
            "email_thread",
            "calendar_event",
            "foreign_entity",
            "reminder",
        ]
    );
}

#[test]
fn inactive_legs_and_missing_scopes_drop_types() {
    let link_ids = [Uuid::from_u128(1)];
    let sources = sources();
    let types = included_types(&req(
        None,
        &link_ids,
        &sources,
        NotifiedHydratableTypes::default(),
    ));
    assert_eq!(types, vec!["document", "chat", "project", "calendar_event"]);

    // An active email leg without inboxes still has no threads to gate on.
    let types = included_types(&req(None, &[], &sources, EVERYTHING));
    assert!(!types.contains(&"email_thread"));

    // An active foreign-entity leg without sources has nothing to gate on.
    let types = included_types(&req(None, &link_ids, &[], EVERYTHING));
    assert!(!types.contains(&"foreign_entity"));
}

#[test]
fn nil_id_foreign_entity_filter_drops_foreign_entities() {
    let link_ids = [Uuid::from_u128(1)];
    let sources = sources();
    // The client's opt-out for an unreferenced entity type.
    let filter = EntityFilterAst {
        foreign_entity_filter: Some(Arc::new(filter_ast::Expr::val(ForeignEntityLiteral::Id(
            Uuid::nil(),
        )))),
        ..EntityFilterAst::default()
    };
    let types = included_types(&req(Some(&filter), &link_ids, &sources, EVERYTHING));
    assert!(!types.contains(&"foreign_entity"));
    assert!(types.contains(&"document"));
}

#[test]
fn calendar_fold_renders_supported_literals() {
    let tree = filter_ast::Expr::and(
        filter_ast::Expr::val(CalendarEventLiteral::Id(Uuid::from_u128(7))),
        filter_ast::Expr::is_not(filter_ast::Expr::val(
            CalendarEventLiteral::NotificationDone(true),
        )),
    );
    let sql = build_calendar_event_filter(Some(&tree));
    assert!(sql.starts_with(" AND ("));
    assert!(sql.contains("event.id = '00000000-0000-0000-0000-000000000007'"));
    assert!(sql.contains("NOT (EXISTS ("));
    assert!(sql.contains("un.done = true"));
    assert_eq!(build_calendar_event_filter(None), "");
}
